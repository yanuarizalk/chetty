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

          // Acquire lock
          console.log('[Chetty:Background] 🔒 Acquiring prompt lock for sessionId:', sessionId);
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
            console.log('[Chetty:Background] 🧭 Navigating Gemini tab from', currentUrl, 'to', cleanTarget);
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
            console.log('[Chetty:Background] ⏳ Waiting 1.5s for Gemini SPA to initialize after navigation...');
            await new Promise((r) => setTimeout(r, 1500));
          }

          if (currentToken !== activePromptToken) {
            throw new Error('Prompt was cancelled or unlocked by user.');
          }

          console.log('[Chetty:Background] 💉 Injecting in-page automation script into Gemini tabId:', tabId);

          // Injected In-Page Automation Script
          const executionResults = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (promptText: string, sid: string) => {
              console.log('[Chetty:GeminiWeb] 🚀 In-page automation script started for session:', sid, 'Prompt length:', promptText.length);
              (window as any).__chettyAbortRequested = false;
              const isAborted = () => (window as any).__chettyAbortRequested === true;

              // 1. Locate Editor
              const findEditor = (): HTMLElement | null => {
                return document.querySelector(
                  'rich-textarea div[contenteditable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"], textarea[aria-label*="prompt"], [role="combobox"]'
                );
              };

              let editor = findEditor();
              let attempts = 0;
              while (!editor && attempts < 30) {
                if (isAborted()) throw new Error('Generation cancelled by user.');
                await new Promise((r) => setTimeout(r, 300));
                editor = findEditor();
                attempts++;
                if (attempts % 5 === 0) {
                  console.log('[Chetty:GeminiWeb] 🔍 Still waiting for editor element... (attempt ' + attempts + '/30)');
                }
              }

              if (!editor) {
                console.error('[Chetty:GeminiWeb] ❌ Could not locate Gemini input box on the page!');
                throw new Error(
                  'Could not locate Gemini input box on the page. Please ensure you are logged in to gemini.google.com.'
                );
              }
              console.log('[Chetty:GeminiWeb] ✅ Input editor located:', editor.tagName, editor.className);

              // 2. Snapshot current state of conversation BEFORE typing new prompt
              const scroller = document.querySelector('infinite-scroller') || document.querySelector('main') || document.body;
              const initialChildCount = scroller ? scroller.children.length : 0;

              const priorResponseEls = Array.from(
                document.querySelectorAll(
                  'message-content, model-response, .model-response-text, [data-message-author-role="model"], .response-content'
                )
              );
              const initialResponseCount = priorResponseEls.length;
              console.log('[Chetty:GeminiWeb] 📸 Pre-prompt snapshot -> scroller children:', initialChildCount, '| prior model responses:', initialResponseCount);

              // 3. Focus and Enter Prompt
              console.log('[Chetty:GeminiWeb] ✍️ Typing prompt into editor...');
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

              await new Promise((r) => setTimeout(r, 300));

              // 4. Find and click Send button
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
                console.log('[Chetty:GeminiWeb] 🚀 Clicking Send button:', sendBtn.getAttribute('aria-label') || sendBtn.className);
                sendBtn.click();
              } else {
                console.log('[Chetty:GeminiWeb] 🚀 Send button not clickable or not found, dispatching Enter key event fallback...');
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

              // Helper to check for Gemini processing/thinking indicators
              const isGeneratingOrThinking = (): boolean => {
                const thinking = document.querySelector(
                  'pending-request, thinking-dots-animation, [data-test-id="thinking-dots"], .loading-indicator, mat-progress-bar, [role="progressbar"], .sparkle-animation'
                );
                const buttons = Array.from(document.querySelectorAll('button'));
                const stopBtn = buttons.find((b) => {
                  const label = (b.getAttribute('aria-label') || b.getAttribute('mattooltip') || '').toLowerCase();
                  return label.includes('stop') || label.includes('cancel');
                });
                return !!(thinking || stopBtn);
              };

              // 5. Wait for generation to register (up to 10s)
              console.log('[Chetty:GeminiWeb] ⏳ Waiting for Gemini to register the prompt and begin generating...');
              let waitAttempts = 0;
              while (waitAttempts < 35) {
                if (isAborted()) throw new Error('Generation cancelled by user.');
                await new Promise((r) => setTimeout(r, 250));
                waitAttempts++;

                const currentResponses = document.querySelectorAll(
                  'message-content, model-response, [data-message-author-role="model"], .response-content'
                );
                const busy = isGeneratingOrThinking();
                const childrenNow = scroller ? scroller.children.length : 0;

                if (
                  currentResponses.length > initialResponseCount ||
                  busy ||
                  childrenNow > initialChildCount
                ) {
                  console.log('[Chetty:GeminiWeb] ⚡ Generation registered!', {
                    waitAttempts,
                    newResponsesCount: currentResponses.length,
                    initialResponseCount,
                    isBusy: busy,
                    scrollerChildren: childrenNow,
                    initialChildCount,
                  });
                  break;
                }
              }

              // 6. Function to locate ONLY the NEW response element created in this turn
              const getNewResponseElement = (): HTMLElement | null => {
                // Strategy 1: Check children of infinite-scroller added after initialChildCount
                if (scroller && scroller.children.length > initialChildCount) {
                  for (let i = scroller.children.length - 1; i >= initialChildCount; i--) {
                    const child = scroller.children[i] as HTMLElement;
                    const resp = child.querySelector(
                      'message-content, model-response, [data-message-author-role="model"], .response-content, .markdown'
                    ) as HTMLElement;
                    if (resp) return resp;
                  }
                }

                // Strategy 2: Check querySelectorAll on response elements strictly after initial count
                const currentResponses = document.querySelectorAll(
                  'message-content, model-response, [data-message-author-role="model"], .response-content'
                );
                if (currentResponses.length > initialResponseCount) {
                  return currentResponses[currentResponses.length - 1] as HTMLElement;
                }

                // Strategy 3: Check inside or adjacent to pending-request / thinking-dots-animation
                const pending = document.querySelector('pending-request') || document.querySelector('thinking-dots-animation');
                if (pending) {
                  const parent = pending.closest('model-response, [data-message-author-role="model"], .model-response, div') || pending.parentElement;
                  const resp = parent?.querySelector('message-content, model-response, .markdown, .response-content') as HTMLElement;
                  if (resp) return resp;
                }

                return null;
              };

              // 7. Fast-polling loop with live streaming chunks (120ms interval)
              console.log('[Chetty:GeminiWeb] 🔄 Entering streaming & polling loop (120ms interval, max 120s timeout)...');
              let lastText = '';
              let stableIterations = 0;
              let pollIteration = 0;
              const maxTimeoutMs = 120000;
              const startTime = Date.now();

              while (Date.now() - startTime < maxTimeoutMs) {
                if (isAborted()) {
                  console.warn('[Chetty:GeminiWeb] 🛑 Polling loop aborted by user action!');
                  throw new Error('Generation cancelled by user.');
                }
                await new Promise((r) => setTimeout(r, 120));
                pollIteration++;

                const targetEl = getNewResponseElement();
                const busy = isGeneratingOrThinking();

                if (targetEl) {
                  const currentText = (targetEl.innerText || targetEl.textContent || '').trim();
                  if (currentText && currentText !== lastText) {
                    lastText = currentText;
                    stableIterations = 0;
                    console.log('[Chetty:GeminiWeb] 📡 Text updated (iteration ' + pollIteration + ', len: ' + currentText.length + '):', currentText.slice(-60));
                    try {
                      chrome.runtime.sendMessage({
                        type: 'CHETTY_GEMINI_STREAM_CHUNK_FROM_PAGE',
                        sessionId: sid,
                        chunkText: currentText,
                        done: false,
                      });
                    } catch { }
                  } else if (lastText && !busy) {
                    stableIterations++;
                    console.log('[Chetty:GeminiWeb] 💤 Stable check (' + stableIterations + '/5) | busy is FALSE');
                    // If not busy for ~600ms and text is stable, generation is complete!
                    if (stableIterations >= 5) {
                      console.log('[Chetty:GeminiWeb] 🏁 Generation completed naturally! (Text stable for 5 checks without busy state)');
                      break;
                    }
                  } else if (pollIteration % 25 === 0) {
                    console.log('[Chetty:GeminiWeb] ⏳ Generating in progress... elapsed: ' + (Date.now() - startTime) + 'ms | busy:', busy, '| current text len:', lastText.length);
                  }
                } else if (!busy && waitAttempts >= 30) {
                  console.warn('[Chetty:GeminiWeb] ⚠️ Generation stopped (busy is false) but no response element found.');
                  break;
                }
              }

              // Send final stream chunk indicating completion
              if (lastText) {
                console.log('[Chetty:GeminiWeb] 📤 Emitting final stream chunk (done: true, length: ' + lastText.length + ')');
                try {
                  chrome.runtime.sendMessage({
                    type: 'CHETTY_GEMINI_STREAM_CHUNK_FROM_PAGE',
                    sessionId: sid,
                    chunkText: lastText,
                    done: true,
                  });
                } catch { }
              }

              // Extract Conversation ID from URL
              const pathMatch = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/);
              const newConvId = pathMatch && pathMatch[1] !== 'app' ? pathMatch[1] : null;

              console.log('[Chetty:GeminiWeb] ✅ In-page automation completed! Final result:', {
                responseTextLength: lastText.length,
                newConversationId: newConvId,
                currentUrl: window.location.href,
              });

              return {
                responseText: lastText,
                newConversationId: newConvId,
              };
            },
            args: [prompt, sessionId],
          });

          if (currentToken !== activePromptToken) {
            throw new Error('Prompt was cancelled or unlocked by user.');
          }

          const result = executionResults && executionResults[0]?.result;
          console.log('[Chetty:Background] 📥 Script execution returned to background:', {
            hasResult: !!result,
            responseTextLength: result?.responseText?.length,
            newConversationId: result?.newConversationId,
          });

          if (!result || !result.responseText) {
            throw new Error('Gemini Web did not return any response text. Please check the Gemini tab.');
          }

          sendResponse({
            success: true,
            responseText: result.responseText,
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
