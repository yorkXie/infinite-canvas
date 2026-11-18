import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

import { remoteTextStore } from "@/lib/remote-file-store";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

/**
 * 回滚开关。
 * true  -> 画布结构 / 资产 / 插件状态写到本地存储服务（store-server）
 * false -> 完全回到浏览器 IndexedDB，行为和改造前一致
 */
const USE_REMOTE_STORE = true;

const legacyStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await localforage.getItem<string>(name)) || null;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.setItem(name, value);
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};

export const localForageStorage: StateStorage = USE_REMOTE_STORE
    ? (remoteTextStore("app_state") as StateStorage)
    : legacyStorage;
