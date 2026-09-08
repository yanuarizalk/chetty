# Walkthrough - Gemini Web Tab Simulation & Zero OAuth Integration

Chetty has transitioned to automating the user's active **Gemini Web (`gemini.google.com`)** tab, eliminating all OAuth scopes, client IDs, and external Google Cloud configurations.

---

## Key Changes Implemented

### 1. Zero OAuth & Clean Permissions
- **Deleted All OAuth Logic**: Completely removed `src/auth/` and `entrypoints/oauth-callback/`.
- **Manifest Cleared**: Removed `identity` permission from `wxt.config.ts`.
- **Cross-Browser MV3 Compatible**: Retained only standard MV3 permissions (`storage`, `tabs`, `activeTab`, `scripting`) and `<all_urls>`.

### 2. Provider-Driven Popup UI (`Select Gemini Active Web`)
- In `src/types/provider.ts`, added `renderPopupSettings?(container: HTMLElement): Promise<void> | void` to `IChatProvider`.
- `GeminiChatProvider` implements `renderPopupSettings`:
  - Scans open browser tabs for `gemini.google.com`.
  - Presents an active tab selector dropdown with real-time status badges (`Connected`, `Busy Generating`, `Offline`).
  - Provides a quick 🔄 refresh button and 🌐 "Open gemini.google.com" action.
  - Extension popup dynamically mounts the active provider's configuration card into `#provider-settings-container`.

### 3. Session-to-Gemini URL Mapping
- New Chetty sessions start clean on `https://gemini.google.com/app`.
- On the first prompt in a session, the background automation script detects the newly created Gemini conversation URL (`https://gemini.google.com/app/<id>`) and persists `geminiConversationId` to the Chetty session in storage.
- When prompting in an existing session later, the automation script ensures the Gemini tab is navigated to `https://gemini.google.com/app/<id>`, preserving full multi-turn conversation context directly on Google's platform.

### 4. Background DOM Automation Broker
- In `entrypoints/background.ts`, handles `CHETTY_GEMINI_AUTOMATE_PROMPT`:
  - **Input Targeting**: Targets `rich-textarea div[contenteditable="true"]`, `div[contenteditable="true"][role="textbox"]`, or `textarea`.
  - **Text Injection**: Uses `document.execCommand('insertText')` and dispatches `beforeinput`, `input`, and `change` events so Gemini's Angular/framework state recognizes the new prompt.
  - **Send Dispatch**: Dispatches Enter key and clicks `button[aria-label*="Send"]`.
  - **Response Streaming & Polling**: Observes model output containers (`message-content`, `model-response`, `[data-message-author-role="model"]`), polling periodically and streaming incremental chunks back to the floating chatbox.
  - **Completion Detection**: Watches the generation state until the Stop/Cancel button disappears and output stabilizes.

### 5. Synchronous Execution & Global Mutex
- Since prompts share the user's active Gemini web tab, generation runs **synchronously**:
  - Global `isBusy` flag in settings prevents concurrent prompt submissions across windows or tabs.
  - All floating chatbox instances subscribe to settings and display a sticky amber busy banner (`⏳ Gemini Web is generating... / Input locked`).
  - Attempts to prompt while busy immediately notify the user to wait until generation finishes.

---

## Build & Compile Verification

Both targets compile and build without warnings or errors:

```bash
# TypeScript Compile Check
pnpm run compile
# Exit code 0 (0 errors)

# Multi-Browser MV3 Builds
pnpm run build:all
# Chrome MV3: Built in 1.72s -> .output/chrome-mv3 (manifest.json, background.js, content.js, popup.html)
# Firefox MV3: Built in 1.23s -> .output/firefox-mv3 (manifest.json with background.scripts, content.js, popup.html)
```

---

## How to Test

1. **Load Extension in Chrome or Firefox**:
   - **Chrome**: Go to `chrome://extensions` -> **Developer mode** -> **Load unpacked** -> select `chetty/.output/chrome-mv3`.
   - **Firefox**: Go to `about:debugging#/runtime/this-firefox` -> **Load Temporary Add-on** -> select `chetty/.output/firefox-mv3/manifest.json`.
2. **Open Gemini**:
   - Open a tab with `https://gemini.google.com/app` and ensure you are signed in.
3. **Select Active Gemini Tab**:
   - Click Chetty's toolbar icon.
   - The provider card shows **✦ Select Gemini Active Web** with your active Gemini tab detected and status **Connected**.
4. **Open a Chatbox Session**:
   - Click **Start New Session**. The floating window opens over the active webpage.
5. **Send a Prompt**:
   - Ask Chetty a question. Chetty injects the prompt into the active Gemini web tab, clicks send, streams the response in real-time to the floating box, and locks input across all tabs while generating.
