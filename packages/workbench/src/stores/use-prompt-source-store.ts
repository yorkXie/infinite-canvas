import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { appPreferences, preferenceKeys } from "@workbench/services/storage/preferences";

import { DEFAULT_PROMPT_SOURCES, createPromptSource, type PromptSource } from "@workbench/services/api/prompt-source-presets";

export type PromptSourceSchedule = {
    intervalMinutes: number;
    lastFetchedAt: string;
};

const PROMPT_SOURCE_STORE_KEY = preferenceKeys.promptSources;

const defaultSchedule: PromptSourceSchedule = {
    intervalMinutes: 30,
    lastFetchedAt: "",
};

export const PROMPT_SOURCE_INTERVALS = [0, 30, 60, 360, 1440];

type PromptSourceStore = {
    sources: PromptSource[];
    schedule: PromptSourceSchedule;
    addSource: () => PromptSource;
    saveSource: (source: PromptSource) => Promise<void>;
    removeSource: (id: string) => Promise<void>;
    toggleSource: (id: string, enabled: boolean) => Promise<void>;
    updateSchedule: <K extends keyof PromptSourceSchedule>(key: K, value: PromptSourceSchedule[K]) => Promise<void>;
    saveConfig: (config: PromptSourceConfig) => Promise<void>;
};

type PromptSourceConfig = Pick<PromptSourceStore, "sources" | "schedule">;
const preferences = createJSONStorage<PromptSourceConfig>(() => appPreferences)!;

const createPromptSourceState: StateCreator<PromptSourceStore, [], [["zustand/persist", PromptSourceConfig]]> = (publish, get, api) => {
    let previous = Promise.resolve();
    const save = (change: (current: PromptSourceConfig) => Partial<PromptSourceConfig>) => {
        const receipt = previous.then(async () => {
            const { sources, schedule } = get();
            const state = { sources, schedule, ...change({ sources, schedule }) };
            await preferences.setItem(PROMPT_SOURCE_STORE_KEY, { state, version: 0 });
            publish(state);
        });
        previous = receipt.catch(() => {});
        return receipt;
    };
    return persist<PromptSourceStore, [], [], PromptSourceConfig>(
        () => ({
            sources: DEFAULT_PROMPT_SOURCES,
            schedule: defaultSchedule,
            addSource: () => createPromptSource(),
            saveSource: (source) => save(({ sources }) => ({
                sources: sources.some((item) => item.id === source.id)
                    ? sources.map((item) => (item.id === source.id && !item.builtIn ? createPromptSource(source) : item))
                    : [...sources, createPromptSource(source)],
            })),
            removeSource: (id) => save(({ sources }) => ({ sources: sources.filter((item) => item.id !== id || item.builtIn) })),
            toggleSource: (id, enabled) => save(({ sources }) => ({ sources: sources.map((item) => item.id === id ? { ...item, enabled } : item) })),
            updateSchedule: (key, value) => save(({ schedule }) => ({ schedule: { ...schedule, [key]: value } })),
            saveConfig: (config) => save(() => config),
        }),
        {
            name: PROMPT_SOURCE_STORE_KEY,
            storage: preferences,
            partialize: (state) => ({ sources: state.sources, schedule: state.schedule }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<PromptSourceStore>;
                const savedSources = Array.isArray(persistedState.sources) ? persistedState.sources : [];
                const enabledById = new Map(savedSources.map((source) => [source.id, source.enabled]));
                const builtIn = DEFAULT_PROMPT_SOURCES.map((source) => ({ ...source, enabled: enabledById.get(source.id) ?? source.enabled }));
                const custom = savedSources.filter((source) => !source.builtIn).map((source) => createPromptSource(source));
                return { ...current, sources: [...builtIn, ...custom], schedule: { ...defaultSchedule, ...(persistedState.schedule || {}) } };
            },
        },
    )(publish, get, api);
};

export const usePromptSourceStore = create<PromptSourceStore>()(createPromptSourceState);
