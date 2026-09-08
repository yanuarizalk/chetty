import type { FloatingMode } from './session';
export type { FloatingMode };

export type ThemeMode = 'dark' | 'light';

export interface GeminiWebConfig {
  selectedTabId: number | null;
  selectedTabTitle: string | null;
  isBusy: boolean;
  busySessionId?: string | null;
}

export interface ExtensionSettings {
  theme: ThemeMode;
  opacity: number; // 0.5 to 1.0
  defaultFloatingMode: FloatingMode;
  geminiWeb: GeminiWebConfig;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  theme: 'dark',
  opacity: 0.95,
  defaultFloatingMode: 'fixed',
  geminiWeb: {
    selectedTabId: null,
    selectedTabTitle: null,
    isBusy: false,
    busySessionId: null,
  },
};
