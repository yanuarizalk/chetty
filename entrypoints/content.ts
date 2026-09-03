import { defineContentScript } from 'wxt/utils/define-content-script';
import { WindowManager } from '../src/components/window-manager';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'manual',
  runAt: 'document_idle',
  main() {
    console.log('[Chetty Content Script] Initializing window manager...');
    const manager = new WindowManager();
    // Expose on window for debugging if needed
    (window as any).__chettyManager = manager;
  },
});
