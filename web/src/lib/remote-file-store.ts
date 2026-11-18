/**
 * POC：把指定命名空间的 localforage 读写重定向到本地存储服务（store-server）。
 *
 * 只实现 image-storage.ts 实际用到的方法：getItem / setItem / removeItem / iterate。
 * 任何网络错误都直接抛出，不做静默回退——回退到 IndexedDB 会让你以为数据写了磁盘。
 *
 * 另外带一层「读穿迁移」：服务端没找到时，去旧的 IndexedDB 里取，取到就补写到服务端。
 * 这样存量图片不用手工搬，打开画布时自动过去。POC 结束后这段可以整块删掉。
 */

import localforage from "localforage";

const BASE = "http://127.0.0.1:9410";

export type RemoteFileStore = {
    getItem<T = unknown>(key: string): Promise<T | null>;
    setItem<T = unknown>(key: string, value: T): Promise<T>;
    removeItem(key: string): Promise<void>;
    iterate<T = unknown, U = unknown>(callback: (value: T, key: string, iterationNumber: number) => U): Promise<U | undefined>;
};

const legacyStores = new Map<string, LocalForage>();
const inflight = new Map<string, Promise<unknown>>();

function legacyStore(namespace: string) {
    let store = legacyStores.get(namespace);
    if (!store) {
        store = localforage.createInstance({ name: "infinite-canvas", storeName: namespace });
        legacyStores.set(namespace, store);
    }
    return store;
}

function endpoint(namespace: string, key: string) {
    return `${BASE}/kv/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`;
}

function fail(action: string, key: string, detail: string): never {
    throw new Error(`[remote-storage] ${action} 失败（${key}）：${detail}。请确认 store-server 已启动（127.0.0.1:9410）。`);
}

export function remoteFileStore(namespace: string): RemoteFileStore {
    console.info(`[remote-storage] ${namespace} -> ${BASE}`);

    async function put(key: string, value: unknown) {
        const body = value instanceof Blob ? value : new Blob([JSON.stringify(value)], { type: "application/json" });
        let response: Response;
        try {
            response = await fetch(endpoint(namespace, key), {
                method: "PUT",
                body,
                headers: { "Content-Type": body.type || "application/octet-stream" },
            });
        } catch (error) {
            fail("写入", key, error instanceof Error ? error.message : String(error));
        }
        if (!response.ok) fail("写入", key, `HTTP ${response.status}`);
        return value;
    }

    async function get<T>(key: string): Promise<T | null> {
        // 同一张图会被并发请求多次（画布多处引用），第一次未命中会触发迁移上传，
        // 这里按 key 合并进行中的请求，避免重复上传同一份几 MB 的图片。
        const running = inflight.get(key);
        if (running) return running as Promise<T | null>;
        const task = read<T>(key).finally(() => inflight.delete(key));
        inflight.set(key, task);
        return task;
    }

    async function read<T>(key: string): Promise<T | null> {
        let response: Response;
        try {
            response = await fetch(endpoint(namespace, key));
        } catch (error) {
            fail("读取", key, error instanceof Error ? error.message : String(error));
        }
        if (response.status === 404) {
            const migrated = await legacyStore(namespace).getItem<T>(key);
            if (migrated) {
                console.info(`[remote-storage] 迁移 ${key}`);
                await put(key, migrated);
            }
            return migrated ?? null;
        }
        if (!response.ok) fail("读取", key, `HTTP ${response.status}`);
        const type = response.headers.get("content-type") || "";
        if (type.includes("application/json")) {
            try {
                return (await response.json()) as T;
            } catch {
                return (await response.blob()) as T;
            }
        }
        return (await response.blob()) as T;
    }

    async function listKeys(): Promise<string[]> {
        let response: Response;
        try {
            response = await fetch(`${BASE}/kv/${encodeURIComponent(namespace)}`);
        } catch (error) {
            fail("列举", namespace, error instanceof Error ? error.message : String(error));
        }
        if (!response.ok) fail("列举", namespace, `HTTP ${response.status}`);
        const { keys } = (await response.json()) as { keys: string[] };
        const legacyKeys = await legacyStore(namespace).keys();
        return Array.from(new Set([...keys, ...legacyKeys]));
    }

    return {
        setItem: put as RemoteFileStore["setItem"],
        getItem: get as RemoteFileStore["getItem"],
        async removeItem(key) {
            let response: Response;
            try {
                response = await fetch(endpoint(namespace, key), { method: "DELETE" });
            } catch (error) {
                fail("删除", key, error instanceof Error ? error.message : String(error));
            }
            if (!response.ok) fail("删除", key, `HTTP ${response.status}`);
            await legacyStore(namespace)
                .removeItem(key)
                .catch(() => undefined);
        },
        async iterate<T, U>(callback: (value: T, key: string, iterationNumber: number) => U) {
            const keys = await listKeys();
            let result: U | undefined;
            for (const [index, key] of keys.entries()) {
                const value = await get<T>(key);
                result = await callback(value as T, key, index);
            }
            return result;
        },
    };
}

/**
 * 字符串存储（zustand persist 用）。与上面的 Blob 存储区别有两点：
 * 1. setItem 收到的就是字符串，原样 PUT，不做 JSON 包装；
 * 2. 读取失败时不抛错，而是回退到浏览器存储 —— persist 在启动阶段抛错会让整个应用起不来。
 */
export type LegacyTextSource = {
    getItem(key: string): Promise<string | null> | string | null;
    setItem?(key: string, value: string): Promise<unknown> | unknown;
    removeItem?(key: string): Promise<unknown> | unknown;
};

export function remoteTextStore(namespace: string, options: { keepLegacy?: boolean; legacy?: LegacyTextSource; cleanupLegacy?: boolean } = {}) {
    console.info(`[remote-storage] ${namespace} (text) -> ${BASE}`);
    const keepLegacy = options.keepLegacy !== false;
    // 旧数据来源：画布/资产在 localforage 的 app_state，配置在 localStorage，两者不一样。
    const legacy: LegacyTextSource = options.legacy ?? {
        getItem: (key) => legacyStore(namespace).getItem<string>(key),
        setItem: (key, value) => legacyStore(namespace).setItem(key, value),
        removeItem: (key) => legacyStore(namespace).removeItem(key),
    };

    async function put(key: string, value: string) {
        let response: Response;
        try {
            response = await fetch(endpoint(namespace, key), {
                method: "PUT",
                body: value,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
        } catch (error) {
            fail("写入", key, error instanceof Error ? error.message : String(error));
        }
        if (!response.ok) fail("写入", key, `HTTP ${response.status}`);
    }

    async function get(key: string): Promise<string | null> {
        let response: Response;
        try {
            response = await fetch(endpoint(namespace, key));
        } catch (error) {
            console.warn(`[remote-storage] 读取 ${key} 失败，回退到浏览器存储`, error);
            return await legacy.getItem(key);
        }
        if (response.status === 404) {
            const migrated = await legacy.getItem(key);
            if (migrated) {
                console.info(`[remote-storage] 迁移 ${key}`);
                void put(key, migrated).catch(() => undefined);
            }
            return migrated;
        }
        if (!response.ok) {
            console.warn(`[remote-storage] 读取 ${key} 失败（HTTP ${response.status}），回退到浏览器存储`);
            return await legacy.getItem(key);
        }
        const value = await response.text();
        // 远端已就绪，清掉浏览器里的旧副本（只做一次，失败无所谓）。
        if (options.cleanupLegacy && value) {
            await Promise.resolve(legacy.removeItem?.(key)).catch(() => undefined);
        }
        return value;
    }

    return {
        getItem: get,
        async setItem(key: string, value: string) {
            await put(key, value);
            if (!keepLegacy) return;
            await Promise.resolve(legacy.setItem?.(key, value)).catch(() => undefined);
        },
        async removeItem(key: string) {
            let response: Response;
            try {
                response = await fetch(endpoint(namespace, key), { method: "DELETE" });
            } catch (error) {
                fail("删除", key, error instanceof Error ? error.message : String(error));
            }
            if (!response.ok) fail("删除", key, `HTTP ${response.status}`);
            if (!keepLegacy) return;
            await Promise.resolve(legacy.removeItem?.(key)).catch(() => undefined);
        },
    };
}
