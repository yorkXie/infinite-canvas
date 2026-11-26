import { storage } from "./runtime";

export const preferenceKeys = {
    config: "infinite-canvas-v1:ai_config_store",
    theme: "infinite-canvas-v1:theme_store",
    canvasPanel: "infinite-canvas:canvas_side_panel_v2",
    agentPanel: "infinite-canvas:agent_panel",
    pluginLayout: "infinite-canvas:plugin-selection",
    promptSources: "infinite-canvas-v1:prompt_source_store",
    sidebar: "workbench-sidebar-collapsed",
    imageToolbar: "canvas-image-toolbar-preferences",
} as const;

// 工作区先加载已确认的值，Zustand 和普通组件首次渲染时都能同步读取。
const saved = new Map<string, string>();
const pending = new Map<string, { value: string | null; receipt: Promise<void> }>();

export function rememberPreference(key: string, value: unknown) {
    if (value === null) saved.delete(key);
    else saved.set(key, JSON.stringify(value));
}

function writeLocal(key: string, value: string | null) {
    const active = pending.get(key);
    if (active?.value === value) return active.receipt;
    if (!active && (saved.get(key) ?? null) === value) return;

    const data = value === null ? null : JSON.parse(value);
    const write = value === null ? storage.preferences.removeItem(key) : storage.preferences.setItem(key, data);
    const receipt = write.then(() => rememberPreference(key, data));
    pending.set(key, { value, receipt });
    const finish = () => { if (pending.get(key)?.receipt === receipt) pending.delete(key); };
    void receipt.then(finish, finish);
    return receipt;
}

export const appPreferences = {
    getItem(key: string) {
        if (storage?.kind !== "server") return localStorage.getItem(key);
        const active = pending.get(key);
        return active ? active.value : saved.get(key) ?? null;
    },
    setItem(key: string, value: string) {
        if (storage?.kind !== "server") return localStorage.setItem(key, value);
        return writeLocal(key, value);
    },
    removeItem(key: string) {
        if (storage?.kind !== "server") return localStorage.removeItem(key);
        return writeLocal(key, null);
    },
    get saving() { return pending.size > 0; },
    async flush() {
        while (pending.size) await Promise.all([...pending.values()].map(({ receipt }) => receipt));
    },
};
