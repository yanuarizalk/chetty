import 'deep-chat';
import type { DeepChat } from 'deep-chat';
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
  private deepChatEl: DeepChat | null = null;
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
          <span class="chetty-busy-spinner">⏳</span>
          <span class="chetty-busy-text" id="busy-text-${this.session.id}">Gemini Web is generating...</span>
        </div>

        <!-- Body with Deep Chat -->
        <div class="chetty-body" id="body-${this.session.id}"></div>

        <!-- Resize Handles -->
        <div class="chetty-resize-handle chetty-resize-corner" id="resize-corner-${this.session.id}"></div>
        <div class="chetty-resize-handle chetty-resize-edge-r" id="resize-r-${this.session.id}"></div>
        <div class="chetty-resize-handle chetty-resize-edge-b" id="resize-b-${this.session.id}"></div>
      </div>
    `;

    this.shadowRoot.appendChild(this.container);

    this.mountDeepChat();
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

  private mountDeepChat(): void {
    const bodyEl = this.container.querySelector(`#body-${this.session.id}`);
    if (!bodyEl) return;

    // Create deep-chat custom element
    const deepChat = document.createElement('deep-chat') as DeepChat;
    this.deepChatEl = deepChat;

    // Configure deep-chat options & styles for Chetty
    const isDark = this.settings.theme === 'dark';
    deepChat.setAttribute('style', 'width: 100%; height: 100%;');

    // Deep Chat theme & message styles
    const chat = deepChat as any;
    chat.chatStyle = {
      backgroundColor: 'transparent',
    };

    chat.messageStyles = {
      default: {
        user: {
          bubble: {
            backgroundColor: '#6366f1',
            color: '#ffffff',
            borderRadius: '12px 12px 2px 12px',
          },
        },
        ai: {
          bubble: {
            backgroundColor: isDark ? '#1e293b' : '#f1f5f9',
            color: isDark ? '#f8fafc' : '#0f172a',
            border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
            borderRadius: '12px 12px 12px 2px',
          },
        },
      },
    };

    chat.textInput = {
      placeholder: {
        text: 'Ask Chetty anything about this page...',
      },
      styles: {
        container: {
          backgroundColor: isDark ? '#1e293b' : '#f8fafc',
          borderColor: isDark ? '#334155' : '#e2e8f0',
          borderRadius: '10px',
        },
        text: {
          color: isDark ? '#f8fafc' : '#0f172a',
        },
      },
    };

    chat.submitButtonStyles = {
      submit: {
        container: {
          default: {
            backgroundColor: '#6366f1',
          },
        },
      },
    };

    // Load initial messages from session
    const initialMessages = this.session.messages.map((m) => ({
      role: m.role === 'model' ? 'ai' : m.role,
      text: m.text,
    }));
    chat.initialMessages = initialMessages;

    // Custom Request Handler routing to modular Gemini provider
    chat.request = {
      handler: async (body: any, signals: any) => {
        try {
          const userMessages = body.messages;
          const lastUserMessage = userMessages[userMessages.length - 1];
          const promptText = lastUserMessage?.text || '';

          // 1. Gather active context based on current context mode
          let contextSnippet: ContextSnippet | null = null;

          if (this.state.contextMode === 'current_tab') {
            contextSnippet = await extractCurrentPageContext();
          } else if (this.state.contextMode === 'element_boundary') {
            contextSnippet = this.state.selectedElementContext || (await extractCurrentPageContext());
          } else if (this.state.contextMode === 'other_tab' && this.state.selectedTabId) {
            contextSnippet = await extractRemoteTabContext(this.state.selectedTabId);
          }

          // 2. Persist user message to storage
          await addMessageToSession(this.session.id, {
            role: 'user',
            text: promptText,
            contextSnippet: contextSnippet || undefined,
          });

          // 3. Invoke modular AI provider
          const provider = getChatProvider('gemini');
          let accumulatedResponse = '';

          await provider.streamMessage({
            sessionId: this.session.id,
            messages: this.session.messages,
            currentPrompt: promptText,
            contextSnippet,
            model: provider.defaultModel,
            callbacks: {
              onChunk: (chunk) => {
                accumulatedResponse += chunk;
                signals.onResponse({
                  text: accumulatedResponse,
                  overwrite: true,
                });
              },
              onError: (err) => {
                signals.onResponse({
                  error: err.message,
                });
              },
              onFinish: async (fullText) => {
                // Persist model response to storage
                if (fullText) {
                  await addMessageToSession(this.session.id, {
                    role: 'model',
                    text: fullText,
                  });
                }
              },
            },
          });
        } catch (error) {
          signals.onResponse({
            error: (error as Error).message || 'Failed to generate response',
          });
        }
      },
    };

    bodyEl.appendChild(deepChat);
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
        // Session was deleted across tabs! Close this window immediately.
        this.destroy();
        this.onClose();
        return;
      }
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

      // Update deep-chat messages if new messages came from another tab
      if (this.deepChatEl && updatedSession.messages.length > 0) {
        const formatted = updatedSession.messages.map((m) => ({
          role: m.role === 'model' ? 'ai' : m.role,
          text: m.text,
        }));
        // deepChatEl setMessages method updates chat UI seamlessly
        if (typeof (this.deepChatEl as any).setMessages === 'function') {
          (this.deepChatEl as any).setMessages(formatted);
        }
      }
    });

    // 2. Settings sync (theme, opacity, geminiWeb busy state)
    this.unsubscribeSettings = subscribeSettings((newSettings) => {
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
    const banner = this.container.querySelector(`#busy-banner-${this.session.id}`) as HTMLElement;
    const busyText = this.container.querySelector(`#busy-text-${this.session.id}`) as HTMLElement;
    if (!banner) return;

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
