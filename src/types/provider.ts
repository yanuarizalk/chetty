import type { ChatMessage, ContextSnippet } from './session';

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onError: (error: Error) => void;
  onFinish: (fullText: string, cleanHtml?: string) => void;
}

export interface SendMessageOptions {
  sessionId: string;
  messages: ChatMessage[];
  currentPrompt: string;
  contextSnippet?: ContextSnippet | null;
  model?: string;
  signal?: AbortSignal;
  callbacks?: StreamCallbacks;
}

export interface IChatProvider {
  readonly id: string;
  readonly name: string;
  readonly defaultModel: string;
  readonly supportedModels: string[];

  isConfigured(): Promise<boolean>;
  sendMessage(options: SendMessageOptions): Promise<string>;
  streamMessage(options: SendMessageOptions): Promise<void>;

  /**
   * Optional method for provider to inject custom settings / connection UI into the extension popup
   */
  renderPopupSettings?(container: HTMLElement): Promise<void>;
}
