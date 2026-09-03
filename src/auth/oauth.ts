import { GOOGLE_OAUTH_CONFIG } from './config';

/**
 * Generate a cryptographically random code verifier for PKCE (RFC 7636)
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Generate SHA-256 code challenge from code verifier
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Get extension OAuth redirect URI
 */
export function getOAuthRedirectUri(): string {
  if (typeof chrome !== 'undefined' && chrome.identity?.getRedirectURL) {
    try {
      return chrome.identity.getRedirectURL('oauth-callback.html');
    } catch {
      // Fallback
    }
  }
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL('oauth-callback.html');
  }
  return 'http://localhost/oauth-callback';
}

/**
 * Build Google OAuth 2.0 Authorization URL with PKCE
 */
export async function buildGoogleAuthUrl(verifier: string, state: string): Promise<string> {
  const challenge = await generateCodeChallenge(verifier);
  const redirectUri = getOAuthRedirectUri();

  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CONFIG.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_CONFIG.scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: state,
    access_type: 'offline',
    prompt: 'consent',
  });

  return `${GOOGLE_OAUTH_CONFIG.authEndpoint}?${params.toString()}`;
}

/**
 * Exchange Authorization Code for Access Token
 */
export async function exchangeCodeForTokens(code: string, verifier: string): Promise<{
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}> {
  const redirectUri = getOAuthRedirectUri();

  const body = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CONFIG.clientId,
    grant_type: 'authorization_code',
    code: code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });

  const response = await fetch(GOOGLE_OAUTH_CONFIG.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600,
    refreshToken: data.refresh_token,
  };
}

/**
 * Fetch Google User Profile using Access Token
 */
export async function fetchGoogleUserProfile(accessToken: string): Promise<{
  id: string;
  email: string;
  name: string;
  picture?: string;
}> {
  const response = await fetch(GOOGLE_OAUTH_CONFIG.userInfoEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user profile: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    id: data.sub || data.id,
    email: data.email || 'user@google.com',
    name: data.name || data.email || 'Google User',
    picture: data.picture,
  };
}
