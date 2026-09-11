/**
 * Gemini Web Automation & Simulation Module
 *
 * Implements the prompt simulation procedure on gemini.google.com:
 * 3. Checks readyState, destination navigation, and textbox availability.
 * 4. Fills input, snapshots scroller division elements, and submits.
 * 7. Listens for division changes in infinite-scroller:
 *    7.1 Ignores/waits while thinking-dots-animation is visible.
 *    7.2 Waits until the action button is in mic/dictate or submittable state.
 *    7.3 Expects the new child division to contain #model-response-message-xxxxxx.
 * 9. Extracts node content with cleaned semantic HTML (no Gemini classes/IDs).
 */

export interface GeminiAutomationResult {
  responseText: string;
  cleanHtml: string;
  newConversationId: string | null;
}

/**
 * Step 3: Check state of Gemini Web tab:
 * 3.1 Document readyState.
 * 3.2 Destination navigation.
 * 3.3 Textbox availability to be able to input & submit.
 */
export async function checkGeminiWebReadiness(
  tabId: number,
  targetUrl: string
): Promise<{ navigated: boolean }> {
  console.log('[Chetty:GeminiAutomation] 🔍 Checking Gemini Web readiness on tabId:', tabId, 'Target:', targetUrl);

  const tab = await chrome.tabs.get(tabId);
  if (!tab || !tab.url || !tab.url.includes('gemini.google.com')) {
    throw new Error('Selected tab is not an active gemini.google.com page. Please select an active Gemini tab in Chetty popup.');
  }

  // 3.1 & 3.2 Check current URL and document readyState
  const [{ result: pageState }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      readyState: document.readyState,
      url: window.location.href,
    }),
  });

  console.log('[Chetty:GeminiAutomation] 📄 Tab state:', pageState);

  // 3.2 Destination navigation check
  const currentClean = (pageState?.url || tab.url).split('?')[0].replace(/\/+$/, '');
  const targetClean = targetUrl.split('?')[0].replace(/\/+$/, '');

  let navigated = false;
  if (currentClean !== targetClean) {
    console.log('[Chetty:GeminiAutomation] 🧭 Navigating tab to destination:', targetClean);
    await chrome.tabs.update(tabId, { url: targetUrl });

    // Wait for tab navigation to complete
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(); // Continue and let DOM check handle readiness
      }, 15000);

      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    navigated = true;
    console.log('[Chetty:GeminiAutomation] ⏳ Navigation complete, giving SPA 1.2s to mount...');
    await new Promise((r) => setTimeout(r, 1200));
  }

  // 3.3 Check textbox availability
  console.log('[Chetty:GeminiAutomation] 🔍 Verifying textbox availability...');
  const [{ result: hasEditor }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const editor = document.querySelector(
        'rich-textarea div[contenteditable="true"], div[role="textbox"], textarea[aria-label*="prompt"], [role="combobox"]'
      );
      return !!editor;
    },
  });

  if (!hasEditor) {
    // Poll up to 10s for the editor to mount
    console.log('[Chetty:GeminiAutomation] ⏳ Waiting for textbox to be available...');
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const [{ result: editorFound }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return !!document.querySelector(
            'rich-textarea div[contenteditable="true"], div[role="textbox"], textarea[aria-label*="prompt"], [role="combobox"]'
          );
        },
      });
      if (editorFound) {
        ready = true;
        break;
      }
    }

    if (!ready) {
      throw new Error('Gemini input textbox is not available or not editable on the page. Please verify your Gemini Web tab.');
    }
  }

  console.log('[Chetty:GeminiAutomation] ✅ Gemini Web is ready for prompt simulation');
  return { navigated };
}

/**
 * Step 4, 7, 9: In-page simulation script injected into gemini.google.com.
 *
 * Self-contained function containing dedicated, readable sub-routines:
 * - 4.2 Fill chat input
 * - 4.3 Snapshot scroller divisions to ignore
 * - 4.4 Submit
 * - 7.1 Ignore if thinking-dots-animation is present
 * - 7.2 Wait till submitable or action button is mic/dictate
 * - 7.3 Expect #model-response-message-xxxxxx
 * - 9. Extract content with semantic HTML (stripped of classes/IDs)
 */
export async function runInPageGeminiSimulation(
  tabId: number,
  promptText: string,
  sessionId: string
): Promise<GeminiAutomationResult> {
  console.log('[Chetty:GeminiAutomation] 💉 Executing in-page simulation on tabId:', tabId, 'for session:', sessionId);

  const executionResults = await chrome.scripting.executeScript({
    target: { tabId },
    args: [promptText, sessionId],
    func: async (prompt: string, sid: string) => {
      console.log('[Chetty:GeminiWeb] 🚀 Simulation started for session:', sid, 'Prompt length:', prompt.length);

      (window as any).__chettyAbortRequested = false;
      const isAborted = () => (window as any).__chettyAbortRequested === true;

      // --- SUB-ROUTINE 1: Locate Chat Input Editor ---
      const findEditor = (): HTMLElement | null => {
        return (
          (document.querySelector('rich-textarea div[contenteditable="true"]') as HTMLElement) ||
          (document.querySelector('div[contenteditable="true"][role="textbox"]') as HTMLElement) ||
          (document.querySelector('div[contenteditable="true"]') as HTMLElement) ||
          (document.querySelector('textarea[aria-label*="prompt"]') as HTMLElement) ||
          (document.querySelector('[role="combobox"]') as HTMLElement) ||
          null
        );
      };

      let editor = findEditor();
      let editorAttempts = 0;
      while (!editor && editorAttempts < 25) {
        if (isAborted()) throw new Error('Generation cancelled by user.');
        await new Promise((r) => setTimeout(r, 200));
        editor = findEditor();
        editorAttempts++;
      }

      if (!editor) {
        throw new Error('Could not find Gemini chat input element.');
      }
      console.log('[Chetty:GeminiWeb] ✍️ Input editor located:', editor.tagName);

      // --- SUB-ROUTINE 2: Snapshot Current Infinite-Scroller Division Elements (Step 4.3) ---
      const scroller =
        document.querySelector('infinite-scroller') ||
        document.querySelector('main') ||
        document.body;

      // Remember all current child division elements so listener ignores them
      const existingDivisions = new Set<Element>(Array.from(scroller.children));
      const priorResponseIds = new Set<string>();
      document.querySelectorAll('[id^="model-response-message-"]').forEach((el) => {
        if (el.id) priorResponseIds.add(el.id);
      });

      console.log('[Chetty:GeminiWeb] 📸 Scroller divisions snapshot:', {
        totalDivisions: existingDivisions.size,
        priorModelResponseIds: Array.from(priorResponseIds),
      });

      // --- SUB-ROUTINE 3: Fill Chat Input (Step 4.2) ---
      // In background tabs, execCommand can fail without focus.
      // We populate <p> child elements directly inside rich-textarea contenteditable,
      // then dispatch full sequence of InputEvent/change events so Angular detects it.
      editor.focus();
      while (editor.firstChild) {
        editor.removeChild(editor.firstChild);
      }

      const lines = prompt.split('\n');
      for (const line of lines) {
        const p = document.createElement('p');
        if (line) {
          p.textContent = line;
        } else {
          p.appendChild(document.createElement('br'));
        }
        editor.appendChild(p);
      }

      // Also set selection range inside editor
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      } catch { }

      // Dispatch full input events to notify Angular framework
      editor.dispatchEvent(new Event('focus', { bubbles: true }));
      editor.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          composed: true,
          data: prompt,
          inputType: 'insertText',
        })
      );
      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          data: prompt,
          inputType: 'insertText',
        })
      );
      editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      // --- SUB-ROUTINE 4: Submit Prompt (Step 4.4) ---
      const findSendButton = (): HTMLButtonElement | null => {
        const directBtn = document.querySelector(
          'button.send-button, button[aria-label*="Send" i], button[aria-label*="Kirim" i], button[mattooltip*="Send" i], button.submit, [data-test-id="send-button"]'
        ) as HTMLButtonElement | null;
        if (directBtn) return directBtn;

        const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
        return (
          buttons.find((b) => {
            const label = (b.getAttribute('aria-label') || b.getAttribute('mattooltip') || b.className || '').toLowerCase();
            const hasSendIcon = !!b.querySelector('mat-icon, [data-icon="send"], svg');
            return (
              label.includes('send') ||
              label.includes('kirim') ||
              label.includes('submit') ||
              label.includes('send-button') ||
              (hasSendIcon && !label.includes('mic') && !label.includes('voice'))
            );
          }) || null
        );
      };

      // Poll up to 2 seconds for Angular to update Send button state in background
      let sendBtn = findSendButton();
      let waitCount = 0;
      while (waitCount < 20) {
        if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
        editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        sendBtn = findSendButton();
        waitCount++;
      }

      if (sendBtn) {
        // Force enable in case Angular left disabled attribute
        sendBtn.disabled = false;
        sendBtn.removeAttribute('disabled');
        sendBtn.setAttribute('aria-disabled', 'false');

        console.log('[Chetty:GeminiWeb] 🚀 Submitting via Send button');
        sendBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
        sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        sendBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
        sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        sendBtn.click();
      }

      // Also dispatch Enter key event as supplementary fallback
      editor.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );

      // --- SUB-ROUTINES FOR STEP 7: Check Thinking, Mic State & Model Response Node ---
      // 7.1: Check if thinking-dots-animation or pending request is visible
      const isThinkingAnimationVisible = (): boolean => {
        const thinkingDots = document.querySelector('thinking-dots-animation');
        const pendingRequest = document.querySelector('pending-request');
        const dotsTestId = document.querySelector('[data-test-id="thinking-dots"]');
        const sparkles = document.querySelector('.sparkle-animation');
        const progressBar = document.querySelector('mat-progress-bar, [role="progressbar"]');

        const isVisible = (el: Element | null) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        };

        return (
          isVisible(thinkingDots) ||
          isVisible(pendingRequest) ||
          isVisible(dotsTestId) ||
          isVisible(sparkles) ||
          isVisible(progressBar)
        );
      };

      // 7.2: Check if generation stop button is present anywhere
      const isStopButtonPresent = (): boolean => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some((b) => {
          const label = (b.getAttribute('aria-label') || b.getAttribute('mattooltip') || '').toLowerCase();
          return label.includes('stop') || label.includes('cancel') || label.includes('berhenti');
        });
      };

      // 7.3: Find new model response node matching #model-response-message-xxxxxx
      const findNewModelResponseNode = (): HTMLElement | null => {
        // First: Inspect new division elements inside scroller (ignoring existing ones from step 4.3)
        const currentChildren = Array.from(scroller.children);
        for (let i = currentChildren.length - 1; i >= 0; i--) {
          const child = currentChildren[i];
          if (!existingDivisions.has(child)) {
            // Check for #model-response-message-xxxxxx selector
            const modelNode =
              (child.querySelector('[id^="model-response-message-"]') as HTMLElement) ||
              (child.querySelector('[id*="model-response-message"]') as HTMLElement) ||
              (child.querySelector('message-content') as HTMLElement) ||
              (child.querySelector('model-response') as HTMLElement);
            if (modelNode) return modelNode;
          }
        }

        // Second: Check any newly appeared model-response-message ID not in snapshot
        const allModelNodes = Array.from(document.querySelectorAll('[id^="model-response-message-"]')) as HTMLElement[];
        for (const node of allModelNodes) {
          if (!priorResponseIds.has(node.id)) {
            return node;
          }
        }

        // Third: Fallback to latest message content element
        const allResponses = Array.from(document.querySelectorAll('message-content, model-response, .response-content')) as HTMLElement[];
        if (allResponses.length > 0) {
          return allResponses[allResponses.length - 1];
        }

        return null;
      };

      // --- SUB-ROUTINE FOR STEP 9: Extract Content With Clean Semantic HTML ---
      const extractCleanNodeContent = (node: HTMLElement): { text: string; html: string } => {
        const clone = node.cloneNode(true) as HTMLElement;

        // 1. Remove unwanted auxiliary UI elements
        const unwanted = clone.querySelectorAll(
          'button, [role="button"], mat-icon, .response-footer, .action-buttons, copy-code-button, [aria-label*="Copy" i], [aria-label*="thumb" i], [aria-label*="listen" i], tts-control, .model-response-menu'
        );
        unwanted.forEach((el) => el.remove());

        // 2. Walk elements and strip proprietary classes, IDs, styles, Angular attributes
        const allElements = [clone, ...Array.from(clone.querySelectorAll('*'))];
        for (const el of allElements) {
          const attrs = Array.from(el.attributes);
          for (const attr of attrs) {
            const name = attr.name.toLowerCase();
            // Retain safe semantic attributes
            if (['href', 'target', 'src', 'alt', 'title', 'colspan', 'rowspan'].includes(name)) {
              continue;
            }
            el.removeAttribute(attr.name);
          }
        }

        const cleanHtml = clone.innerHTML.trim();
        const text = clone.innerText?.trim() || clone.textContent?.trim() || '';
        return { text, html: cleanHtml };
      };

      // --- STEP 7 LISTENER: Fast-polling loop monitoring division changes (120ms interval) ---
      console.log('[Chetty:GeminiWeb] 🔄 Listening for division change in infinite-scroller...');
      let lastText = '';
      let stableChecks = 0;
      let totalChecks = 0;
      const startTime = Date.now();
      const maxTimeoutMs = 120000;

      while (Date.now() - startTime < maxTimeoutMs) {
        if (isAborted()) {
          console.warn('[Chetty:GeminiWeb] 🛑 Simulation aborted by user action');
          throw new Error('Generation cancelled by user.');
        }

        await new Promise((r) => setTimeout(r, 120));
        totalChecks++;

        // 7.1: Ignore / continue waiting if thinking-dots-animation is visible
        const thinking = isThinkingAnimationVisible();

        // 7.2: Check if Stop button is still active
        const hasStopButton = isStopButtonPresent();

        // 7.3: Look for model response node
        const modelNode = findNewModelResponseNode();

        if (modelNode) {
          const currentText = (modelNode.innerText || modelNode.textContent || '').trim();

          // Stream live chunks as text grows
          if (currentText && currentText !== lastText) {
            lastText = currentText;
            stableChecks = 0;
            try {
              chrome.runtime.sendMessage({
                type: 'CHETTY_GEMINI_STREAM_CHUNK_FROM_PAGE',
                sessionId: sid,
                chunkText: currentText,
                done: false,
              });
            } catch { }
          }

          // Complete early as soon as:
          // 1. Thinking animation is gone (7.1)
          // 2. Stop button is gone / mic active (7.2)
          // 3. Model node text is non-empty and stable for ~240ms (2 checks)
          if (!thinking && !hasStopButton && lastText.length > 0) {
            stableChecks++;
            if (stableChecks >= 2) {
              console.log('[Chetty:GeminiWeb] 🏁 Generation completed early! (Stop button gone, thinking gone, text stable)');
              break;
            }
          } else {
            stableChecks = 0;
          }

          // Safety fallback: if text has been non-empty and completely unchanged for >2.5s (20 checks), complete early
          if (lastText.length > 0 && totalChecks > 20 && !thinking && stableChecks >= 15) {
            console.log('[Chetty:GeminiWeb] 🏁 Safety fallback complete: text has been idle.');
            break;
          }
        }
      }

      // Final model response node extraction (Step 9)
      const finalModelNode = findNewModelResponseNode();
      let responseText = lastText;
      let cleanHtml = '';

      if (finalModelNode) {
        const extracted = extractCleanNodeContent(finalModelNode);
        responseText = extracted.text || responseText;
        cleanHtml = extracted.html;
        console.log('[Chetty:GeminiWeb] 🧼 Clean HTML extracted (length: ' + cleanHtml.length + ')');
      }

      // Extract new conversation ID if URL updated
      const pathMatch = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/);
      const newConvId = pathMatch && pathMatch[1] !== 'app' ? pathMatch[1] : null;

      // Send final stream chunk
      if (responseText) {
        try {
          chrome.runtime.sendMessage({
            type: 'CHETTY_GEMINI_STREAM_CHUNK_FROM_PAGE',
            sessionId: sid,
            chunkText: responseText,
            done: true,
          });
        } catch { }
      }

      console.log('[Chetty:GeminiWeb] ✅ Simulation finished successfully:', {
        responseTextLength: responseText.length,
        cleanHtmlLength: cleanHtml.length,
        newConversationId: newConvId,
      });

      return {
        responseText,
        cleanHtml,
        newConversationId: newConvId,
      };
    },
  });

  const result = executionResults && executionResults[0]?.result;
  if (!result || (!result.responseText && !result.cleanHtml)) {
    throw new Error('Gemini Web did not return any response text. Please check the Gemini tab.');
  }

  return result;
}
