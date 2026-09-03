import { FloatingWindow } from './floating-window';
import type { ChatSession } from '../types/session';
import { createSession, getAllSessions, getSession } from '../storage/session-store';
import { getSettings } from '../storage/settings-store';
import floatingBoxCss from '../styles/floating-box.css?raw';

export class WindowManager {
  private shadowHost: HTMLElement;
  private shadowRoot: ShadowRoot;
  private windows: Map<string, FloatingWindow> = new Map();

  constructor() {
    // 1. Create or attach shadow host
    let host = document.querySelector('chetty-shadow-host') as HTMLElement;
    if (!host) {
      host = document.createElement('chetty-shadow-host');
      host.id = 'chetty-shadow-host';
      host.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        z-index: 2147483640;
        pointer-events: none;
      `;
      document.documentElement.appendChild(host);
    }
    this.shadowHost = host;

    // Attach open shadow root
    this.shadowRoot = host.shadowRoot || host.attachShadow({ mode: 'open' });

    // Inject CSS styles into Shadow DOM
    const styleEl = document.createElement('style');
    styleEl.textContent = floatingBoxCss;
    this.shadowRoot.appendChild(styleEl);

    // Make window wrapper interactive while host is transparent
    const pointerEventsStyle = document.createElement('style');
    pointerEventsStyle.textContent = `
      .chetty-window-wrapper, .chetty-window, .chetty-minimized-pill {
        pointer-events: auto !important;
      }
    `;
    this.shadowRoot.appendChild(pointerEventsStyle);

    this.listenForExtensionMessages();
  }

  public async openNewSession(title?: string): Promise<FloatingWindow> {
    const session = await createSession(title);
    return this.openSession(session);
  }

  public async openSessionById(sessionId: string): Promise<FloatingWindow> {
    // If window is already open in this tab, focus it
    const existing = this.windows.get(sessionId);
    if (existing) {
      existing.focus();
      return existing;
    }

    let session = await getSession(sessionId);
    if (!session) {
      session = await createSession();
    }
    return this.openSession(session);
  }

  public async openSession(session: ChatSession): Promise<FloatingWindow> {
    if (this.windows.has(session.id)) {
      const win = this.windows.get(session.id)!;
      win.focus();
      return win;
    }

    const settings = await getSettings();
    const win = new FloatingWindow(session, settings, this.shadowRoot);
    win.onClose = () => {
      this.windows.delete(session.id);
    };

    this.windows.set(session.id, win);
    return win;
  }

  public getOpenWindows(): FloatingWindow[] {
    return Array.from(this.windows.values());
  }

  private listenForExtensionMessages(): void {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'CHETTY_OPEN_NEW_SESSION') {
        (async () => {
          const win = await this.openNewSession(message.title);
          sendResponse({ success: true, sessionId: win.getSessionId() });
        })();
        return true;
      }

      if (message.type === 'CHETTY_OPEN_SESSION') {
        (async () => {
          const win = await this.openSessionById(message.sessionId);
          sendResponse({ success: true, sessionId: win.getSessionId() });
        })();
        return true;
      }

      if (message.type === 'CHETTY_PING') {
        sendResponse({ success: true, activeWindowsCount: this.windows.size });
        return true;
      }

      return false;
    });
  }
}
