# Chetty - Spec-Driven Cross-Browser Floating Chatbot Extension

Chetty is a cross-browser extension built using **WXT** (Manifest V3) that injects customizable, draggable, resizable, and dockable floating chatbot windows directly into web pages. It features the **Deep-Chat** UI, active **Gemini Web (`gemini.google.com`) tab automation**, multi-session management with real-time cross-tab synchronization, and rich context gathering engines.

---

## Architecture: Gemini Web Simulation & Zero OAuth

1. **Zero OAuth & Token-Free**:
   - No Google Cloud Console setup, API keys, or OAuth client configurations required.
   - All prompts are sent through the user's existing logged-in `gemini.google.com` tab.

2. **Provider-Driven Popup UI**:
   - The extension popup dynamically queries the active chat provider (`GeminiChatProvider.renderPopupSettings()`).
   - The provider scans for open `gemini.google.com` tabs and displays the **Select Gemini Active Web** selector with connection and generation status badges.

3. **Session & Conversation URL Mapping**:
   - A new session starts on `https://gemini.google.com/app`.
   - On the first prompt, Chetty extracts the newly assigned conversation ID from the URL (`/app/<id>`) and persists it as `geminiConversationId` in session storage.
   - Subsequent prompts in that session navigate back to `https://gemini.google.com/app/<id>`.

4. **Synchronous Execution & Global Mutex**:
   - Prompts run sequentially using a background mutex.
   - All open chatbox instances across all tabs observe the busy state and show a sticky amber banner (`⏳ Gemini Web is generating... / Input locked`).

---

## Build Verification

```bash
# Type check:
pnpm run compile  # Exit code 0 (0 errors)

# Chrome MV3 Build:
pnpm run build    # Built in 1.72 s -> .output/chrome-mv3

# Firefox MV3 Build:
pnpm run build:firefox  # Built in 1.23 s -> .output/firefox-mv3
```

---

## Testing Instructions

1. **Firefox**:
   - Go to `about:debugging#/runtime/this-firefox`.
   - Click **Load Temporary Add-on...** and choose `d:\Projects\chetty\.output\firefox-mv3\manifest.json`.
2. **Chrome / Edge / Brave**:
   - Go to `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked** pointing to `d:\Projects\chetty\.output\chrome-mv3`.
3. Open `https://gemini.google.com/app` and make sure you're logged into your Google account.
4. Click Chetty toolbar icon -> confirm **Select Gemini Active Web** shows your tab as **Connected**.
5. Click **Start New Session** on any normal web page (e.g., `https://wikipedia.org`).
6. Enter a prompt in Chetty chatbox:
   - Chetty navigates the Gemini tab, types the prompt, clicks send, and streams the answer back.
   - While generating, open chatbox windows show the busy indicator and prevent concurrent prompts until finished.
