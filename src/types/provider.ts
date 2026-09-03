import type { ChatMessage, ContextSnippet } from './session';

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onError: (error: Error) => void;
  onFinish: (fullText: string) => void;
}

export interface SendMessageOptions {
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
}
