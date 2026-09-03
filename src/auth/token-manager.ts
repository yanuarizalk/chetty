import { buildGoogleAuthUrl, exchangeCodeForTokens, fetchGoogleUserProfile, generateCodeVerifier, getOAuthRedirectUri } from './oauth';
import { clearAuth, getSettings, updateAuth } from '../storage/settings-store';
import type { UserProfile } from '../types/settings';

const PENDING_OAUTH_KEY = 'chetty_pending_oauth';

interface PendingOAuth {
  verifier: string;
  state: string;
  timestamp: number;
}

export async function getValidAccessToken(): Promise<string | null> {
  const settings = await getSettings();
  const auth = settings.auth;
  if (!auth || !auth.isAuthenticated || !auth.accessToken) {
    return null;
  }

  // Check if token expired (with 60s buffer)
  if (auth.expiresAt && Date.now() > auth.expiresAt - 60000) {
    console.warn('[Chetty] Access token has expired');
    return null;
  }

  return auth.accessToken;
}

/**
 * Cross-browser Sign-in with Google
 */
export async function signInWithGoogle(): Promise<UserProfile> {
  const verifier = generateCodeVerifier();
  const state = Math.random().toString(36).substring(2) + Date.now().toString(36);

  // Save pending state for verification
  const pending: PendingOAuth = {
    verifier,
    state,
    timestamp: Date.now(),
  };
  await chrome.storage.local.set({ [PENDING_OAUTH_KEY]: pending });

  const authUrl = await buildGoogleAuthUrl(verifier, state);

  // Strategy 1: Try browser.identity.launchWebAuthFlow if available (standard in MV3)
  if (typeof chrome !== 'undefined' && chrome.identity?.launchWebAuthFlow) {
    try {
      const redirectUrl = await new Promise<string>((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
          {
            url: authUrl,
            interactive: true,
          },
          (responseUrl) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!responseUrl) {
              reject(new Error('Authorization was cancelled'));
            } else {
              resolve(responseUrl);
            }
          }
        );
      });

      return await handleAuthRedirectUrl(redirectUrl, verifier, state);
    } catch (err) {
      console.warn('[Chetty] launchWebAuthFlow failed or cancelled, falling back to tab flow:', err);
      // If launchWebAuthFlow failed due to user cancel, rethrow
      const msg = String(err);
      if (msg.includes('cancelled') || msg.includes('canceled')) {
        throw err;
      }
    }
  }

  // Strategy 2: Universal cross-browser tab flow
  // Opens the Google Auth tab, which will redirect to oauth-callback.html
  const tab = await chrome.tabs.create({ url: authUrl });
  
  // Wait for callback via storage listener or tab update
  return new Promise<UserProfile>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.storage.onChanged.removeListener(storageListener);
      reject(new Error('Authentication timed out after 3 minutes'));
    }, 180000);

    const storageListener = async (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes['chetty_settings']?.newValue?.auth?.isAuthenticated) {
        clearTimeout(timeout);
        chrome.storage.onChanged.removeListener(storageListener);
        const settings = await getSettings();
        if (settings.auth.profile) {
          resolve(settings.auth.profile);
        } else {
          resolve({ email: 'user@google.com', name: 'Google User' });
        }
      }
    };

    chrome.storage.onChanged.addListener(storageListener);
  });
}

/**
 * Handle redirect URL from OAuth callback
 */
export async function handleAuthRedirectUrl(redirectUrl: string, verifier?: string, expectedState?: string): Promise<UserProfile> {
  const url = new URL(redirectUrl);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    throw new Error(`OAuth error: ${error}`);
  }

  if (!code) {
    // Check if token was in hash (implicit)
    const hash = url.hash.substring(1);
    const hashParams = new URLSearchParams(hash);
    const hashToken = hashParams.get('access_token');
    const expiresIn = Number(hashParams.get('expires_in')) || 3600;

    if (hashToken) {
      const profile = await fetchGoogleUserProfile(hashToken);
      await updateAuth({
        isAuthenticated: true,
        accessToken: hashToken,
        expiresAt: Date.now() + expiresIn * 1000,
        profile,
      });
      return profile;
    }

    throw new Error('No authorization code or token found in redirect');
  }

  // Retrieve verifier if not provided
  let activeVerifier = verifier;
  if (!activeVerifier) {
    const pendingData = await chrome.storage.local.get(PENDING_OAUTH_KEY);
    const pending = pendingData[PENDING_OAUTH_KEY] as PendingOAuth | undefined;
    if (pending) {
      activeVerifier = pending.verifier;
      if (expectedState && pending.state !== expectedState) {
        throw new Error('OAuth state mismatch security error');
      }
    }
  }

  if (!activeVerifier) {
    throw new Error('Missing OAuth code verifier');
  }

  const tokenData = await exchangeCodeForTokens(code, activeVerifier);
  const profile = await fetchGoogleUserProfile(tokenData.accessToken);

  await updateAuth({
    isAuthenticated: true,
    accessToken: tokenData.accessToken,
    expiresAt: Date.now() + tokenData.expiresIn * 1000,
    profile,
  });

  // Clean up pending state
  await chrome.storage.local.remove(PENDING_OAUTH_KEY);

  return profile;
}

export async function signOut(): Promise<void> {
  await clearAuth();
}
