import type { ChatSession, ContextSnippet, ContextType, DockPosition, FloatingMode, WindowState } from '../types/session';
import type { ExtensionSettings } from '../types/settings';
import { addMessageToSession, deleteSession, getSession, subscribeToSession, updateSessionTitle } from '../storage/session-store';
import { getSettings, subscribeSettings } from '../storage/settings-store';
import { getChatProvider } from '../providers/base';
import { extractCurrentPageContext } from '../context/extractor';
import { startElementInspector } from '../context/inspector';
import { getAvailableTabs, extractRemoteTabContext } from '../context/cross-tab';

export class FloatingWindow {
  private container: HTMLElement;
  private shadowRoot: ShadowRoot;
  private session: ChatSession;
  private settings: ExtensionSettings;
  private state: WindowState;
  private isGenerating: boolean = false;
  private pillEl: HTMLElement | null = null;
  private unsubscribeSession: (() => void) | null = null;
  private unsubscribeSettings: (() => void) | null = null;
  public onClose: () => void = () => {};

  constructor(session: ChatSession, settings: ExtensionSettings, shadowRoot: ShadowRoot, initialState?: Partial<WindowState>) {
    this.session = session;
    this.settings = settings;
    this.shadowRoot = shadowRoot;

    // Determine initial position (offset slightly for multiple windows)
    const existingWindows = shadowRoot.querySelectorAll('.chetty-window').length;
    const defaultX = Math.max(20, window.innerWidth - 420 - existingWindows * 30);
    const defaultY = Math.max(20, 80 + existingWindows * 30);

    this.state = {
      sessionId: session.id,
      isOpen: true,
      isMinimized: false,
      floatingMode: initialState?.floatingMode || settings.defaultFloatingMode || 'fixed',
      dockPosition: initialState?.dockPosition || 'none',
      isPinned: initialState?.isPinned || false,
      position: initialState?.position || { x: defaultX, y: defaultY },
      size: initialState?.size || { width: 380, height: 560 },
      contextMode: initialState?.contextMode || session.contextMode || 'current_tab',
      selectedElementContext: null,
      selectedTabId: null,
    };

    this.container = document.createElement('div');
    this.render();
    this.setupListeners();
  }

  public getSessionId(): string {
    return this.session.id;
  }

  public focus(): void {
    if (this.state.isMinimized) {
      this.restore();
    }
    this.container.style.zIndex = '2147483647';
  }

  private render(): void {
    this.container.className = `chetty-window-wrapper chetty-theme-${this.settings.theme}`;

    if (this.state.isMinimized) {
      this.renderMinimizedPill();
      return;
    }

    const { x, y } = this.state.position;
    const { width, height } = this.state.size;

    const dockedClass = this.state.dockPosition === 'left' ? 'docked-left' : this.state.dockPosition === 'right' ? 'docked-right' : '';
    const modeClass = this.state.floatingMode === 'sticky' ? 'mode-sticky' : 'mode-fixed';

    this.container.innerHTML = `
      <div class="chetty-window ${modeClass} ${dockedClass}" id="window-${this.session.id}" style="
        width: ${width}px;
        height: ${height}px;
        opacity: ${this.settings.opacity};
        ${this.getPositionStyle()}
      ">
        <!-- Header -->
        <div class="chetty-header" id="header-${this.session.id}">
          <div class="chetty-header-left">
            <div class="chetty-logo-badge">C</div>
            <span class="chetty-title" title="${this.escapeHtml(this.session.title)}">${this.escapeHtml(this.session.title)}</span>
          </div>
          <div class="chetty-header-controls">
            <!-- Sticky / Fixed Mode Toggle -->
            <button class="chetty-btn-icon ${this.state.floatingMode === 'sticky' ? 'active' : ''}" id="btn-mode-${this.session.id}" title="${this.state.floatingMode === 'sticky' ? 'Sticky mode: Scrolls with page (Click to switch to Fixed)' : 'Fixed mode: Stays in viewport (Click to switch to Sticky)'}">
              ${this.state.floatingMode === 'sticky' ? '📜' : '📌'}
            </button>

            <!-- Pin / Unpin Button (Active when docked) -->
            ${this.state.dockPosition !== 'none' ? `
              <button class="chetty-btn-icon ${this.state.isPinned ? 'active' : ''}" id="btn-pin-${this.session.id}" title="${this.state.isPinned ? 'Pinned: Webpage reflows around chatbox (Click to Unpin)' : 'Unpinned: Floating over webpage without reflow (Click to Pin)'}">
                ${this.state.isPinned ? '🔒' : '🔓'}
              </button>
            ` : ''}

            <!-- Rename Session Button -->
            <button class="chetty-btn-icon" id="btn-rename-${this.session.id}" title="Rename session">
              ✏️
            </button>

            <!-- Delete Session Button -->
            <button class="chetty-btn-icon danger" id="btn-delete-${this.session.id}" title="Delete session across all tabs">
              🗑️
            </button>

            <!-- Minimize Button -->
            <button class="chetty-btn-icon" id="btn-minimize-${this.session.id}" title="Minimize">
              —
            </button>

            <!-- Close Button -->
            <button class="chetty-btn-icon danger" id="btn-close-${this.session.id}" title="Close window on this tab">
              ✕
            </button>
          </div>
        </div>

        <!-- Context Selection Bar -->
        <div class="chetty-context-bar">
          <span class="chetty-context-label">Context:</span>
          <button class="chetty-chip ${this.state.contextMode === 'current_tab' ? 'active' : ''}" data-mode="current_tab" title="Use current page article text">
            📄 Tab
          </button>
          <button class="chetty-chip ${this.state.contextMode === 'element_boundary' ? 'active' : ''}" data-mode="element_boundary" title="Inspect & pick specific HTML element">
            🎯 Element
          </button>
          <button class="chetty-chip ${this.state.contextMode === 'other_tab' ? 'active' : ''}" data-mode="other_tab" title="Use another open tab">
            📑 Cross-Tab
          </button>
          <button class="chetty-chip ${this.state.contextMode === 'none' ? 'active' : ''}" data-mode="none" title="No page context">
            🚫 None
          </button>

          <!-- Context Details / Preview (if element or other tab selected) -->
          <div class="chetty-context-preview" id="context-preview-${this.session.id}" style="${this.getContextPreviewDisplay()}">
            <span class="chetty-context-preview-text" id="context-preview-text-${this.session.id}">
              ${this.getContextPreviewText()}
            </span>
            <button class="chetty-clear-context" id="btn-clear-context-${this.session.id}" title="Reset context">✕</button>
          </div>
        </div>

        <!-- Busy Status Banner -->
        <div class="chetty-busy-banner" id="busy-banner-${this.session.id}">
          <div class="chetty-busy-banner-content">
            <span class="chetty-busy-spinner">⏳</span>
            <span class="chetty-busy-text" id="busy-text-${this.session.id}">Gemini Web is generating...</span>
          </div>
          <button class="chetty-btn-busy-unlock" id="btn-busy-unlock-${this.session.id}" title="Force unlock if prompt is stuck">Unlock</button>
        </div>

        <!-- Messages Area -->
        <div class="chetty-body" id="body-${this.session.id}">
          <div class="chetty-messages" id="messages-${this.session.id}"></div>
        </div>

        <!-- Chat Input Footer -->
        <div class="chetty-footer" id="footer-${this.session.id}">
          <div class="chetty-input-wrapper">
            <textarea
              class="chetty-textarea"
              id="input-${this.session.id}"
              placeholder="Ask Chetty anything about this page... (Enter to send, Shift+Enter for newline)"
              rows="1"
            ></textarea>
            <button class="chetty-btn-send" id="btn-send-${this.session.id}" title="Send message (Enter)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
          <div class="chetty-footer-info">
            <span class="chetty-footer-shortcut">↵ Send • Shift+↵ Newline</span>
            <span class="chetty-footer-model-badge">✦ Gemini Web</span>
          </div>
        </div>

        <!-- Resize Handles -->
        <div class="chetty-resize-handle chetty-resize-corner" id="resize-corner-${this.session.id}"></div>
        <div class="chetty-resize-handle chetty-resize-edge-r" id="resize-r-${this.session.id}"></div>
        <div class="chetty-resize-handle chetty-resize-edge-b" id="resize-b-${this.session.id}"></div>
      </div>
    `;

    this.shadowRoot.appendChild(this.container);

    this.initChatUI();
    this.updateBusyState(this.settings.geminiWeb?.isBusy || false, this.settings.geminiWeb?.busySessionId);
    this.bindHeaderControls();
    this.bindDragAndResize();
    this.bindContextControls();
    this.applyViewportReflow();
  }

  private getPositionStyle(): string {
    if (this.state.dockPosition === 'left') {
      return 'left: 0 !important; top: 0 !important;';
    }
    if (this.state.dockPosition === 'right') {
      return 'right: 0 !important; left: auto !important; top: 0 !important;';
    }

    if (this.state.floatingMode === 'sticky') {
      // Relative to page scroll
      const pageTop = this.state.position.y + window.scrollY;
      const pageLeft = this.state.position.x + window.scrollX;
      return `left: ${pageLeft}px; top: ${pageTop}px;`;
    }

    return `left: ${this.state.position.x}px; top: ${this.state.position.y}px;`;
  }

  private getContextPreviewDisplay(): string {
    if (this.state.contextMode === 'element_boundary' && this.state.selectedElementContext) {
      return 'display: flex;';
    }
    if (this.state.contextMode === 'other_tab' && this.state.selectedTabId) {
      return 'display: flex;';
    }
    return 'display: none;';
  }

  private getContextPreviewText(): string {
    if (this.state.contextMode === 'element_boundary' && this.state.selectedElementContext) {
      return `🎯 Bound: ${this.state.selectedElementContext.selector || 'Element'}`;
    }
    if (this.state.contextMode === 'other_tab' && this.state.selectedTabId) {
      return `📑 Tab Context: Tab #${this.state.selectedTabId}`;
    }
    return '';
  }

  private initChatUI(): void {
    const textarea = this.container.querySelector(`#input-${this.session.id}`) as HTMLTextAreaElement;
    const btnSend = this.container.querySelector(`#btn-send-${this.session.id}`) as HTMLButtonElement;

    if (textarea) {
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(120, textarea.scrollHeight)}px`;
      });

      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSendInput();
        }
      });
    }

    if (btnSend) {
      btnSend.addEventListener('click', () => {
        this.handleSendInput();
      });
    }

    // Force unlock button on busy banner
    const btnUnlock = this.container.querySelector(`#btn-busy-unlock-${this.session.id}`);
    btnUnlock?.addEventListener('click', async (e) => {
      e.stopPropagation();
      console.log('[Chetty:Chatbox] 🔓 Force unlock button clicked in busy banner for session:', this.session.id);
      const confirmed = confirm(
        'Force unlock Gemini Web session?\n\n' +
        '⚠️ Caution: Any in-progress prompt request will be released (not listened to) and will need to be retried manually.'
      );
      if (confirmed) {
        try {
          console.log('[Chetty:Chatbox] 🔓 Sending CHETTY_FORCE_UNLOCK_GEMINI message to background...');
          await chrome.runtime.sendMessage({ type: 'CHETTY_FORCE_UNLOCK_GEMINI' });
          console.log('[Chetty:Chatbox] 🔓 CHETTY_FORCE_UNLOCK_GEMINI message sent successfully');
        } catch (err) {
          console.error('[Chetty:Chatbox] ❌ Failed to force unlock:', err);
        }
      }
    });

    this.renderMessages();
  }

  private async handleSendInput(): Promise<void> {
    const textarea = this.container.querySelector(`#input-${this.session.id}`) as HTMLTextAreaElement;
    if (!textarea) return;

    const text = textarea.value.trim();
    console.log('[Chetty:Chatbox] 💬 handleSendInput triggered:', {
      sessionId: this.session.id,
      textLength: text.length,
      isGenerating: this.isGenerating,
      isBusy: this.settings.geminiWeb?.isBusy,
      busySessionId: this.settings.geminiWeb?.busySessionId,
    });

    if (!text || this.isGenerating || this.settings.geminiWeb?.isBusy) {
      if (!text) console.log('[Chetty:Chatbox] 💬 Empty input text ignored');
      if (this.isGenerating) console.warn('[Chetty:Chatbox] ⚠️ Ignored send: already generating');
      if (this.settings.geminiWeb?.isBusy) console.warn('[Chetty:Chatbox] ⚠️ Ignored send: Gemini Web is busy');
      return;
    }

    textarea.value = '';
    textarea.style.height = 'auto';
    await this.sendMessage(text);
  }

  private async sendMessage(promptText: string): Promise<void> {
    console.log('[Chetty:Chatbox] 🚀 sendMessage started:', {
      sessionId: this.session.id,
      promptPreview: promptText.slice(0, 60),
      contextMode: this.state.contextMode,
      isBusy: this.settings.geminiWeb?.isBusy,
    });

    if (this.isGenerating || this.settings.geminiWeb?.isBusy) {
      console.warn('[Chetty:Chatbox] ⚠️ Blocked sendMessage because isGenerating or isBusy is true');
      alert('Gemini Web is currently busy. Please wait for the active generation to finish.');
      return;
    }

    this.isGenerating = true;

    // 1. Gather context
    let contextSnippet: ContextSnippet | null = null;
    if (this.state.contextMode === 'current_tab') {
      contextSnippet = await extractCurrentPageContext();
    } else if (this.state.contextMode === 'element_boundary') {
      contextSnippet = this.state.selectedElementContext || (await extractCurrentPageContext());
    } else if (this.state.contextMode === 'other_tab' && this.state.selectedTabId) {
      contextSnippet = await extractRemoteTabContext(this.state.selectedTabId);
    }
    console.log('[Chetty:Chatbox] 📄 Context gathered:', {
      hasContext: !!contextSnippet,
      selector: contextSnippet?.selector,
      contentLength: contextSnippet?.content?.length,
    });

    // 2. Persist user message to session
    console.log('[Chetty:Chatbox] 💾 Adding user message to session...');
    await addMessageToSession(this.session.id, {
      role: 'user',
      text: promptText,
      contextSnippet: contextSnippet || undefined,
    });

    // 3. Render updated messages
    this.renderMessages();

    // 4. Create streaming AI bubble placeholder
    const messagesEl = this.container.querySelector(`#messages-${this.session.id}`);
    const streamingRow = document.createElement('div');
    streamingRow.className = 'chetty-msg-row ai';
    streamingRow.id = `streaming-${this.session.id}`;
    streamingRow.innerHTML = `
      <div class="chetty-msg-author">✦ Chetty</div>
      <div class="chetty-msg-bubble">
        <span class="chetty-streaming-content">Thinking...</span>
        <span class="chetty-cursor"></span>
      </div>
    `;
    messagesEl?.appendChild(streamingRow);
    this.scrollToBottom();

    // 5. Invoke Gemini Web Provider
    const provider = getChatProvider('gemini');
    let accumulatedResponse = '';

    try {
      console.log('[Chetty:Chatbox] 📡 Invoking provider.streamMessage...');
      await provider.streamMessage({
        sessionId: this.session.id,
        messages: this.session.messages,
        currentPrompt: promptText,
        contextSnippet,
        model: provider.defaultModel,
        callbacks: {
          onChunk: (chunk) => {
            accumulatedResponse = chunk;
            console.log('[Chetty:Chatbox] 🌊 onChunk received:', {
              chunkLength: chunk.length,
              preview: chunk.slice(-40).replace(/\n/g, ' '),
            });
            const contentEl = streamingRow.querySelector('.chetty-streaming-content');
            if (contentEl) {
              contentEl.innerHTML = this.formatMessageText(accumulatedResponse);
            }
            this.scrollToBottom();
          },
          onError: (err) => {
            console.error('[Chetty:Chatbox] ❌ onError in streamMessage:', err);
            const contentEl = streamingRow.querySelector('.chetty-streaming-content');
            if (contentEl) {
              contentEl.innerHTML = `<span style="color:var(--chetty-danger);">⚠️ ${this.escapeHtml(err.message)}</span>`;
            }
            const cursor = streamingRow.querySelector('.chetty-cursor');
            cursor?.remove();
            this.isGenerating = false;
          },
          onFinish: async (fullText) => {
            const final = fullText || accumulatedResponse;
            console.log('[Chetty:Chatbox] 🏁 onFinish received:', {
              finalLength: final.length,
              preview: final.slice(0, 80).replace(/\n/g, ' '),
            });
            if (final) {
              await addMessageToSession(this.session.id, {
                role: 'model',
                text: final,
              });
            }
            this.isGenerating = false;
            this.renderMessages();
          },
        },
      });
    } catch (err) {
      console.error('[Chetty:Chatbox] 💥 Exception in sendMessage:', err);
      const contentEl = streamingRow.querySelector('.chetty-streaming-content');
      if (contentEl) {
        contentEl.innerHTML = `<span style="color:var(--chetty-danger);">⚠️ ${(err as Error).message}</span>`;
      }
      const cursor = streamingRow.querySelector('.chetty-cursor');
      cursor?.remove();
      this.isGenerating = false;
    }
  }

  private renderMessages(): void {
    const messagesEl = this.container.querySelector(`#messages-${this.session.id}`);
    if (!messagesEl) return;

    if (this.session.messages.length === 0) {
      messagesEl.innerHTML = `
        <div class="chetty-welcome-card">
          <div class="chetty-welcome-icon">✦</div>
          <div class="chetty-welcome-title">How can Chetty help you?</div>
          <div class="chetty-welcome-subtitle">
            Ask questions, summarize this webpage, or extract key insights with your signed-in Gemini session.
          </div>
          <div class="chetty-suggestions-grid">
            <button class="chetty-suggestion-btn" data-prompt="Summarize this webpage into 3 concise bullet points.">
              📝 Summarize this page
            </button>
            <button class="chetty-suggestion-btn" data-prompt="What are the most important takeaways from this article?">
              🔍 Key takeaways & insights
            </button>
            <button class="chetty-suggestion-btn" data-prompt="Explain the core concept on this page in simple terms.">
              💡 Explain in simple terms
            </button>
          </div>
        </div>
      `;

      const btns = messagesEl.querySelectorAll('.chetty-suggestion-btn');
      btns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const prompt = btn.getAttribute('data-prompt');
          if (prompt) this.sendMessage(prompt);
        });
      });
      return;
    }

    let html = '';
    for (const msg of this.session.messages) {
      const isUser = msg.role === 'user';
      const timeStr = msg.timestamp
        ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

      if (isUser) {
        const contextBadge = msg.contextSnippet
          ? `<div class="chetty-msg-context-tag">📄 Context Attached</div>`
          : '';
        html += `
          <div class="chetty-msg-row user">
            ${contextBadge}
            <div class="chetty-msg-bubble">${this.escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>
            ${timeStr ? `<div class="chetty-msg-time">${timeStr}</div>` : ''}
          </div>
        `;
      } else {
        html += `
          <div class="chetty-msg-row ai">
            <div class="chetty-msg-author">✦ Chetty</div>
            <div class="chetty-msg-bubble">${this.formatMessageText(msg.text)}</div>
            ${timeStr ? `<div class="chetty-msg-time">${timeStr}</div>` : ''}
          </div>
        `;
      }
    }

    messagesEl.innerHTML = html;
    this.scrollToBottom();
  }

  private formatMessageText(text: string): string {
    const escaped = this.escapeHtml(text);
    // Code blocks: ```lang ... ```
    const withCodeBlocks = escaped.replace(/```([a-z]*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
      return `<pre><code>${code}</code></pre>`;
    });
    // Inline code: `code`
    const withInlineCode = withCodeBlocks.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold: **text**
    const withBold = withInlineCode.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Convert newlines to <br> outside <pre>
    const parts = withBold.split(/(<pre>[\s\S]*?<\/pre>)/);
    return parts.map((part) => (part.startsWith('<pre>') ? part : part.replace(/\n/g, '<br>'))).join('');
  }

  private scrollToBottom(): void {
    const messagesEl = this.container.querySelector(`#messages-${this.session.id}`);
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  private updatePinButtonUI(btnPin: HTMLElement): void {
    btnPin.textContent = this.state.isPinned ? '🔒' : '🔓';
    btnPin.title = this.state.isPinned
      ? 'Pinned: Webpage reflows around chatbox (Click to Unpin)'
      : 'Unpinned: Floating over webpage without reflow (Click to Pin)';
    btnPin.classList.toggle('active', this.state.isPinned);
  }

  private updateModeButtonUI(btnMode: HTMLElement): void {
    btnMode.textContent = this.state.floatingMode === 'sticky' ? '📜' : '📌';
    btnMode.title = this.state.floatingMode === 'sticky'
      ? 'Sticky mode: Scrolls with page (Click to switch to Fixed)'
      : 'Fixed mode: Stays in viewport (Click to switch to Sticky)';
    btnMode.classList.toggle('active', this.state.floatingMode === 'sticky');
  }

  private bindHeaderControls(): void {
    // Mode toggle (Sticky vs Fixed)
    const btnMode = this.container.querySelector(`#btn-mode-${this.session.id}`) as HTMLElement;
    btnMode?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.state.dockPosition !== 'none') {
        // Un-dock first if docked
        this.state.dockPosition = 'none';
        this.resetViewportReflow();
      }
      this.state.floatingMode = this.state.floatingMode === 'fixed' ? 'sticky' : 'fixed';
      this.updateModeButtonUI(btnMode);
      this.refreshWindowStyle();
    });

    // Pin toggle (When docked)
    const btnPin = this.container.querySelector(`#btn-pin-${this.session.id}`) as HTMLElement;
    btnPin?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.state.isPinned = !this.state.isPinned;
      this.updatePinButtonUI(btnPin);
      this.applyViewportReflow();
    });

    // Rename Session
    const btnRename = this.container.querySelector(`#btn-rename-${this.session.id}`);
    btnRename?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const currentTitle = this.session.title;
      const newTitle = prompt('Enter new session title:', currentTitle);
      if (newTitle !== null && newTitle.trim() && newTitle.trim() !== currentTitle) {
        const trimmed = newTitle.trim();
        await updateSessionTitle(this.session.id, trimmed);
        this.session.title = trimmed;
        const titleEl = this.container.querySelector('.chetty-title');
        if (titleEl) {
          titleEl.textContent = trimmed;
          titleEl.setAttribute('title', trimmed);
        }
      }
    });

    // Delete Session
    const btnDelete = this.container.querySelector(`#btn-delete-${this.session.id}`);
    btnDelete?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = confirm(
        `Are you sure you want to delete session "${this.session.title}"?\n\nThis will remove the conversation and close it across all open browser tabs.`
      );
      if (confirmed) {
        await deleteSession(this.session.id);
        this.destroy();
        this.onClose();
      }
    });

    // Minimize
    const btnMin = this.container.querySelector(`#btn-minimize-${this.session.id}`);
    btnMin?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.minimize();
    });

    // Close
    const btnClose = this.container.querySelector(`#btn-close-${this.session.id}`);
    btnClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.destroy();
      this.onClose();
    });
  }

  private bindContextControls(): void {
    const chips = this.container.querySelectorAll('.chetty-chip');
    chips.forEach((chip) => {
      chip.addEventListener('click', async (e) => {
        const mode = (e.currentTarget as HTMLElement).getAttribute('data-mode') as ContextType;
        chips.forEach((c) => c.classList.remove('active'));
        (e.currentTarget as HTMLElement).classList.add('active');
        this.state.contextMode = mode;

        if (mode === 'element_boundary') {
          // Trigger inspector mode!
          const snippet = await startElementInspector();
          if (snippet) {
            this.state.selectedElementContext = snippet;
            this.updateContextPreview();
          } else {
            // Revert to tab if cancelled
            this.state.contextMode = 'current_tab';
            this.updateContextChips();
          }
        } else if (mode === 'other_tab') {
          // Query tabs and show prompt
          await this.promptOtherTabSelection();
        } else {
          this.state.selectedElementContext = null;
          this.state.selectedTabId = null;
          this.updateContextPreview();
        }
      });
    });

    const btnClearContext = this.container.querySelector(`#btn-clear-context-${this.session.id}`);
    btnClearContext?.addEventListener('click', () => {
      this.state.selectedElementContext = null;
      this.state.selectedTabId = null;
      this.state.contextMode = 'current_tab';
      this.updateContextChips();
      this.updateContextPreview();
    });
  }

  private async promptOtherTabSelection(): Promise<void> {
    const tabs = await getAvailableTabs();
    if (tabs.length === 0) {
      alert('No other active tabs available to pull context from.');
      this.state.contextMode = 'current_tab';
      this.updateContextChips();
      return;
    }

    // Prompt user to pick a tab
    const tabListStr = tabs.map((t, i) => `${i + 1}. ${t.title.slice(0, 40)} (${t.url.slice(0, 30)}...)`).join('\n');
    const pick = prompt(`Select tab number to use as context:\n\n${tabListStr}`, '1');
    if (pick) {
      const idx = parseInt(pick, 10) - 1;
      if (idx >= 0 && idx < tabs.length) {
        this.state.selectedTabId = tabs[idx].id;
        this.updateContextPreview();
        return;
      }
    }
    this.state.contextMode = 'current_tab';
    this.updateContextChips();
  }

  private updateContextChips(): void {
    const chips = this.container.querySelectorAll('.chetty-chip');
    chips.forEach((chip) => {
      const mode = chip.getAttribute('data-mode');
      chip.classList.toggle('active', mode === this.state.contextMode);
    });
  }

  private updateContextPreview(): void {
    const previewEl = this.container.querySelector(`#context-preview-${this.session.id}`) as HTMLElement;
    const previewTextEl = this.container.querySelector(`#context-preview-text-${this.session.id}`);
    if (previewEl && previewTextEl) {
      previewEl.style.cssText = this.getContextPreviewDisplay();
      previewTextEl.textContent = this.getContextPreviewText();
    }
  }

  private bindDragAndResize(): void {
    const header = this.container.querySelector(`#header-${this.session.id}`) as HTMLElement;
    const windowEl = this.container.querySelector(`#window-${this.session.id}`) as HTMLElement;
    const corner = this.container.querySelector(`#resize-corner-${this.session.id}`) as HTMLElement;
    const edgeR = this.container.querySelector(`#resize-r-${this.session.id}`) as HTMLElement;
    const edgeB = this.container.querySelector(`#resize-b-${this.session.id}`) as HTMLElement;

    // --- DRAGGING LOGIC ---
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialX = 0;
    let initialY = 0;

    const onMouseDownHeader = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.chetty-header-controls')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      initialX = this.state.position.x;
      initialY = this.state.position.y;
      document.addEventListener('mousemove', onMouseMoveDrag);
      document.addEventListener('mouseup', onMouseUpDrag);
    };

    const onMouseMoveDrag = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;

      let newX = initialX + dx;
      let newY = initialY + dy;

      // Check Docking Snapping (within 35px of screen edges)
      const dockThreshold = 35;
      if (newX <= dockThreshold) {
        // Snap left
        if (this.state.dockPosition !== 'left') {
          this.state.dockPosition = 'left';
          this.state.floatingMode = 'fixed';
          this.refreshWindowStyle();
        }
        return;
      } else if (newX + this.state.size.width >= window.innerWidth - dockThreshold) {
        // Snap right
        if (this.state.dockPosition !== 'right') {
          this.state.dockPosition = 'right';
          this.state.floatingMode = 'fixed';
          this.refreshWindowStyle();
        }
        return;
      } else if (this.state.dockPosition !== 'none') {
        // Break out of dock
        this.state.dockPosition = 'none';
        this.resetViewportReflow();
        this.refreshWindowStyle();
      }

      // Constrain inside viewport
      newX = Math.max(10, Math.min(window.innerWidth - this.state.size.width - 10, newX));
      newY = Math.max(10, Math.min(window.innerHeight - 80, newY));

      this.state.position = { x: newX, y: newY };
      windowEl.style.left = `${newX}px`;
      windowEl.style.top = `${newY}px`;
      windowEl.style.right = 'auto';
    };

    const onMouseUpDrag = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMoveDrag);
      document.removeEventListener('mouseup', onMouseUpDrag);
      this.applyViewportReflow();
    };

    header.addEventListener('mousedown', onMouseDownHeader);

    // --- RESIZING LOGIC ---
    let isResizing = false;
    let resizeStartX = 0;
    let resizeStartY = 0;
    let initialW = 0;
    let initialH = 0;

    const startResize = (e: MouseEvent) => {
      e.stopPropagation();
      isResizing = true;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      initialW = this.state.size.width;
      initialH = this.state.size.height;
      document.addEventListener('mousemove', onMouseMoveResize);
      document.addEventListener('mouseup', onMouseUpResize);
    };

    const onMouseMoveResize = (e: MouseEvent) => {
      if (!isResizing) return;
      const dw = e.clientX - resizeStartX;
      const dh = e.clientY - resizeStartY;

      const newW = Math.max(300, Math.min(window.innerWidth * 0.85, initialW + dw));
      const newH = Math.max(380, Math.min(window.innerHeight * 0.9, initialH + dh));

      this.state.size = { width: newW, height: newH };
      windowEl.style.width = `${newW}px`;
      if (this.state.dockPosition === 'none') {
        windowEl.style.height = `${newH}px`;
      }
      this.applyViewportReflow();
    };

    const onMouseUpResize = () => {
      isResizing = false;
      document.removeEventListener('mousemove', onMouseMoveResize);
      document.removeEventListener('mouseup', onMouseUpResize);
    };

    corner.addEventListener('mousedown', startResize);
    edgeR.addEventListener('mousedown', startResize);
    edgeB.addEventListener('mousedown', startResize);
  }

  private refreshWindowStyle(): void {
    const windowEl = this.container.querySelector(`#window-${this.session.id}`) as HTMLElement;
    if (!windowEl) return;

    windowEl.className = `chetty-window ${this.state.floatingMode === 'sticky' ? 'mode-sticky' : 'mode-fixed'} ${
      this.state.dockPosition === 'left' ? 'docked-left' : this.state.dockPosition === 'right' ? 'docked-right' : ''
    }`;

    // Update position
    windowEl.style.cssText = `
      width: ${this.state.size.width}px;
      height: ${this.state.dockPosition !== 'none' ? '100vh' : this.state.size.height + 'px'};
      opacity: ${this.settings.opacity};
      ${this.getPositionStyle()}
    `;

    // Re-render pin button if needed
    const controls = this.container.querySelector('.chetty-header-controls');
    let btnPin = this.container.querySelector(`#btn-pin-${this.session.id}`) as HTMLElement;
    if (this.state.dockPosition !== 'none' && !btnPin && controls) {
      const pinHtml = `
        <button class="chetty-btn-icon ${this.state.isPinned ? 'active' : ''}" id="btn-pin-${this.session.id}" title="${this.state.isPinned ? 'Pinned: Webpage reflows around chatbox (Click to Unpin)' : 'Unpinned: Floating over webpage without reflow (Click to Pin)'}">
          ${this.state.isPinned ? '🔒' : '🔓'}
        </button>
      `;
      const btnRename = controls.querySelector(`#btn-rename-${this.session.id}`);
      if (btnRename) {
        btnRename.insertAdjacentHTML('beforebegin', pinHtml);
      } else {
        controls.insertAdjacentHTML('afterbegin', pinHtml);
      }
      btnPin = this.container.querySelector(`#btn-pin-${this.session.id}`) as HTMLElement;
      btnPin?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.isPinned = !this.state.isPinned;
        this.updatePinButtonUI(btnPin);
        this.applyViewportReflow();
      });
    } else if (this.state.dockPosition === 'none' && btnPin) {
      btnPin.remove();
    } else if (btnPin) {
      this.updatePinButtonUI(btnPin);
    }
  }

  private applyViewportReflow(): void {
    if (this.state.dockPosition !== 'none' && this.state.isPinned) {
      const width = this.state.size.width;
      if (this.state.dockPosition === 'left') {
        document.documentElement.style.marginLeft = `${width}px`;
        document.documentElement.style.marginRight = '0px';
        document.documentElement.style.width = `calc(100% - ${width}px)`;
      } else {
        document.documentElement.style.marginRight = `${width}px`;
        document.documentElement.style.marginLeft = '0px';
        document.documentElement.style.width = `calc(100% - ${width}px)`;
      }
      document.documentElement.style.transition = 'margin 0.2s ease, width 0.2s ease';
    } else {
      this.resetViewportReflow();
    }
  }

  private resetViewportReflow(): void {
    document.documentElement.style.marginLeft = '';
    document.documentElement.style.marginRight = '';
    document.documentElement.style.width = '';
  }

  public minimize(): void {
    this.state.isMinimized = true;
    this.resetViewportReflow();
    this.container.innerHTML = '';
    this.renderMinimizedPill();
  }

  public restore(): void {
    this.state.isMinimized = false;
    this.container.innerHTML = '';
    this.render();
  }

  private renderMinimizedPill(): void {
    const pill = document.createElement('div');
    pill.className = `chetty-minimized-pill chetty-theme-${this.settings.theme}`;
    pill.id = `pill-${this.session.id}`;
    pill.style.left = `${Math.min(window.innerWidth - 200, this.state.position.x)}px`;
    pill.style.top = `${Math.min(window.innerHeight - 60, this.state.position.y)}px`;

    pill.innerHTML = `
      <div class="chetty-logo-badge" style="width:20px;height:20px;font-size:11px;">C</div>
      <span class="chetty-status-dot"></span>
      <span class="chetty-minimized-pill-title">${this.escapeHtml(this.session.title)}</span>
      <span style="font-size:11px;opacity:0.7;">↗</span>
    `;

    pill.addEventListener('click', () => {
      this.restore();
    });

    this.container.appendChild(pill);
    this.shadowRoot.appendChild(this.container);
  }

  private setupListeners(): void {
    // 1. Cross-tab & Multi-window session sync
    this.unsubscribeSession = subscribeToSession(this.session.id, (updatedSession) => {
      if (!updatedSession) {
        console.log('[Chetty:Chatbox] 🗑️ Session was deleted across tabs, closing window:', this.session.id);
        // Session was deleted across tabs! Close this window immediately.
        this.destroy();
        this.onClose();
        return;
      }
      console.log('[Chetty:Chatbox] 🔄 Session updated from storage/sync:', {
        sessionId: this.session.id,
        title: updatedSession.title,
        messageCount: updatedSession.messages.length,
      });
      this.session = updatedSession;
      // Update header title
      const titleEl = this.container.querySelector('.chetty-title');
      if (titleEl) {
        titleEl.textContent = updatedSession.title;
        titleEl.setAttribute('title', updatedSession.title);
      }
      const pillTitleEl = this.container.querySelector('.chetty-minimized-pill-title');
      if (pillTitleEl) {
        pillTitleEl.textContent = updatedSession.title;
      }

      // Re-render messages if messages arrived from another tab
      if (!this.isGenerating) {
        this.renderMessages();
      }
    });

    // 2. Settings sync (theme, opacity, geminiWeb busy state)
    this.unsubscribeSettings = subscribeSettings((newSettings) => {
      console.log('[Chetty:Chatbox] ⚙️ Settings updated from storage:', {
        theme: newSettings.theme,
        opacity: newSettings.opacity,
        isBusy: newSettings.geminiWeb?.isBusy,
        busySessionId: newSettings.geminiWeb?.busySessionId,
      });
      this.settings = newSettings;
      this.container.className = `chetty-window-wrapper chetty-theme-${newSettings.theme}`;
      const windowEl = this.container.querySelector('.chetty-window') as HTMLElement;
      if (windowEl) {
        windowEl.style.opacity = `${newSettings.opacity}`;
      }
      this.updateBusyState(newSettings.geminiWeb?.isBusy || false, newSettings.geminiWeb?.busySessionId);
    });
  }

  private updateBusyState(isBusy: boolean, busySessionId?: string | null): void {
    console.log('[Chetty:Chatbox] 🚦 updateBusyState invoked:', {
      isBusy,
      busySessionId,
      windowSessionId: this.session.id,
      matchesCurrentSession: busySessionId === this.session.id,
    });
    const banner = this.container.querySelector(`#busy-banner-${this.session.id}`) as HTMLElement;
    const busyText = this.container.querySelector(`#busy-text-${this.session.id}`) as HTMLElement;
    const textarea = this.container.querySelector(`#input-${this.session.id}`) as HTMLTextAreaElement;
    const btnSend = this.container.querySelector(`#btn-send-${this.session.id}`) as HTMLButtonElement;

    if (banner) {
      if (isBusy) {
        banner.style.display = 'flex';
        if (busySessionId && busySessionId !== this.session.id) {
          if (busyText) busyText.textContent = 'Gemini Web is generating in another window... Input locked.';
        } else {
          if (busyText) busyText.textContent = 'Generating response via Gemini Web...';
        }
      } else {
        banner.style.display = 'none';
      }
    }

    if (textarea && btnSend) {
      if (isBusy) {
        textarea.disabled = true;
        textarea.placeholder = 'Gemini Web is generating... Please wait.';
        btnSend.disabled = true;
      } else {
        textarea.disabled = false;
        textarea.placeholder = 'Ask Chetty anything about this page... (Enter to send, Shift+Enter for newline)';
        btnSend.disabled = false;
      }
    }
  }

  public destroy(): void {
    this.resetViewportReflow();
    if (this.unsubscribeSession) this.unsubscribeSession();
    if (this.unsubscribeSettings) this.unsubscribeSettings();
    this.container.remove();
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
