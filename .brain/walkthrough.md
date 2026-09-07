# Chetty - Spec-Driven Cross-Browser Floating Chatbot Extension

Chetty is a cross-browser extension built using **WXT** (Manifest V3) that injects customizable, draggable, resizable, and dockable floating chatbot windows directly into web pages. It features the **Deep-Chat** UI, **Gemini AI** integration powered by the user's signed-in Google access token, multi-session management with real-time cross-tab synchronization, and rich context gathering engines.

---

## Key Features Implemented

### 1. Floating Window & Manipulation
- **Encapsulated Shadow DOM (`chetty-shadow-host`)**: Complete CSS isolation from host web pages, preventing page stylesheets from breaking the chatbox or malicious scripts from accessing it.
- **Draggable Header**: Fluid drag positioning with viewport bounds constraints.
- **Dynamic Resizing**: Corner and edge resize handles with min/max dimensions.
- **Minimizable Pill**: Shrinks the chatbox to a sleek floating badge displaying the session title; clicking restores the window to its exact position and dimensions.
- **Sticky vs. Fixed Floating Toggle**:
  - `📌 Fixed`: Remains static on the screen viewport.
  - `📜 Sticky`: Anchored relative to document scrolling.
- **Side Docking & Pinning Viewport Reflow**:
  - Dragging within 35px of the left or right screen edge snaps the chatbox to the side.
  - **Pin Toggle**: When docked, toggling `📍 Pin` applies margin/width adjustments to the host document so webpage content reflows smoothly without being obscured; `🔓 Unpin` floats over the page.

### 2. Deep-Chat UI Integration
- Direct integration of `<deep-chat>` custom element with custom message bubbles, dark/light themes, input area styling, and streaming token responses.
- Streaming responses from Gemini with automatic Markdown formatting.

### 3. Context Gathering Engine
- **📄 Current Tab Context**: Uses `@extractus/article-extractor` to extract clean main text, title, author, and description, with smart DOM text and active user text selection fallback.
- **🎯 Element Boundary (Inspect Mode)**: Activates interactive DOM element inspection with a glowing outline, tag badge (`<div.article> (350 words)`), click-to-capture, and `Escape` key cancel.
- **📑 Cross-Tab Context**: Queries open tabs across the browser window and extracts content from another tab.
- **🚫 No Context**: Pure conversational chatbot mode.

### 4. Cross-Browser Google SSO OAuth (User Access Token Only)
- Pre-configured Google OAuth 2.0 PKCE client in code (`src/auth/config.ts`) — zero manual client ID configuration required by end users.
- Standard cross-browser OAuth flow (compatible across Chrome, Firefox, Safari, Edge; no `chrome.identity`).
- Automatically signs requests to the Google Generative Language API using `Authorization: Bearer <user_access_token>`.
- Token expiry check with buffer and user profile card (name, email, avatar).

### 5. Multi-Session & Cross-Tab Real-time Sync
- Persistent sessions stored in `chrome.storage.local`.
- Multi-session capability: A single tab can have multiple floating windows open at once.
- Real-time synchronization via `storage.onChanged`: Any message sent in a session from Tab A immediately updates all open windows of that session on Tab B.

### 6. Toolbar Popup Menu
- Extension branding, version badge, and GitHub source link.
- **Start New Session**: Immediately opens a floating chatbot on the active tab.
- **Show Another Session**: Dropdown selector of existing sessions to open on the active tab.
- **Default Floating Mode Switch**: Fixed vs Sticky.
- **Chatbox Opacity Slider**: 50% to 100%.
- **Appearance Theme**: Dark 🌙 / Light ☀️.
- **Google SSO OAuth Card**: 1-click Sign In / Sign Out with profile preview.
- **Permissions Auditor**: Verifies active permissions and provides 1-click request links if missing.

### 7. Modular AI Provider Architecture
- `IChatProvider` interface decoupling AI models from the UI.
- `GeminiChatProvider` implementing multi-turn history formatting, context injection, and SSE streaming token decoding.
- Ready for future providers (OpenAI, Anthropic, Ollama, etc.) via `providerRegistry`.

---

## Build Verification

Both Chrome MV3 and Firefox targets build with zero errors:

```bash
# Type check:
pnpm run compile  # Exit code 0 (0 errors)

# Chrome MV3 Build:
pnpm run build    # Built in 902 ms -> .output/chrome-mv3

# Firefox Build:
pnpm exec wxt build -b firefox  # Built in 855 ms -> .output/firefox-mv2
```

Build artifact structure:
```
.output/chrome-mv3/
├── manifest.json
├── popup.html
├── oauth-callback.html
├── background.js
├── content-scripts/
│   └── content.js
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── assets/
    └── popup.css
```

---

## How to Load the Extension in Your Browser

### In Google Chrome / Brave / Edge:
1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the directory:
   `D:\Projects\chetty\.output\chrome-mv3`
5. The **Chetty** icon will appear in your toolbar!

### In Mozilla Firefox:
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `d:\Projects\chetty\.output\firefox-mv2\manifest.json`.

---

## Setting Up Google Cloud OAuth (One-Time Developer Step)
In `src/auth/config.ts`:
1. In your [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth 2.0 Client ID** (Web application).
2. Add your extension's redirect URI to **Authorized redirect URIs**:
   - `chrome.runtime.getURL('oauth-callback.html')`
   - e.g., `chrome-extension://<extension-id>/oauth-callback.html`
3. Paste your Client ID into `src/auth/config.ts`:
   ```typescript
   export const GOOGLE_OAUTH_CONFIG = {
     clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
     ...
   };
   ```
4. Rebuild with `pnpm run build`.
