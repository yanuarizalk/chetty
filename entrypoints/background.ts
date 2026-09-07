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

    // Helper to inject and send message to tab
    const sendTabMessageWithFallback = async (tab: chrome.tabs.Tab, msg: any) => {
      if (!tab.id) {
        throw new Error('No active tab ID available');
      }

      const url = tab.url || '';
      if (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('moz-extension://') ||
        url.startsWith('edge://') ||
        url.startsWith('view-source:') ||
        url.includes('addons.mozilla.org') ||
        url.includes('chromewebstore.google.com')
      ) {
        throw new Error(
          'Chetty cannot run on browser system pages or extension stores. Please navigate to a standard webpage (e.g. Wikipedia or GitHub) and try again.'
        );
      }

      try {
        return await chrome.tabs.sendMessage(tab.id, msg);
      } catch (firstErr) {
        // Tab was likely open prior to extension install/reload
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-scripts/content.js'],
          });
          // Small delay to allow content script registration
          await new Promise((r) => setTimeout(r, 100));
          return await chrome.tabs.sendMessage(tab.id, msg);
        } catch (injectErr) {
          throw new Error(
            'This tab was open before Chetty was installed. Please refresh this page (press F5 or Reload) to activate Chetty!'
          );
        }
      }
    };

    // 3. Open new session on active tab
    if (message.type === 'CHETTY_BG_NEW_SESSION') {
      (async () => {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab || !activeTab.id) {
            sendResponse({ success: false, error: 'No active tab found' });
            return;
          }

          const resp = await sendTabMessageWithFallback(activeTab, {
            type: 'CHETTY_OPEN_NEW_SESSION',
            title: message.title,
          });
          sendResponse(resp || { success: true });
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

          const resp = await sendTabMessageWithFallback(activeTab, {
            type: 'CHETTY_OPEN_SESSION',
            sessionId: message.sessionId,
          });
          sendResponse(resp || { success: true });
        } catch (err) {
          sendResponse({ success: false, error: (err as Error).message });
        }
      })();
      return true;
    }

    return false;
  });
});
