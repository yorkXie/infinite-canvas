/**
 * POC: 最小本地 KV 存储服务，用来把浏览器的 image_files 存储搬到磁盘。
 *
 *   PUT    /kv/:ns/:key    写入（临时文件 + rename，原子替换）
 *   GET    /kv/:ns/:key    读取（Content-Type 取 meta 里记录的原值）
 *   DELETE /kv/:ns/:key    删除
 *   GET    /kv/:ns         列出该命名空间的全部 key
 *   GET    /               健康检查
 *
 * 只监听 127.0.0.1，不对外网暴露。
 */

import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.env.STORE_ROOT || "O:/AI/infinite-canvas/store";
const PORT = Number(process.env.STORE_PORT || 9410);
const HOST = process.env.STORE_HOST || "127.0.0.1";

const CORS: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*",
    "access-control-max-age": "86400",
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
    });
}

/** 拒绝路径穿越。key 允许冒号（storageKey 形如 image:abc）。 */
function safeSegment(value: string) {
    return Boolean(value) && value !== "." && value !== ".." && !/[/\\\u0000]/.test(value) && value.length <= 512;
}

/** 磁盘文件名：冒号在 NTFS 非法，统一百分号编码。 */
function fileNameOf(key: string) {
    return encodeURIComponent(key);
}

function keyOf(fileName: string) {
    try {
        return decodeURIComponent(fileName);
    } catch {
        return fileName;
    }
}

async function listKeys(ns: string) {
    try {
        const names = await readdir(join(ROOT, ns));
        return names.filter((name) => !name.endsWith(".meta.json") && !name.includes(".tmp-")).map(keyOf);
    } catch {
        return [];
    }
}

async function route(req: Request): Promise<Response> {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (parts.length === 0) {
        return json({ app: "infinite-canvas-store", root: ROOT, port: PORT });
    }

    if (parts[0] !== "kv" || parts.length < 2 || parts.length > 3) {
        return json({ error: "not found" }, 404);
    }

    const ns = parts[1];
    if (!safeSegment(ns)) return json({ error: "bad namespace" }, 400);

    if (parts.length === 2) {
        if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
        return json({ keys: await listKeys(ns) });
    }

    const key = decodeURIComponent(parts[2]);
    if (!safeSegment(key)) return json({ error: "bad key" }, 400);

    const dir = join(ROOT, ns);
    const file = join(dir, fileNameOf(key));
    const metaFile = `${file}.meta.json`;

    if (req.method === "PUT") {
        const body = Buffer.from(await req.arrayBuffer());
        const type = req.headers.get("content-type") || "application/octet-stream";
        await mkdir(dir, { recursive: true });
        const bytes = await serialize(file, async () => {
            const tmp = `${file}.tmp-${Math.random().toString(36).slice(2)}`;
            try {
                await writeFile(tmp, body);
                await writeFile(`${tmp}.meta.json`, JSON.stringify({ type, size: body.length, at: new Date().toISOString() }));
                await renameWithRetry(tmp, file);
                await renameWithRetry(`${tmp}.meta.json`, metaFile);
            } catch (error) {
                await unlink(tmp).catch(() => undefined);
                await unlink(`${tmp}.meta.json`).catch(() => undefined);
                throw error;
            }
            return body.length;
        });
        return json({ ok: true, key, bytes });
    }

    if (req.method === "GET") {
        let body: Buffer;
        try {
            body = await readFile(file);
        } catch {
            return json({ error: "not found" }, 404);
        }
        let type = "application/octet-stream";
        try {
            type = JSON.parse(await readFile(metaFile, "utf8")).type || type;
        } catch {
            /* meta 缺失时退回 octet-stream */
        }
        return new Response(body, { headers: { ...CORS, "content-type": type } });
    }

    if (req.method === "DELETE") {
        await unlink(file).catch(() => undefined);
        await unlink(metaFile).catch(() => undefined);
        return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
}

const writeQueues = new Map<string, Promise<unknown>>();

/** 同一个 key 的写入排队执行：并发 rename 同一个目标在 Windows 上会报 EPERM。 */
function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = writeQueues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    writeQueues.set(
        key,
        next.catch(() => undefined),
    );
    return next;
}

/** 目标文件被占用时 rename 会抛 EPERM/EBUSY/EACCES，退避重试几次基本都能过。 */
async function renameWithRetry(from: string, to: string, attempts = 5) {
    for (let i = 0; i < attempts; i += 1) {
        try {
            return await rename(from, to);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (!code || !["EPERM", "EBUSY", "EACCES"].includes(code) || i === attempts - 1) throw error;
            await new Promise((resolve) => setTimeout(resolve, 30 * (i + 1)));
        }
    }
}

/** 清掉上次异常退出留下的 .tmp-* 文件。直接 unlink，不进回收站。 */
async function cleanTempFiles() {
    let removed = 0;
    const walk = async (dir: string) => {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
                continue;
            }
            if (!/\.tmp-[a-z0-9]+(\.meta\.json)?$/i.test(entry.name)) continue;
            try {
                await unlink(full);
                removed += 1;
            } catch {
                /* 正在被别的进程占用就跳过 */
            }
        }
    };
    await walk(ROOT);
    if (removed) console.log(`[store] cleaned ${removed} temp file(s)`);
}

const server = Bun.serve({
    hostname: HOST,
    port: PORT,
    async fetch(req) {
        const started = Date.now();
        let response: Response;
        try {
            response = await route(req);
        } catch (error) {
            console.error(`[store] 500 ${req.method} ${req.url}`, error);
            response = json({ error: error instanceof Error ? error.message : String(error) }, 500);
        }
        const path = decodeURIComponent(new URL(req.url).pathname);
        console.log(`${new Date().toLocaleTimeString()} ${req.method} ${path} ${response.status} ${Date.now() - started}ms`);
        return response;
    },
});

console.log(`[store] listening on http://${HOST}:${PORT}`);
console.log(`[store] root: ${ROOT}`);
console.log(`[store] pid: ${process.pid}`);
await cleanTempFiles();
