import type { IChatProvider, SendMessageOptions } from '../types/provider';
import { formatContextForPrompt } from '../context/extractor';
import { getGeminiWebConfig, updateGeminiWebConfig } from '../storage/settings-store';
import { getSession, saveSession } from '../storage/session-store';

export class GeminiChatProvider implements IChatProvider {
  readonly id = 'gemini';
  readonly name = 'Google Gemini Web';
  readonly defaultModel = 'gemini-web';
  readonly supportedModels = ['gemini-web'];

  async isConfigured(): Promise<boolean> {
    const config = await getGeminiWebConfig();
    if (!config.selectedTabId) return false;
    try {
      const tab = await chrome.tabs.get(config.selectedTabId);
      return !!(tab && tab.url && tab.url.includes('gemini.google.com'));
    } catch {
      return false;
    }
  }

  async sendMessage(options: SendMessageOptions): Promise<string> {
    let result = '';
    await this.streamMessage({
      ...options,
      callbacks: {
        onChunk: (chunk) => {
          result = chunk;
        },
        onError: (err) => {
          options.callbacks?.onError(err);
        },
        onFinish: (fullText) => {
          result = fullText;
          options.callbacks?.onFinish(fullText);
        },
      },
    });
    return result;
  }

  async streamMessage(options: SendMessageOptions): Promise<void> {
    const config = await getGeminiWebConfig();
    if (!config.selectedTabId) {
      const err = new Error(
        'No active Gemini Web tab selected. Please click the Chetty extension icon and choose "Select Gemini Active Web".'
      );
      options.callbacks?.onError(err);
      throw err;
    }

    if (config.isBusy) {
      const err = new Error('Gemini Web is currently busy generating another response. Please wait for it to finish.');
      options.callbacks?.onError(err);
      throw err;
    }

    // Get session to check for existing geminiConversationId
    const session = await getSession(options.sessionId);
    const contextPrefix = formatContextForPrompt(options.contextSnippet);
    const fullPrompt = contextPrefix + options.currentPrompt;

    console.log('[Chetty:Provider] 🚀 streamMessage started:', {
      sessionId: options.sessionId,
      selectedTabId: config.selectedTabId,
      geminiConversationId: session?.geminiConversationId || null,
      contextLength: contextPrefix.length,
      promptLength: options.currentPrompt.length,
    });

    // Send prompt through background automation broker
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'CHETTY_GEMINI_AUTOMATE_PROMPT',
          tabId: config.selectedTabId,
          sessionId: options.sessionId,
          conversationId: session?.geminiConversationId || null,
          prompt: fullPrompt,
        },
        (response) => {
          console.log('[Chetty:Provider] 📥 Background automation response received:', response);
          if (chrome.runtime.lastError) {
            const err = new Error(chrome.runtime.lastError.message);
            console.error('[Chetty:Provider] ❌ Runtime error from background:', err);
            options.callbacks?.onError(err);
            reject(err);
            return;
          }

          if (!response || !response.success) {
            const err = new Error(response?.error || 'Failed to automate Gemini Web prompt');
            console.error('[Chetty:Provider] ❌ Provider automation failed:', err);
            options.callbacks?.onError(err);
            reject(err);
            return;
          }

          if (response.newConversationId && session && !session.geminiConversationId) {
            console.log('[Chetty:Provider] 🔗 New Gemini conversation mapped to session:', response.newConversationId);
            session.geminiConversationId = response.newConversationId;
            saveSession(session);
          }

          console.log('[Chetty:Provider] ✅ onFinish callback fired with response length:', response.responseText?.length, 'cleanHtml length:', response.cleanHtml?.length);
          options.callbacks?.onFinish(response.responseText, response.cleanHtml);
          resolve();
        }
      );

      // Listen for streaming chunk updates from background
      const chunkListener = (message: any) => {
        if (
          message.type === 'CHETTY_GEMINI_STREAM_CHUNK' &&
          message.sessionId === options.sessionId
        ) {
          console.log('[Chetty:Provider] 🌊 CHETTY_GEMINI_STREAM_CHUNK received in provider:', {
            sessionId: message.sessionId,
            chunkLength: message.chunkText?.length,
            done: message.done,
            aborted: message.aborted,
          });
          if (message.aborted) {
            chrome.runtime.onMessage.removeListener(chunkListener);
            const err = new Error('Prompt was cancelled or force unlocked.');
            console.warn('[Chetty:Provider] 🛑 Generation aborted via message listener.');
            options.callbacks?.onError(err);
            reject(err);
            return;
          }
          options.callbacks?.onChunk(message.chunkText);
          if (message.done) {
            console.log('[Chetty:Provider] 🏁 Stream complete chunk received. Removing listener.');
            chrome.runtime.onMessage.removeListener(chunkListener);
          }
        }
      };
      chrome.runtime.onMessage.addListener(chunkListener);
    });
  }

  /**
   * Render provider settings inside popup: "Select Gemini Active Web"
   */
  async renderPopupSettings(container: HTMLElement): Promise<void> {
    container.innerHTML = `
      <div class="gemini-web-card">
        <div class="gemini-web-header">
          <div class="gemini-web-title">
            <span class="gemini-sparkle">✦</span>
            <span>Select Gemini Active Web</span>
          </div>
          <span class="gemini-status-badge" id="gemini-tab-status">Checking...</span>
        </div>

        <div class="gemini-tab-selector-group">
          <select id="select-gemini-active-tab" class="select-input">
            <option value="" disabled selected>Searching for gemini.google.com tabs...</option>
          </select>
          <button id="btn-refresh-gemini-tabs" class="btn-secondary btn-icon-only" title="Refresh open Gemini tabs">
            🔄
          </button>
        </div>

        <div class="gemini-web-actions">
          <button id="btn-open-gemini-web" class="btn-secondary" style="font-size: 11.5px; width: 100%;">
            🌐 Open gemini.google.com
          </button>
        </div>

        <div class="gemini-web-help" id="gemini-tab-help">
          Chetty automates this tab to generate responses with your signed-in Gemini session.
        </div>

        <!-- Emergency Force Unlock Option -->
        <div class="gemini-unlock-section" id="gemini-unlock-section">
          <div class="gemini-unlock-header">
            <div class="gemini-unlock-title-wrap">
              <span class="gemini-unlock-title">Prompt Lock State</span>
              <span class="gemini-lock-indicator" id="gemini-lock-indicator">Idle</span>
            </div>
            <button id="btn-force-unlock-gemini" class="btn-action-unlock" title="Force release the prompt lock">
              🔓 Force Unlock
            </button>
          </div>
          <div class="gemini-unlock-caution">
            ⚠️ <strong>Caution:</strong> Unlocking releases the lock and stops listening to any stuck in-flight prompt. The pending prompt will need to be retried manually.
          </div>
        </div>
      </div>
    `;

    const selectEl = container.querySelector('#select-gemini-active-tab') as HTMLSelectElement;
    const statusEl = container.querySelector('#gemini-tab-status') as HTMLElement;
    const btnRefresh = container.querySelector('#btn-refresh-gemini-tabs') as HTMLButtonElement;
    const btnOpen = container.querySelector('#btn-open-gemini-web') as HTMLButtonElement;
    const lockIndicator = container.querySelector('#gemini-lock-indicator') as HTMLElement;
    const btnForceUnlock = container.querySelector('#btn-force-unlock-gemini') as HTMLButtonElement;

    const loadTabs = async () => {
      selectEl.innerHTML = '<option value="" disabled selected>Searching...</option>';
      statusEl.textContent = 'Scanning...';
      statusEl.className = 'gemini-status-badge';

      let tabs: chrome.tabs.Tab[] = [];
      try {
        tabs = await chrome.tabs.query({ url: '*://gemini.google.com/*' });
      } catch {
        // Fallback query all
        const allTabs = await chrome.tabs.query({});
        tabs = allTabs.filter((t) => t.url && t.url.includes('gemini.google.com'));
      }

      const currentConfig = await getGeminiWebConfig();

      if (tabs.length === 0) {
        selectEl.innerHTML = '<option value="" disabled selected>No gemini.google.com tab found</option>';
        statusEl.textContent = 'Offline';
        statusEl.className = 'gemini-status-badge offline';
        await updateGeminiWebConfig({ selectedTabId: null, selectedTabTitle: null });
      } else {
        selectEl.innerHTML = '<option value="" disabled>-- Select an Active Gemini Tab --</option>';

        let hasSelected = false;
        for (const tab of tabs) {
          if (!tab.id) continue;
          const opt = document.createElement('option');
          opt.value = String(tab.id);
          const title = tab.title ? tab.title.replace(' - Google Gemini', '') : 'Gemini Web';
          opt.textContent = `[Tab #${tab.id}] ${title.slice(0, 32)}`;

          if (currentConfig.selectedTabId === tab.id) {
            opt.selected = true;
            hasSelected = true;
          }
          selectEl.appendChild(opt);
        }

        if (!hasSelected && tabs.length > 0 && tabs[0].id) {
          // Default to first open tab
          selectEl.value = String(tabs[0].id);
          await updateGeminiWebConfig({
            selectedTabId: tabs[0].id,
            selectedTabTitle: tabs[0].title || 'Gemini Web',
          });
          hasSelected = true;
        }

        if (hasSelected) {
          statusEl.textContent = currentConfig.isBusy ? 'Busy Generating' : 'Connected';
          statusEl.className = `gemini-status-badge ${currentConfig.isBusy ? 'busy' : 'connected'}`;
        }
      }

      // Update Lock indicator state
      if (currentConfig.isBusy) {
        if (lockIndicator) {
          lockIndicator.textContent = 'Locked (Busy)';
          lockIndicator.className = 'gemini-lock-indicator busy';
        }
        if (btnForceUnlock) {
          btnForceUnlock.classList.add('highlight-busy');
        }
      } else {
        if (lockIndicator) {
          lockIndicator.textContent = 'Unlocked (Idle)';
          lockIndicator.className = 'gemini-lock-indicator idle';
        }
        if (btnForceUnlock) {
          btnForceUnlock.classList.remove('highlight-busy');
        }
      }
    };

    selectEl.addEventListener('change', async () => {
      const tabId = parseInt(selectEl.value, 10);
      console.log('[Chetty:Provider] 🖱️ User selected Gemini tabId:', tabId);
      if (tabId) {
        try {
          const tab = await chrome.tabs.get(tabId);
          await updateGeminiWebConfig({
            selectedTabId: tabId,
            selectedTabTitle: tab.title || 'Gemini Web',
          });
          statusEl.textContent = 'Connected';
          statusEl.className = 'gemini-status-badge connected';
          console.log('[Chetty:Provider] ✅ Updated selectedTabId:', tabId, tab.title);
        } catch (e) {
          console.warn('[Chetty:Provider] ⚠️ Selected tab no longer valid, reloading...', e);
          await loadTabs();
        }
      }
    });

    btnRefresh.addEventListener('click', async () => {
      console.log('[Chetty:Provider] 🔄 Refreshing Gemini tabs list...');
      await loadTabs();
    });

    btnOpen.addEventListener('click', async () => {
      console.log('[Chetty:Provider] 🌐 Opening new gemini.google.com tab...');
      await chrome.tabs.create({ url: 'https://gemini.google.com/app' });
      setTimeout(loadTabs, 1000);
    });

    btnForceUnlock?.addEventListener('click', async () => {
      console.log('[Chetty:Provider] 🔓 User clicked Force Unlock button in popup settings.');
      const confirmed = confirm(
        'Force unlock Gemini Web session?\n\n' +
        '⚠️ Caution: Any in-progress prompt request will be released (not listened to) and will need to be retried manually by you.'
      );
      if (!confirmed) return;

      btnForceUnlock.disabled = true;
      btnForceUnlock.textContent = 'Unlocking...';

      try {
        const resp = await chrome.runtime.sendMessage({ type: 'CHETTY_FORCE_UNLOCK_GEMINI' });
        console.log('[Chetty:Provider] 📥 Force unlock response:', resp);
        if (resp && !resp.success && resp.error) {
          throw new Error(resp.error);
        }
        await loadTabs();
      } catch (err) {
        console.error('[Chetty:Provider] ❌ Force unlock failed:', err);
        alert('Failed to unlock: ' + (err as Error).message);
      } finally {
        btnForceUnlock.disabled = false;
        btnForceUnlock.textContent = '🔓 Force Unlock';
      }
    });

    await loadTabs();
  }
}
