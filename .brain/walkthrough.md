# Walkthrough - Real-Time Response Streaming, Accurate DOM Turn Targeting, Network Request Tracking & Emergency Force Unlock

This update addresses two critical issues and subsequent locking prevention:
1. **Real-time text streaming & prompt response targeting**: Eliminates multi-minute prompt completion delays, correctly distinguishes the new prompt from previous conversation turns by tracking `infinite-scroller` child indices and response counts, monitors `thinking-dots-animation` / `pending-request`, and streams tokens incrementally back to Chetty's floating window every 100ms.
2. **Post-Prompt Lock Resolution (StreamGenerate Network Hook & Stop/Mic Button Validation)**: Solves the issue where Chetty remained locked after Gemini finished generating:
   - Hooks into `chrome.webRequest` (`StreamGenerate` / `BardFrontendService`) to detect exact HTTP stream completion.
   - Monitors the state of the bottom toolbar: actively verifies when the Stop button disappears and the Mic or Send button returns.
   - Eliminates generic DOM queries (like `.sparkle-animation` or progress bars) that were permanently matching and keeping `busy: true`.
   - Incorporates multiple fast-exit conditions (200ms–400ms after generation ends).
3. **Emergency Force Unlock in Extension Popup & Chatbox**: When prompt automation encounters provider timeouts, network disruptions, or failures that would leave the chatbox locked in a busy state, the user can now force unlock Gemini directly from the popup (or the chatbox banner) with clear caution messaging that pending requests will be discarded and must be manually retried.

---

## Changes Implemented

### 1. StreamGenerate Network Listening & Stop/Mic Button Validation (`entrypoints/background.ts`)
- **`chrome.webRequest` Hook on `StreamGenerate`**:
  - Added `'webRequest'` permission to [wxt.config.ts](file:///d:/Projects/chetty/wxt.config.ts).
  - Background service worker listens to `chrome.webRequest.onCompleted` and `onErrorOccurred` specifically for `StreamGenerate` and `BardFrontendService` endpoints on the Gemini tab.
  - When the HTTP stream finishes, it sets `window.__chettyStreamGenerateDone = true` on the page context.
- **Accurate Stop & Mic Button State Detection**:
  - `isStopButtonVisible()`: Checks whether a button with `stop` or `cancel generation` (and not `mic`) is present, visible (`display !== 'none'`, `visibility !== 'hidden'`), and has positive dimensions.
  - `hasMicOrSendButtonReturned()`: Checks whether the Microphone button (`aria-label*="mic"` or `aria-label*="microphone"`) or Send button has reappeared in the input toolbar.
  - `isThinkingAnimationVisible()`: Checks whether `thinking-dots-animation` inside `pending-request` is actually visible.
- **Fast Exit Conditions**:
  1. **HTTP Stream Done**: If `StreamGenerate` completed and text is stable for 2 iterations (~200ms) with no Stop button -> **exits immediately**.
  2. **Button State Transition**: If Stop button disappeared and Mic/Send button returned with text stable for 3 iterations (~300ms) -> **exits immediately**.
  3. **Thinking Done**: If thinking dots are gone and text is stable for 4 iterations (~400ms) -> **exits immediately**.
  4. **Fallback Stability**: If text is unchanged for 10 iterations (~1000ms) with no Stop button -> **exits immediately**.
  5. Maximum safety timeout reduced to 60s.

### 2. Accurate DOM Turn Targeting & Streaming Loop (`entrypoints/background.ts`)
- **Pre-Prompt Snapshotting**:
  - Records `initialChildCount` of `infinite-scroller` and `initialResponseCount` before prompt submission to guarantee response scraping never reads previous turns.
- **Live Incremental Streaming (100ms intervals)**:
  - Dispatches `CHETTY_GEMINI_STREAM_CHUNK_FROM_PAGE` to the background broker, which routes chunks to `activeOriginTabId`.
  - Dispatches a final `done: true` chunk upon completion.

### 3. Client-Side Live Stream Accumulation (`src/components/floating-window.ts`)
- Updated `onChunk` to set `accumulatedResponse = chunk;` (direct assignment rather than concatenation), correctly formatting streaming markdown tokens without string repetition.

### 4. Emergency Force Unlock Feature (`src/providers/gemini.ts` & `entrypoints/background.ts`)
- **Popup Extension Option**:
  - Added a **Prompt Lock State** card in the extension popup with real-time status indicator and a `🔓 Force Unlock` button.
  - Displays caution text:
    > ⚠️ **Caution**: Unlocking releases the lock and stops listening to any stuck in-flight prompt. The pending prompt will need to be retried manually.
- **Chatbox Inline Unlock**:
  - Added an inline `Unlock` button in the amber `.chetty-busy-banner` on the floating chatbox.
- **Cancellation Handler**:
  - Aborts in-flight automation, notifies client tab with `{ aborted: true }`, and releases `isBusy: false` in storage.

---

## Background Tab Automation, Early Completion & Response Preservation

1. **Response Preservation on Release / Abort / Force Unlock**:
   - `removeChatboxLoadingInfo()` now strictly removes only the loading indicator (`.chetty-loading-row`), leaving any streamed response (`#streaming-...`) intact in the chatbox.
   - `finalizePartialStreamResponse()` was introduced: when the user unlocks or aborts, any already received response text is automatically committed to `addMessageToSession()` so the streamed output is **never deleted or lost**.
   - `onError` and `catch` blocks also preserve any received text instead of clearing it.

2. **Automating Directly in Background Tabs (No Tab Focus Required)**:
   - Previously, `document.execCommand('insertText')` and synthetic Enter key events were failing when the Gemini tab was not the active focused tab, causing the Send button to remain disabled.
   - Replaced with direct `<p>` element hierarchy population inside `rich-textarea[contenteditable="true"]` + selection range creation + complete event dispatch (`focus`, `beforeinput`, `input` with `inputType: 'insertText'`, and `change`).
   - Added polling for the Send button to become enabled, followed by clearing any lingering disabled attributes and dispatching pointer/mouse click sequences (`pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`, `.click()`).
   - The user never needs to switch to or focus the Gemini tab.

3. **Early Completion (Fixing Post-Generation Locking)**:
   - Previously, the polling loop in `runInPageGeminiSimulation` hung waiting for English-specific mic button labels and idle send state, failing to break even after Gemini Web sent the complete response.
   - Fixed: As soon as the Stop button is gone (`!isStopButtonPresent()`), thinking animations are gone (`!isThinkingAnimationVisible()`), and the model response node text is non-empty and stable for ~240ms (2 checks), the polling loop breaks immediately.
   - `runInPageGeminiSimulation` resolves and returns immediately, releasing the lock without delay.

---

## Verification Results

- `pnpm run compile`: **0 errors** (Clean TypeScript compile)
- `pnpm run build:all`: **Success**
  - Built Chrome MV3 extension (`.output/chrome-mv3/` - 571.85 kB)
  - Built Firefox MV3 extension (`.output/firefox-mv3/` - 571.84 kB)

## Debug Logging Implementation

Comprehensive, structured `console.log` logging has been added across every stage of the extension's execution lifecycle.

### Log Categories & Where to Inspect

| Tag Prefix | Context / Location | Where to Inspect in DevTools | Key Events Logged |
| :--- | :--- | :--- | :--- |
| `[Chetty:Chatbox]` | Webpage Content Script (Floating Window) | Webpage DevTools Console (F12 on active tab) | User typing, Send button click, context extraction, message streaming (`onChunk`, `onError`, `onFinish`), state transitions (`updateBusyState`), unlock button |
| `[Chetty:Provider]` | Chat Provider (`gemini.ts`) | Webpage DevTools Console & Extension Popup Console | Provider initialization, model selection, prompt dispatching, stream chunk routing, unlock triggers |
| `[Chetty:Background]` | Extension Background Service Worker | `chrome://extensions` -> Chetty -> **Inspect views: service worker** (or `about:debugging` in Firefox) | Tab message routing, prompt automation handler, busy lock acquisition/release, SPA navigation, script injection |
| `[Chetty:GeminiWeb]` | Gemini Web In-Page Script (`gemini.google.com`) | Gemini Web Tab DevTools Console (F12 on `gemini.google.com`) | Editor discovery (`rich-textarea`), pre-prompt DOM snapshots, input event dispatch, Send button clicks, generation indicator checks (`pending-request`, `thinking-dots`, stop buttons), 120ms polling iterations, live stream emissions, natural completion detection |

---

## Prompting Procedure Architecture (10-Step Specification)

A modular and clean architecture has been implemented to handle the complete Gemini Web prompting procedure:

1. **Prompt-Only Navigation**:
   - Navigation to `gemini.google.com/app` or `gemini.google.com/app/<conversationId>` occurs **only when prompting**.
   - Removed pre-emptive navigation from session creation handlers (`CHETTY_BG_NEW_SESSION`).
2. **Immediate User Bubble**:
   - `addImmediateUserBubble()` is triggered synchronously upon user prompt submission.
   - The user's chat bubble appears instantly without waiting for context gathering or provider responses.
3. **Gemini Web Readiness Check** (`checkGeminiWebReadiness` in [gemini-web-automation.ts](file:///d:/Projects/chetty/src/providers/gemini-web-automation.ts)):
   - **3.1**: Verifies `document.readyState` is active/complete.
   - **3.2**: Compares destination URL and triggers navigation only if destination differs, waiting for navigation completion.
   - **3.3**: Verifies that the chat input editor is mounted, visible, and editable.
4. **Prompt Automation & Simulation** (`runInPageGeminiSimulation` in [gemini-web-automation.ts](file:///d:/Projects/chetty/src/providers/gemini-web-automation.ts)):
   - **4.1**: Navigates to target conversation or new chat.
   - **4.2**: Fills input with prompt text and dispatches `InputEvent` & `change` events.
   - **4.3**: Snapshots existing child divisions in `<infinite-scroller>` so the listener can ignore them.
   - **4.4**: Submits prompt via Send button click or Enter key fallback.
5. **Chatbox Input Locking**:
   - `setChatboxInputLocked(true)` immediately disables textarea and Send button across all sessions, displaying busy status.
6. **Chatbox Loading Indicator**:
   - Displays a dedicated loading row (`.chetty-loading-row`) with animated sparkle and status text inside the floating box.
7. **Scroller Division Listener & Completion Detection**:
   - **7.1**: Continues waiting/ignoring while `thinking-dots-animation` or `pending-request` is visible.
   - **7.2**: Waits until the input/action button reverts to mic (dictate) or idle state (Stop button gone).
   - **7.3**: Inspects new division elements for `#model-response-message-xxxxxx` selector (`[id^="model-response-message-"]`).
8. **Remove Loading Indicator**:
   - `removeChatboxLoadingInfo()` cleanly removes the loading bubble upon response completion or error.
9. **Semantic HTML Extraction & Clean Rendering**:
   - `extractCleanNodeContent()` clones the model response node, strips auxiliary UI widgets (copy buttons, TTS controls, feedback thumbs), and removes all Gemini classes, IDs, styles, and Angular attributes.
   - Preserves semantic elements (`<p>`, `<ul>`, `<ol>`, `<li>`, `<code>`, `<pre>`, `<table>`, `<th>`, `<td>`, `<a>`, `<strong>`, `<em>`, `<blockquote>`) for maximum readability in the chatbox.
10. **Release Lock**:
    - `setChatboxInputLocked(false)` releases the UI lock and resets storage busy states.

---

## Verification & Usage Instructions

1. **Verify Lock Releases Promptly After Gemini Generation**:
   - Open Gemini in a browser tab.
   - Open Chetty on any page and submit a prompt.
   - Watch Gemini Web generate:
     - The Stop button appears on Gemini's input bar.
     - Tokens stream live into Chetty's floating box.
     - As soon as Gemini finishes, the Stop button turns back into the Microphone/Send button, the `StreamGenerate` HTTP request completes, and Chetty exits the loop and releases the busy lock in under 300ms!
2. **Verify Force Unlock**:
   - If ever needed, click **Unlock** on the chatbox banner or open the popup and click **🔓 Force Unlock** to immediately release any locked state.
