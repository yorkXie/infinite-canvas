import { runPluginCommand } from "./plugins.js";
import path from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import open from "open";
import { startLocalServer, type LocalWeb } from "@infinite-canvas/server";
import { startMcpServer } from "@infinite-canvas/server/server/mcp";
import { DEFAULT_PORT } from "@infinite-canvas/server/config";
import { logger } from "@infinite-canvas/server/utils/logger";
import { StorageError } from "@infinite-canvas/shared/storage-data";

export async function runCli(web: LocalWeb, entryUrl: string) {
    const desktop = process.env.INFINITE_CANVAS_DESKTOP_HOST === "1" && typeof process.send === "function";
    try {
        const repoRoot = fileURLToPath(new URL("../../../", entryUrl));
        const defaultDirectory = existsSync(path.join(repoRoot, "apps", "cli", "package.json"))
            ? path.join(repoRoot, "infinite-canvas-1.0-data")
            : path.join(homedir(), ".infinite-canvas", "workspace");
        const { values, positionals } = parseArgs({
            allowPositionals: true,
            options: { registry: { type: "string" }, "data-dir": { type: "string", default: defaultDirectory }, port: { type: "string", default: String(DEFAULT_PORT) }, open: { type: "boolean" }, "quit-on-q": { type: "boolean" }, "skip-plugins": { type: "boolean" }, help: { type: "boolean", short: "h" }, debug: { type: "boolean" } },
        });
        const dataDirectory = path.resolve(values["data-dir"]);
        if (values.debug && !values.help) logger.enableDebug(dataDirectory);
        if (values.help) {
            console.log("用法：infinite-canvas serve [--data-dir <目录>] [--port <端口>] [--open] [--quit-on-q] [--skip-plugins]\n      infinite-canvas mcp [--data-dir <目录>]\n      infinite-canvas plugin add|update|remove|enable|disable|list|registry\n\nserve 启动画布并把业务数据保存在目录中；mcp 连接已启动的服务。\n--quit-on-q 允许在启动窗口输入 Q 并回车退出。\n--skip-plugins 本次跳过第三方插件启动，保留数据和启用选择，可在插件设置中逐个重新启用。\n需要 Node.js 22 或更高版本。按 Ctrl+C 停止服务。");
        } else if (positionals[0] === "plugin") {
            await runPluginCommand(positionals.slice(1), dataDirectory, values.registry);
        } else if (positionals.length === 1 && positionals[0] === "mcp") {
            await startMcpServer(dataDirectory);
        } else if (positionals.length === 0 || positionals.length === 1 && positionals[0] === "serve") {
            const port = Number(values.port);
            if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("INVALID_PORT");
            const development = entryUrl.endsWith(".ts");
            const mcp = {
                command: process.execPath,
                args: [...(development ? ["--import", import.meta.resolve("tsx")] : []), fileURLToPath(entryUrl), "mcp", "--data-dir", dataDirectory],
                ...(desktop && { env: { ELECTRON_RUN_AS_NODE: "1" } }),
            };
            const urlFile = path.join(dataDirectory, ".canvas.url");
            const service = await startLocalServer({ dataDirectory, web, port, skipThirdPartyPlugins: values["skip-plugins"], mcp }).catch(async (error) => {
                // 同一目录已有服务在运行时直接复用它，不再启动第二个进程。
                if (desktop || !(error instanceof StorageError && error.code === "WORKSPACE_LOCKED")) throw error;
                const url = await readFile(urlFile, "utf8").catch(() => "");
                if (!url || !await fetch(`${url}/health`).then((response) => response.ok, () => false)) throw error;
                return url;
            });
            if (typeof service === "string") {
                console.log(`无限画布已在运行，直接使用已有服务\n打开地址：${service}\n数据目录：${dataDirectory}`);
                if (values.open) await open(service).catch(() => console.error("未能自动打开浏览器，请复制上方地址打开。"));
                return;
            }
            try {
                await writeFile(urlFile, service.url);
            } catch (error) {
                await service.close();
                throw error;
            }
            let input: ReturnType<typeof createInterface> | undefined;
            const stop = () => {
                if (input) {
                    input.close();
                    process.stdin.destroy();
                }
                void service.close().catch(() => { console.error("停止保存时遇到问题，请保留数据目录后重试。"); process.exitCode = 1; }).finally(() => { if (desktop && process.connected) process.disconnect(); });
            };
            process.once("SIGINT", stop);
            process.once("SIGTERM", stop);
            if (desktop) {
                process.once("disconnect", stop);
                if (!process.connected) { await service.close(); return; }
                process.send!({ type: "ready", url: service.url }, (error: Error | null) => { if (error) stop(); });
                return;
            }
            console.log(`无限画布\n打开地址：${service.url}\n数据目录：${dataDirectory}\nMCP 地址：${service.url}/mcp`);
            console.log(JSON.stringify({ mcpServers: { "infinite-canvas": mcp } }, null, 2));
            if (values["quit-on-q"]) {
                input = createInterface({ input: process.stdin, terminal: false });
                input.on("line", (line) => { if (line.trim().toLowerCase() === "q") stop(); });
                console.log("在此窗口输入 Q 并按回车，保存并退出无限画布。");
            }
            if (values.open) await open(service.url).catch(() => console.error("未能自动打开浏览器，请复制上方地址打开。"));
        } else {
            throw new Error("INVALID_COMMAND");
        }
    } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : error instanceof Error ? error.message : "";
        const messages: Record<string, string> = {
            EADDRINUSE: "端口已被占用，请停止已有程序，或使用 --port 选择其他端口。",
            ENOENT: "找不到启动所需文件，请检查安装是否完整。",
            MCP_WORKSPACE_UNAVAILABLE: "找不到这个工作区的 MCP 连接信息，请先用相同的 --data-dir 启动工作台。",
            INVALID_PORT: "端口必须是 1 到 65535 之间的整数。",
            INVALID_COMMAND: "未知命令，请运行 infinite-canvas --help 查看用法。",
        };
        const message = error instanceof StorageError ? error.message : messages[String(code)] ?? "无法启动画布，请检查命令参数和数据目录权限。";
        console.error(message);
        if (desktop && process.connected) process.send!({ type: "failed", code: String(code) }, () => { if (process.connected) process.disconnect(); });
        process.exitCode = 1;
    }
}
