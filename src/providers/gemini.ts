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
          if (chrome.runtime.lastError) {
            const err = new Error(chrome.runtime.lastError.message);
            options.callbacks?.onError(err);
            reject(err);
            return;
          }

          if (!response || !response.success) {
            const err = new Error(response?.error || 'Failed to automate Gemini Web prompt');
            options.callbacks?.onError(err);
            reject(err);
            return;
          }

          if (response.newConversationId && session && !session.geminiConversationId) {
            session.geminiConversationId = response.newConversationId;
            saveSession(session);
          }

          options.callbacks?.onFinish(response.responseText);
          resolve();
        }
      );

      // Listen for streaming chunk updates from background
      const chunkListener = (message: any) => {
        if (
          message.type === 'CHETTY_GEMINI_STREAM_CHUNK' &&
          message.sessionId === options.sessionId
        ) {
          options.callbacks?.onChunk(message.chunkText);
          if (message.done) {
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
      </div>
    `;

    const selectEl = container.querySelector('#select-gemini-active-tab') as HTMLSelectElement;
    const statusEl = container.querySelector('#gemini-tab-status') as HTMLElement;
    const btnRefresh = container.querySelector('#btn-refresh-gemini-tabs') as HTMLButtonElement;
    const btnOpen = container.querySelector('#btn-open-gemini-web') as HTMLButtonElement;

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
        return;
      }

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
    };

    selectEl.addEventListener('change', async () => {
      const tabId = parseInt(selectEl.value, 10);
      if (tabId) {
        try {
          const tab = await chrome.tabs.get(tabId);
          await updateGeminiWebConfig({
            selectedTabId: tabId,
            selectedTabTitle: tab.title || 'Gemini Web',
          });
          statusEl.textContent = 'Connected';
          statusEl.className = 'gemini-status-badge connected';
        } catch {
          await loadTabs();
        }
      }
    });

    btnRefresh.addEventListener('click', async () => {
      await loadTabs();
    });

    btnOpen.addEventListener('click', async () => {
      await chrome.tabs.create({ url: 'https://gemini.google.com/app' });
      setTimeout(loadTabs, 1000);
    });

    await loadTabs();
  }
}
