import type { ContextSnippet, TabContextSummary } from '../types/session';

/**
 * Fetch available tabs in the current window from background service worker
 */
export async function getAvailableTabs(): Promise<TabContextSummary[]> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CHETTY_GET_TABS',
    });
    if (response && response.tabs) {
      return response.tabs;
    }
  } catch (err) {
    console.warn('[Chetty] Failed to query available tabs from background:', err);
  }
  return [];
}

/**
 * Extract page context from a specific remote tab
 */
export async function extractRemoteTabContext(tabId: number): Promise<ContextSnippet | null> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CHETTY_EXTRACT_TAB_CONTEXT',
      tabId,
    });
    if (response && response.context) {
      return response.context as ContextSnippet;
    }
  } catch (err) {
    console.error(`[Chetty] Failed to extract context from tab ${tabId}:`, err);
  }
  return null;
}
