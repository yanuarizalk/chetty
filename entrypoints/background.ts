import { defineBackground } from 'wxt/utils/define-background';
import type { ContextSnippet, TabContextSummary } from '../src/types/session';
import { getGeminiWebConfig, updateGeminiWebConfig } from '../src/storage/settings-store';

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

  // Helper to prepare Gemini tab for a new chat
  const resetGeminiTabToNewChat = async (geminiTabId: number) => {
    try {
      const tab = await chrome.tabs.get(geminiTabId);
      if (tab && tab.url && !tab.url.endsWith('/app')) {
        await chrome.tabs.update(geminiTabId, { url: 'https://gemini.google.com/app' });
      }
    } catch (e) {
      console.warn('[Chetty] Could not reset Gemini tab to new chat:', e);
    }
  };

  // Handle runtime messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

          // Also set Gemini tab to new chat if connected
          const geminiConfig = await getGeminiWebConfig();
          if (geminiConfig.selectedTabId) {
            resetGeminiTabToNewChat(geminiConfig.selectedTabId);
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

        try {
          const config = await getGeminiWebConfig();
          if (config.isBusy) {
            sendResponse({
              success: false,
              error: 'Gemini Web is currently busy generating a response. Please wait.',
            });
            return;
          }

          // Acquire lock
          await updateGeminiWebConfig({ isBusy: true, busySessionId: sessionId });

          // Verify tab exists
          const geminiTab = await chrome.tabs.get(tabId);
          if (!geminiTab || !geminiTab.url || !geminiTab.url.includes('gemini.google.com')) {
            throw new Error('Selected Gemini Web tab is no longer active. Please re-select it in Chetty popup.');
          }

          // Check if tab needs navigation to specific conversation or fresh chat
          const targetUrl = conversationId
            ? `https://gemini.google.com/app/${conversationId}`
            : 'https://gemini.google.com/app';

          const currentUrl = geminiTab.url.split('?')[0].replace(/\/+$/, '');
          const cleanTarget = targetUrl.replace(/\/+$/, '');

          if (currentUrl !== cleanTarget) {
            await chrome.tabs.update(tabId, { url: targetUrl });
            // Wait for tab navigation to complete
            await new Promise((resolve) => {
              const onUpdated = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
                if (updatedTabId === tabId && info.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(onUpdated);
                  resolve(true);
                }
              };
              chrome.tabs.onUpdated.addListener(onUpdated);
              setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                resolve(true);
              }, 10000);
            });
            // Allow SPA framework to mount editor
            await new Promise((r) => setTimeout(r, 1500));
          }

          // Injected In-Page Automation Script
          const executionResults = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (promptText: string, sid: string) => {
              // 1. Locate Editor
              const findEditor = (): HTMLElement | null => {
                return document.querySelector(
                  'rich-textarea div[contenteditable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"], textarea[aria-label*="prompt"], [role="combobox"]'
                );
              };

              let editor = findEditor();
              let attempts = 0;
              while (!editor && attempts < 30) {
                await new Promise((r) => setTimeout(r, 300));
                editor = findEditor();
                attempts++;
              }

              if (!editor) {
                throw new Error(
                  'Could not locate Gemini input box on the page. Please ensure you are logged in to gemini.google.com.'
                );
              }

              // 2. Focus and Enter Prompt
              editor.focus();
              document.execCommand('selectAll', false, undefined);
              document.execCommand('delete', false, undefined);

              const inserted = document.execCommand('insertText', false, promptText);
              if (!inserted) {
                if (editor.tagName.toLowerCase() === 'textarea') {
                  (editor as HTMLTextAreaElement).value = promptText;
                } else {
                  editor.textContent = promptText;
                }
              }

              editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              editor.dispatchEvent(
                new InputEvent('input', {
                  bubbles: true,
                  composed: true,
                  data: promptText,
                  inputType: 'insertText',
                })
              );
              editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

              await new Promise((r) => setTimeout(r, 400));

              // 3. Find and click Send button
              const findSendBtn = (): HTMLButtonElement | null => {
                const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
                return (
                  buttons.find((b) => {
                    const label = (
                      b.getAttribute('aria-label') ||
                      b.getAttribute('mattooltip') ||
                      b.className ||
                      ''
                    ).toLowerCase();
                    return label.includes('send') || label.includes('submit') || label.includes('send-button');
                  }) || null
                );
              };

              const sendBtn = findSendBtn();
              if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
                sendBtn.click();
              } else {
                // Fallback: dispatch Enter
                editor.dispatchEvent(
                  new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    composed: true,
                  })
                );
              }

              // 4. Wait for generation to start and monitor
              await new Promise((r) => setTimeout(r, 1000));

              const isGenerating = (): boolean => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const stopBtn = buttons.find((b) => {
                  const label = (b.getAttribute('aria-label') || b.getAttribute('mattooltip') || '').toLowerCase();
                  return label.includes('stop') || label.includes('cancel');
                });
                const progressBar = document.querySelector(
                  '.loading-indicator, mat-progress-bar, [role="progressbar"], .sparkle-animation'
                );
                return !!(stopBtn || progressBar);
              };

              const getLatestResponseText = (): string => {
                const candidates = document.querySelectorAll(
                  'message-content, model-response, .model-response-text, [data-message-author-role="model"], .response-content, .markdown'
                );
                if (candidates.length === 0) return '';
                const last = candidates[candidates.length - 1] as HTMLElement;
                return (last.innerText || last.textContent || '').trim();
              };

              let lastText = '';
              let stableCount = 0;
              const maxTimeoutMs = 120000;
              const startTime = Date.now();

              while (Date.now() - startTime < maxTimeoutMs) {
                await new Promise((r) => setTimeout(r, 500));
                const currentText = getLatestResponseText();
                const busy = isGenerating();

                if (currentText && currentText !== lastText) {
                  lastText = currentText;
                  stableCount = 0;
                  try {
                    chrome.runtime.sendMessage({
                      type: 'CHETTY_GEMINI_STREAM_CHUNK',
                      sessionId: sid,
                      chunkText: currentText,
                      done: false,
                    });
                  } catch {}
                } else if (lastText && !busy) {
                  stableCount++;
                  if (stableCount >= 3) {
                    // Response complete and stable
                    break;
                  }
                }
              }

              // Extract Conversation ID from URL
              const pathMatch = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/);
              const newConvId = pathMatch && pathMatch[1] !== 'app' ? pathMatch[1] : null;

              return {
                responseText: lastText,
                newConversationId: newConvId,
              };
            },
            args: [prompt, sessionId],
          });

          const result = executionResults && executionResults[0]?.result;
          if (!result || !result.responseText) {
            throw new Error('Gemini Web did not return any response text. Please check the Gemini tab.');
          }

          sendResponse({
            success: true,
            responseText: result.responseText,
            newConversationId: result.newConversationId,
          });
        } catch (err) {
          console.error('[Chetty Background] Gemini automation error:', err);
          sendResponse({
            success: false,
            error: (err as Error).message || 'Failed to automate prompt on Gemini Web',
          });
        } finally {
          // Release lock
          await updateGeminiWebConfig({ isBusy: false, busySessionId: null });
        }
      })();
      return true;
    }

    return false;
  });
});
