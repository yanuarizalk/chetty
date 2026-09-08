# Walkthrough - Gemini Web Tab Simulation, Zero OAuth & Native Chat UI

Chetty has transitioned to automating the user's active **Gemini Web (`gemini.google.com`)** tab, eliminating all OAuth scopes, client IDs, and external Google Cloud configurations, and now includes a **dedicated native chat input & message UI**.

---

## Key Changes Implemented

### 1. Dedicated Native Chat Input Footer & Message UI
- **First-Class Input in Chatbox Layout**:
  - Added `.chetty-footer` with an auto-resizing `<textarea id="input-${this.session.id}">` and a modern paper plane Send button `<button id="btn-send-${this.session.id}">`.
  - **Auto-Expanding Textarea**: Textarea grows dynamically up to 120px as the user types multi-line messages, and resets on submit.
  - **Keyboard Shortcuts**: `Enter` immediately submits the message; `Shift + Enter` inserts a newline.
  - **Empty State & Suggestion Chips**: Shows a welcome card with actionable suggestion chips ("Summarize this page", "Key takeaways", "Explain in simple terms") when a new session has no messages.
  - **Bubble UI**: Clean user messages with context tags, and AI response cards with typing indicator (`.chetty-cursor`), code block formatting, and timestamps.
  - **Lighter Footprint**: Replaced the bulky Web Component dependency with native content-script DOM rendering, cutting `content.js` bundle size from **738 KB down to 290 KB**.

### 2. Zero OAuth & Clean Permissions
- **Deleted All OAuth Logic**: Completely removed `src/auth/` and `entrypoints/oauth-callback/`.
- **Manifest Cleared**: Removed `identity` permission from `wxt.config.ts`.
- **Cross-Browser MV3 Compatible**: Retained only standard MV3 permissions (`storage`, `tabs`, `activeTab`, `scripting`) and `<all_urls>`.

### 3. Provider-Driven Popup UI (`Select Gemini Active Web`)
- In `src/types/provider.ts`, added `renderPopupSettings?(container: HTMLElement): Promise<void> | void` to `IChatProvider`.
- `GeminiChatProvider` implements `renderPopupSettings`:
  - Scans open browser tabs for `gemini.google.com`.
  - Presents an active tab selector dropdown with real-time status badges (`Connected`, `Busy Generating`, `Offline`).
  - Provides a quick 🔄 refresh button and 🌐 "Open gemini.google.com" action.
  - Extension popup dynamically mounts the active provider's configuration card into `#provider-settings-container`.

### 4. Session-to-Gemini URL Mapping
- New Chetty sessions start clean on `https://gemini.google.com/app`.
- On the first prompt in a session, the background automation script detects the newly created Gemini conversation URL (`https://gemini.google.com/app/<id>`) and persists `geminiConversationId` to the Chetty session in storage.
- When prompting in an existing session later, the automation script ensures the Gemini tab is navigated to `https://gemini.google.com/app/<id>`, preserving full multi-turn conversation context directly on Google's platform.

### 5. Background DOM Automation Broker
- In `entrypoints/background.ts`, handles `CHETTY_GEMINI_AUTOMATE_PROMPT`:
  - **Input Targeting**: Targets `rich-textarea div[contenteditable="true"]`, `div[contenteditable="true"][role="textbox"]`, or `textarea`.
  - **Text Injection**: Uses `document.execCommand('insertText')` and dispatches `beforeinput`, `input`, and `change` events so Gemini's Angular/framework state recognizes the new prompt.
  - **Send Dispatch**: Dispatches Enter key and clicks `button[aria-label*="Send"]`.
  - **Response Streaming & Polling**: Observes model output containers (`message-content`, `model-response`, `[data-message-author-role="model"]`), polling periodically and streaming incremental chunks back to the floating chatbox.
  - **Completion Detection**: Watches the generation state until the Stop/Cancel button disappears and output stabilizes.

### 6. Synchronous Execution & Global Mutex
- Since prompts share the user's active Gemini web tab, generation runs **synchronously**:
  - Global `isBusy` flag in settings prevents concurrent prompt submissions across windows or tabs.
  - All floating chatbox instances display the amber busy banner (`⏳ Gemini Web is generating... / Input locked`).
  - Textarea and Send button are disabled with an informative placeholder during generation and re-enabled as soon as generation completes.

---

## Build & Compile Verification

Both targets compile and build without warnings or errors:

```bash
# TypeScript Compile Check
pnpm run compile
# Exit code 0 (0 errors)

# Multi-Browser MV3 Builds
pnpm run build:all
# Chrome MV3: Built in 0.99s -> .output/chrome-mv3 (544 KB total)
# Firefox MV3: Built in 0.99s -> .output/firefox-mv3 (544 KB total)
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
   - Notice the dedicated input footer at the bottom: textarea with placeholder, Send button, and shortcut hints.
5. **Send a Prompt**:
   - Type a question or click one of the quick suggestion chips ("📝 Summarize this page").
   - Press Enter or click the Send button.
   - Chetty navigates the Gemini tab, types the prompt, clicks send, streams the response in real-time with an animated cursor, and locks input across all tabs while generating.
