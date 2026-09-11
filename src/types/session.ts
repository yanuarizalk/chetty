export type MessageRole = 'user' | 'model' | 'system';

export type ContextType = 'none' | 'current_tab' | 'other_tab' | 'element_boundary';

export interface ContextSnippet {
  type: ContextType;
  title?: string;
  url?: string;
  selector?: string;
  content: string;
  summary?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  html?: string;
  timestamp: number;
  contextSnippet?: ContextSnippet;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  contextMode?: ContextType;
  geminiConversationId?: string;
}

export type FloatingMode = 'fixed' | 'sticky';
export type DockPosition = 'none' | 'left' | 'right';

export interface WindowState {
  sessionId: string;
  isOpen: boolean;
  isMinimized: boolean;
  floatingMode: FloatingMode;
  dockPosition: DockPosition;
  isPinned: boolean;
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
  contextMode: ContextType;
  selectedElementContext?: ContextSnippet | null;
  selectedTabId?: number | null;
}

export interface TabContextSummary {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}
