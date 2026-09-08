import { DEFAULT_SETTINGS, type ExtensionSettings, type GeminiWebConfig } from '../types/settings';

const SETTINGS_KEY = 'chetty_settings';

export async function getSettings(): Promise<ExtensionSettings> {
  try {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    if (result && result[SETTINGS_KEY]) {
      return {
        ...DEFAULT_SETTINGS,
        ...result[SETTINGS_KEY],
        geminiWeb: {
          ...DEFAULT_SETTINGS.geminiWeb,
          ...(result[SETTINGS_KEY].geminiWeb || {}),
        },
      };
    }
  } catch (err) {
    console.warn('[Chetty] Failed to read settings, using defaults', err);
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(updates: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings();
  const updated: ExtensionSettings = {
    ...current,
    ...updates,
    geminiWeb: updates.geminiWeb ? { ...current.geminiWeb, ...updates.geminiWeb } : current.geminiWeb,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  return updated;
}

export async function updateGeminiWebConfig(updates: Partial<GeminiWebConfig>): Promise<GeminiWebConfig> {
  const current = await getSettings();
  const newConfig: GeminiWebConfig = {
    ...current.geminiWeb,
    ...updates,
  };
  await saveSettings({ geminiWeb: newConfig });
  return newConfig;
}

export async function getGeminiWebConfig(): Promise<GeminiWebConfig> {
  const settings = await getSettings();
  return settings.geminiWeb;
}

export function subscribeSettings(callback: (settings: ExtensionSettings) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === 'local' && changes[SETTINGS_KEY]) {
      const newSettings = changes[SETTINGS_KEY].newValue as ExtensionSettings;
      if (newSettings) {
        callback(newSettings);
      }
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
