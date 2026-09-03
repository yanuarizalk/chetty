import { DEFAULT_SETTINGS, type ExtensionSettings, type UserAuth } from '../types/settings';

const SETTINGS_KEY = 'chetty_settings';

export async function getSettings(): Promise<ExtensionSettings> {
  try {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    if (result && result[SETTINGS_KEY]) {
      return {
        ...DEFAULT_SETTINGS,
        ...result[SETTINGS_KEY],
        auth: {
          ...DEFAULT_SETTINGS.auth,
          ...(result[SETTINGS_KEY].auth || {}),
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
    auth: updates.auth ? { ...current.auth, ...updates.auth } : current.auth,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  return updated;
}

export async function updateAuth(auth: Partial<UserAuth>): Promise<UserAuth> {
  const current = await getSettings();
  const newAuth: UserAuth = {
    ...current.auth,
    ...auth,
  };
  await saveSettings({ auth: newAuth });
  return newAuth;
}

export async function clearAuth(): Promise<void> {
  await updateAuth({
    isAuthenticated: false,
    accessToken: null,
    expiresAt: null,
    profile: null,
  });
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
