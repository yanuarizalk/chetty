import { defineBackground } from 'wxt/utils/define-background';
import type { ContextSnippet, TabContextSummary } from '../src/types/session';

export default defineBackground(() => {
  console.log('[Chetty Background] Service worker initialized.');

  // Handle runtime messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 1. Get open tabs in current window (for cross-tab context)
    if (message.type === 'CHETTY_GET_TABS') {
      (async () => {
        try {
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const currentTabId = sender.tab?.id;
          const summaries: TabContextSummary[] = tabs
            .filter((t) => t.id && t.id !== currentTabId && t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('about:'))
            .map((t) => ({
              id: t.id!,
              title: t.title || 'Untitled Tab',
              url: t.url || '',
              favIconUrl: t.favIconUrl,
            }));

          sendResponse({ tabs: summaries });
        } catch (err) {
          sendResponse({ tabs: [], error: (err as Error).message });
        }
      })();
      return true; // Keep channel open for async response
    }

    // 2. Extract context from a specific remote tab
    if (message.type === 'CHETTY_EXTRACT_TAB_CONTEXT') {
      (async () => {
        try {
          const tabId = message.tabId as number;
          const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const title = document.title;
              const url = window.location.href;
              const text = (document.body.innerText || '').slice(0, 10000);
              return { title, url, text };
            },
          });

          if (result && result.result) {
            const { title, url, text } = result.result;
            const snippet: ContextSnippet = {
              type: 'other_tab',
              title,
              url,
              content: text,
              summary: `Content extracted from "${title}"`,
            };
            sendResponse({ context: snippet });
          } else {
            sendResponse({ context: null, error: 'Could not extract content from tab' });
          }
        } catch (err) {
          sendResponse({ context: null, error: (err as Error).message });
        }
      })();
      return true;
    }

    // 3. Open new session on active tab
    if (message.type === 'CHETTY_BG_NEW_SESSION') {
      (async () => {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab || !activeTab.id) {
            sendResponse({ success: false, error: 'No active tab found' });
            return;
          }

          // Ensure content script is injected or ping tab
          try {
            const resp = await chrome.tabs.sendMessage(activeTab.id, {
              type: 'CHETTY_OPEN_NEW_SESSION',
              title: message.title,
            });
            sendResponse(resp);
          } catch {
            // If content script was not ready, inject it dynamically
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['content-scripts/content.js'],
            });
            const resp = await chrome.tabs.sendMessage(activeTab.id, {
              type: 'CHETTY_OPEN_NEW_SESSION',
              title: message.title,
            });
            sendResponse(resp);
          }
        } catch (err) {
          sendResponse({ success: false, error: (err as Error).message });
        }
      })();
      return true;
    }

    // 4. Open specific existing session on active tab
    if (message.type === 'CHETTY_BG_OPEN_SESSION') {
      (async () => {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab || !activeTab.id) {
            sendResponse({ success: false, error: 'No active tab found' });
            return;
          }

          try {
            const resp = await chrome.tabs.sendMessage(activeTab.id, {
              type: 'CHETTY_OPEN_SESSION',
              sessionId: message.sessionId,
            });
            sendResponse(resp);
          } catch {
            await chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['content-scripts/content.js'],
            });
            const resp = await chrome.tabs.sendMessage(activeTab.id, {
              type: 'CHETTY_OPEN_SESSION',
              sessionId: message.sessionId,
            });
            sendResponse(resp);
          }
        } catch (err) {
          sendResponse({ success: false, error: (err as Error).message });
        }
      })();
      return true;
    }

    return false;
  });
});
