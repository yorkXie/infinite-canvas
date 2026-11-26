import type { PluginAppearance } from "@infinite-canvas/plugin-sdk";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { appPreferences, preferenceKeys } from "@workbench/services/storage/preferences";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    baseTheme: ThemeName;
    theme: ThemeName;
    appearance: PluginAppearance | null;
    selection: string | null;
    setTheme: (theme: ThemeName) => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            baseTheme: "dark",
            theme: "dark",
            appearance: null,
            selection: null,
            setTheme: (baseTheme) => set({ baseTheme, selection: null }),
        }),
        {
            name: preferenceKeys.theme, storage: createJSONStorage(() => appPreferences), version: 1,
            partialize: ({ baseTheme, selection }) => ({ baseTheme, selection }),
            merge: (value, current) => {
                const saved = value as Pick<ThemeStore, "baseTheme" | "selection"> | null;
                return { ...current, ...saved, theme: saved?.baseTheme ?? current.theme };
            },
        },
    ),
);
