# Chetty - Spec-Driven Cross-Browser Floating Chatbot Extension

Chetty is a cross-browser extension built using **WXT** (Manifest V3) that injects customizable, draggable, resizable, and dockable floating chatbot windows directly into web pages. It features the **Deep-Chat** UI, **Gemini AI** integration powered by the user's signed-in Google access token, multi-session management with real-time cross-tab synchronization, and rich context gathering engines.

---

## Latest Updates

### 1. Pre-installation Tab Refresh & Restricted URL Handling
- When the extension is freshly installed or reloaded, background tabs opened prior to installation do not have the content script running yet.
- Chetty now attempts programmatic injection via `chrome.scripting.executeScript`.
- If dynamic injection cannot proceed or on browser-restricted pages (`about:`, `chrome://`, extension stores), Chetty proactively alerts the user with an actionable message:
  > *"This tab was open before Chetty was installed. Please refresh this page (press F5 or Reload) to activate Chetty!"*

### 2. Session Rename & Remove (Cross-Tab Synchronized)
- Added dedicated buttons in the chatbox header:
  - **✏️ Rename Session**: Prompts for a new title. Renaming updates `chrome.storage.local` and instantly updates the header and minimized badge across all tabs viewing that session.
  - **🗑️ Delete Session**: Prompts for confirmation and deletes the session. **All open windows of this session across all browser tabs are automatically closed immediately.**
- The popup session picker dropdown is subscribed to storage changes and reloads automatically when sessions are renamed, created, or deleted.

### 3. Dynamic Pin / Lock & Floating Mode State Indicators
- **Docked Pin Button**:
  - `🔒`: **Pinned State** — The webpage body margin/width reflows around the chatbox. Tooltip: *"Pinned: Webpage reflows around chatbox (Click to Unpin)"*.
  - `🔓`: **Unpinned State** — The chatbox floats as an overlay without altering page layout. Tooltip: *"Unpinned: Floating over webpage without reflow (Click to Pin)"*.
- **Floating Mode Button**:
  - `📌`: **Fixed Mode** — Stays static in the viewport.
  - `📜`: **Sticky Mode** — Anchored relative to document scrolling.

---

## Build Verification

```bash
# Type check:
pnpm run compile  # Exit code 0 (0 errors)

# Chrome MV3 Build:
pnpm run build    # Built in 2.08 s -> .output/chrome-mv3

# Firefox MV3 Build:
pnpm run build:firefox  # Built in 1.11 s -> .output/firefox-mv3
```

---

## How to Test in Firefox

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `d:\Projects\chetty\.output\firefox-mv3\manifest.json`.
4. Open any standard website (e.g. `https://wikipedia.org` or `https://github.com`).
5. Click the Chetty toolbar icon and click **Start New Session**.
6. Test the new features:
   - Click `✏️` to rename the session.
   - Dock to the side and toggle `🔒`/`🔓` to observe the icon and webpage reflow.
   - Open the same session on another tab, click `🗑️` on either tab, and watch both tabs close the window in real-time.
