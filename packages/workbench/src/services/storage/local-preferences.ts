import { archivePreferencesSchema } from "@infinite-canvas/shared/work-archive";
import { appDatabase, openDatabase, readIDBRequest } from "@workbench/utils/indexed-db";
import { browserStores } from "./browser-stores";
import type { LocalStorageAdapter } from "./http";
import { preferenceKeys, rememberPreference } from "./preferences";

const migrationKey = "browser-preferences-import-v1";
const settings = new Set<string>(Object.values(preferenceKeys));

function oldSetting(key: string, raw: string) {
    try {
        const value = JSON.parse(raw);
        if (key === preferenceKeys.sidebar) return value === 0 || value === 1 ? value : null;
        if (!value || typeof value !== "object") return null;
        if (key === preferenceKeys.imageToolbar) return value.visibility && typeof value.visibility === "object" ? value : null;
        if (!value.state || typeof value.state !== "object") return null;
        if (key === preferenceKeys.config) {
            if (!value.state.config) return null;
            Object.assign(value.state.config, { channels: [], models: [], baseUrl: "", apiKey: "" });
        }
        return value;
    } catch { return null; }
}

async function openOldDatabase() {
    try {
        // 浏览器禁用网站存储时也能从磁盘使用工作台。
        if (!window.indexedDB) return undefined;
        if (indexedDB.databases && !(await indexedDB.databases()).some(({ name }) => name === appDatabase)) return null;
        return await openDatabase(appDatabase);
    } catch (error) {
        if (error instanceof DOMException && (error.name === "SecurityError" || error.name === "InvalidStateError")) return undefined;
        throw error;
    }
}

export async function loadLocalPreferences(adapter: LocalStorageAdapter) {
    const existing = new Set<string>();
    await adapter.preferences.iterate<unknown, void>((value, key) => {
        existing.add(key);
        if (settings.has(key)) rememberPreference(key, value);
    });
    if (existing.has(migrationKey)) return;

    let complete = true;
    for (const key of settings) {
        if (existing.has(key)) continue;
        let raw: string | null;
        try { raw = localStorage.getItem(key); } catch { complete = false; break; }
        if (raw === null) continue;
        const value = oldSetting(key, raw);
        if (value !== null) rememberPreference(key, (await adapter.seedPreference("preferences", key, value)).value);
    }

    const db = await openOldDatabase();
    if (db === undefined) complete = false;
    if (db) {
        try {
            for (const collection of ["preferences", "promptCache"] as const) {
                const name = browserStores[collection];
                if (!db.objectStoreNames.contains(name)) continue;
                const store = () => db.transaction(name, "readonly").objectStore(name);
                for (const key of await readIDBRequest(store().getAllKeys())) {
                    if (typeof key !== "string") continue;
                    if (collection === "preferences") {
                        if (existing.has(key) || key === "deletedProjects" || !/^[\w-]+$/.test(key) || !await adapter.projects.getItem(key)) continue;
                    } else if (!key.startsWith("prompt-source:")) continue;
                    const value = await readIDBRequest(store().get(key));
                    if (value == null || (collection === "preferences" && !archivePreferencesSchema.safeParse(value).success)) continue;
                    try {
                        await adapter.seedPreference(collection, key, value);
                    } catch (error) {
                        if (collection !== "promptCache") throw error;
                        // 可重建的缓存写入失败时仍可打开画布，下次启动继续补齐。
                        complete = false;
                    }
                }
            }
        } finally { db.close(); }
    }
    if (complete) await adapter.seedPreference("preferences", migrationKey, true);
}
