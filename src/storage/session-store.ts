import type { ChatMessage, ChatSession, ContextType } from '../types/session';

const SESSIONS_INDEX_KEY = 'chetty_sessions_list';
const SESSION_PREFIX = 'chetty_session_';

function getSessionKey(id: string): string {
  return `${SESSION_PREFIX}${id}`;
}

export async function getAllSessions(): Promise<ChatSession[]> {
  try {
    const result = await chrome.storage.local.get(SESSIONS_INDEX_KEY);
    const sessionIds: string[] = result[SESSIONS_INDEX_KEY] || [];
    if (sessionIds.length === 0) {
      return [];
    }

    const sessionKeys = sessionIds.map(getSessionKey);
    const sessionData = await chrome.storage.local.get(sessionKeys);

    const sessions: ChatSession[] = [];
    for (const id of sessionIds) {
      const key = getSessionKey(id);
      if (sessionData[key]) {
        sessions.push(sessionData[key]);
      }
    }

    // Sort descending by updated timestamp
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.error('[Chetty] Error fetching sessions:', err);
    return [];
  }
}

export async function getSession(id: string): Promise<ChatSession | null> {
  try {
    const key = getSessionKey(id);
    const data = await chrome.storage.local.get(key);
    return (data[key] as ChatSession) || null;
  } catch (err) {
    console.error(`[Chetty] Error fetching session ${id}:`, err);
    return null;
  }
}

export async function createSession(title?: string, contextMode: ContextType = 'current_tab'): Promise<ChatSession> {
  const id = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  const now = Date.now();

  const newSession: ChatSession = {
    id,
    title: title || `New Chat ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    createdAt: now,
    updatedAt: now,
    messages: [],
    contextMode,
  };

  const key = getSessionKey(id);
  const indexData = await chrome.storage.local.get(SESSIONS_INDEX_KEY);
  const sessionIds: string[] = indexData[SESSIONS_INDEX_KEY] || [];

  if (!sessionIds.includes(id)) {
    sessionIds.unshift(id);
  }

  await chrome.storage.local.set({
    [key]: newSession,
    [SESSIONS_INDEX_KEY]: sessionIds,
  });

  return newSession;
}

export async function saveSession(session: ChatSession): Promise<void> {
  session.updatedAt = Date.now();
  const key = getSessionKey(session.id);
  await chrome.storage.local.set({ [key]: session });
}

export async function addMessageToSession(sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage> {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const fullMessage: ChatMessage = {
    id: 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
    timestamp: Date.now(),
    ...message,
  };

  session.messages.push(fullMessage);
  session.updatedAt = Date.now();

  // Auto-generate title from first user message if title is default
  if (session.messages.length === 1 && message.role === 'user' && session.title.startsWith('New Chat')) {
    const snippet = message.text.trim().slice(0, 32);
    session.title = snippet ? (snippet.length === 32 ? snippet + '...' : snippet) : session.title;
  }

  await saveSession(session);
  return fullMessage;
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  const session = await getSession(sessionId);
  if (session) {
    session.title = title;
    await saveSession(session);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const key = getSessionKey(sessionId);
  const indexData = await chrome.storage.local.get(SESSIONS_INDEX_KEY);
  let sessionIds: string[] = indexData[SESSIONS_INDEX_KEY] || [];
  sessionIds = sessionIds.filter((id) => id !== sessionId);

  await chrome.storage.local.remove(key);
  await chrome.storage.local.set({ [SESSIONS_INDEX_KEY]: sessionIds });
}

/**
 * Subscribe to realtime updates for a specific session across all tabs and windows
 */
export function subscribeToSession(sessionId: string, callback: (session: ChatSession) => void): () => void {
  const key = getSessionKey(sessionId);
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === 'local' && changes[key] && changes[key].newValue) {
      callback(changes[key].newValue as ChatSession);
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

/**
 * Subscribe to any change in session list
 */
export function subscribeToSessionList(callback: (sessionIds: string[]) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === 'local' && changes[SESSIONS_INDEX_KEY]) {
      callback(changes[SESSIONS_INDEX_KEY].newValue || []);
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
