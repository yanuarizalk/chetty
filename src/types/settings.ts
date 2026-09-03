import type { FloatingMode } from './session';
export type { FloatingMode };

export type ThemeMode = 'dark' | 'light';

export interface UserProfile {
  id?: string;
  email: string;
  name: string;
  picture?: string;
}

export interface UserAuth {
  isAuthenticated: boolean;
  accessToken: string | null;
  expiresAt: number | null;
  profile: UserProfile | null;
}

export interface ExtensionSettings {
  theme: ThemeMode;
  opacity: number; // 0.5 to 1.0
  defaultFloatingMode: FloatingMode;
  model: string;
  auth: UserAuth;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  theme: 'dark',
  opacity: 0.95,
  defaultFloatingMode: 'fixed',
  model: 'gemini-2.5-flash',
  auth: {
    isAuthenticated: false,
    accessToken: null,
    expiresAt: null,
    profile: null,
  },
};
