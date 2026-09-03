# Chrome Web Store Metadata & Compliance

## Basic Listing Information

- **Extension Name**: Chetty - Floating Chatbot
- **Short Description**: Cross-browser floating chatbot inside web pages powered by Gemini AI, deep-chat, context gathering, and session sync.
- **Detailed Description**:
  Chetty is a modern, privacy-respecting cross-browser extension that puts an AI-powered floating assistant right inside your web page.

  Key Features:
  - **Floating, Dockable & Resizable Window**: Drag, resize, toggle sticky (scrolls with page) vs fixed (viewport static), or snap to the left/right screen edge with smart page-reflow pinning.
  - **Minimizable Badge**: Minimize any active chat into an unobtrusive floating pill to keep your workspace tidy.
  - **Context-Aware AI**: Ask questions about the current page using article extraction, inspect specific HTML element boundaries, or pull context from other open tabs.
  - **Cross-Browser Google OAuth**: Connect your own Google account with 1-click OAuth to power Gemini queries directly using your quota.
  - **Multi-Session Management**: Open multiple independent chat sessions on a single tab, or switch sessions on the fly.
  - **Cross-Tab Realtime Sync**: Conversations automatically sync in real-time across tabs sharing the same session.
  - **Dark & Light Mode**: Seamlessly switch themes or adjust widget opacity.

- **Category**: Productivity / Tools
- **Version**: 1.0.0
- **Language**: English

## Permissions Justification

| Permission | Justification |
| :--- | :--- |
| `storage` | Required to persist user chat sessions, conversation message history, window positions, theme preferences, and user OAuth tokens locally on the device. |
| `tabs` | Required to provide cross-tab context awareness, allowing users to query open tabs and synchronize session updates across active browser tabs. |
| `activeTab` | Required to safely inject the floating chatbot UI, capture article text, and enable interactive element boundary inspection on the active web page. |
| `scripting` | Required to inject the content script and manage Shadow DOM attachment without modifying page source code. |
| `identity` | Required to initiate the standard Google OAuth 2.0 PKCE flow for signing into the user's Google account to authorize Gemini requests. |
| `<all_urls>` (host_permissions) | Required so users can activate the floating assistant and inspect content on any webpage they choose to browse. |

## Privacy & Data Use Disclosure

- **Data Collection**:
  - The extension does not collect, sell, or transmit personal data to any external developer server.
  - All chats and settings are stored locally in the user's browser using `browser.storage.local`.
  - When prompting the AI, the user's selected context and prompt are sent directly to Google Generative Language API using the user's authorized Google access token.
- **Single Purpose**: Chetty provides an in-page floating conversational assistant for web pages.
