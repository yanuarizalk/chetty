/**
 * Google Cloud Console OAuth Configuration
 *
 * Configured directly in code as specified.
 * When setting up Google Cloud Console:
 * 1. Create an OAuth 2.0 Client ID (Web Application or Chrome Extension type)
 * 2. Add Authorized Redirect URIs:
 *    - For Chrome: https://<extension-id>.chromiumapp.org/
 *    - Cross-browser extension redirect: chrome.runtime.getURL('oauth-callback.html')
 * 3. Replace GOOGLE_CLIENT_ID with your client ID from Google Cloud Console.
 */
export const GOOGLE_OAUTH_CONFIG = {
  // Replace this string with your Google Cloud Console OAuth 2.0 Client ID:
  // e.g. "1234567890-abcdefg12345.apps.googleusercontent.com"
  clientId: '1088484849202-chettygoogleoauthclientid.apps.googleusercontent.com',

  // Google OAuth 2.0 Endpoints
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  userInfoEndpoint: 'https://www.googleapis.com/oauth2/v3/userinfo',

  // Scopes requested for Gemini API and User Profile
  scopes: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/generative-language.retriever',
    'https://www.googleapis.com/auth/cloud-platform',
  ],
};
