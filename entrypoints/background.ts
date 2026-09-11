import { defineBackground } from 'wxt/utils/define-background';
import type { ContextSnippet, TabContextSummary } from '../src/types/session';
import { getGeminiWebConfig, updateGeminiWebConfig } from '../src/storage/settings-store';
import { checkGeminiWebReadiness, runInPageGeminiSimulation } from '../src/providers/gemini-web-automation';

export default defineBackground(() => {
  console.log('[Chetty Background] Service worker initialized.');

  // Helper to inject and send message to target tab
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
    } catch {
      // Tab was likely open prior to extension install/reload
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-scripts/content.js'],
        });
        await new Promise((r) => setTimeout(r, 100));
        return await chrome.tabs.sendMessage(tab.id, msg);
      } catch {
        throw new Error(
          'This tab was open before Chetty was installed. Please refresh this page (press F5 or Reload) to activate Chetty!'
        );
      }
    }
  };

  // Active automation state
  let activePromptToken = 0;
  let activeOriginTabId: number | null = null;
  let activeGeminiTabId: number | null = null;
  let activeSessionId: string | null = null;

  // Handle runtime messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 0. Stream chunk from in-page Gemini automation script forwarded to origin tab
    if (message.type === 'CHETTY_GEMINI_STREAM_CHUNK_FROM_PAGE') {
      console.log('[Chetty:Background] 📡 Stream chunk received from Gemini Web tab:', {
        originTabId: activeOriginTabId,
        sessionId: message.sessionId,
        chunkLength: message.chunkText?.length,
        done: message.done || false,
      });
      if (activeOriginTabId) {
        chrome.tabs.sendMessage(activeOriginTabId, {
          type: 'CHETTY_GEMINI_STREAM_CHUNK',
          sessionId: message.sessionId,
          chunkText: message.chunkText,
          done: message.done || false,
        }).catch(() => { });
      }
      return true;
    }

    // 0b. Force unlock Gemini state (emergency release of busy lock)
    if (message.type === 'CHETTY_FORCE_UNLOCK_GEMINI') {
      console.log('[Chetty:Background] 🔓 CHETTY_FORCE_UNLOCK_GEMINI requested! Inactive token:', activePromptToken);
      (async () => {
        try {
          activePromptToken++; // Invalidate any running prompt loop

          // Signal abort in active Gemini tab
          if (activeGeminiTabId) {
            console.log('[Chetty:Background] 🛑 Signaling abort to Gemini tabId:', activeGeminiTabId);
            chrome.scripting.executeScript({
              target: { tabId: activeGeminiTabId },
              func: () => {
                console.log('[Chetty:GeminiWeb] 🛑 Abort requested via __chettyAbortRequested');
                (window as any).__chettyAbortRequested = true;
              },
            }).catch(() => { });
          }

          // Notify originating tab to stop waiting
          if (activeOriginTabId && activeSessionId) {
            console.log('[Chetty:Background] 📣 Notifying origin tabId of abort:', activeOriginTabId);
            chrome.tabs.sendMessage(activeOriginTabId, {
              type: 'CHETTY_GEMINI_STREAM_CHUNK',
              sessionId: activeSessionId,
              chunkText: '',
              done: true,
              aborted: true,
            }).catch(() => { });
          }

          // Release storage lock
          await updateGeminiWebConfig({ isBusy: false, busySessionId: null });
          console.log('[Chetty:Background] ✅ Released busy lock in storage.');

          activeOriginTabId = null;
          activeGeminiTabId = null;
          activeSessionId = null;

          sendResponse({ success: true });
        } catch (err) {
          console.error('[Chetty:Background] ❌ Error during force unlock:', err);
          sendResponse({ success: false, error: (err as Error).message });
        }
      })();
      return true;
    }

    // 1. Get open tabs in current window (for cross-tab context)
    if (message.type === 'CHETTY_GET_TABS') {
      (async () => {
        try {
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const currentTabId = sender.tab?.id;
          const summaries: TabContextSummary[] = tabs
            .filter(
              (t) =>
                t.id &&
                t.id !== currentTabId &&
                t.url &&
                !t.url.startsWith('chrome://') &&
                !t.url.startsWith('about:')
            )
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
      return true;
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

    // 5. Automate Prompt on Selected Gemini Web Tab
    if (message.type === 'CHETTY_GEMINI_AUTOMATE_PROMPT') {
      (async () => {
        const { tabId, sessionId, conversationId, prompt } = message;

        const originTabId = sender.tab?.id || null;
        activeOriginTabId = originTabId;
        activeGeminiTabId = tabId;
        activeSessionId = sessionId;
        const currentToken = ++activePromptToken;

        console.log('[Chetty:Background] 📨 CHETTY_GEMINI_AUTOMATE_PROMPT received:', {
          tabId,
          sessionId,
          conversationId,
          promptLength: prompt?.length,
          originTabId,
          token: currentToken,
        });

        try {
          const config = await getGeminiWebConfig();
          if (config.isBusy) {
            console.warn('[Chetty:Background] ⚠️ Cannot run prompt: Gemini Web is already busy! (busySessionId:', config.busySessionId, ')');
            sendResponse({
              success: false,
              error: 'Gemini Web is currently busy generating a response. Please wait or click Force Unlock.',
            });
            return;
          }

          // Step 5: Acquire lock
          console.log('[Chetty:Background] 🔒 Acquiring prompt lock for sessionId:', sessionId);
          await updateGeminiWebConfig({ isBusy: true, busySessionId: sessionId });

          const targetUrl = conversationId
            ? `https://gemini.google.com/app/${conversationId}`
            : 'https://gemini.google.com/app';

          // Step 3 & 4.1: Check readyState, destination navigation, and textbox availability
          await checkGeminiWebReadiness(tabId, targetUrl);

          if (currentToken !== activePromptToken) {
            throw new Error('Prompt was cancelled or unlocked by user.');
          }

          // Step 4.2-4.4, 7, 9: In-page simulation, response division tracking & HTML extraction
          const result = await runInPageGeminiSimulation(tabId, prompt, sessionId);

          if (currentToken !== activePromptToken) {
            throw new Error('Prompt was cancelled or unlocked by user.');
          }

          sendResponse({
            success: true,
            responseText: result.responseText,
            cleanHtml: result.cleanHtml,
            newConversationId: result.newConversationId,
          });
        } catch (err) {
          console.error('[Chetty:Background] ❌ Gemini automation error:', err);
          sendResponse({
            success: false,
            error: (err as Error).message || 'Failed to automate prompt on Gemini Web',
          });
        } finally {
          // Release lock only if still the active prompt token
          console.log('[Chetty:Background] 🔓 Entering finally block. currentToken:', currentToken, 'activePromptToken:', activePromptToken);
          if (currentToken === activePromptToken) {
            await updateGeminiWebConfig({ isBusy: false, busySessionId: null });
            console.log('[Chetty:Background] ✅ Released Gemini busy lock in storage.');
            activeOriginTabId = null;
            activeGeminiTabId = null;
            activeSessionId = null;
          } else {
            console.log('[Chetty:Background] ℹ️ Token mismatch, lock was already invalidated or overtaken.');
          }
        }
      })();
      return true;
    }

    return false;
  });
});
