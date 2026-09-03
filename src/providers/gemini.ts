import type { IChatProvider, SendMessageOptions } from '../types/provider';
import { formatContextForPrompt } from '../context/extractor';
import { getValidAccessToken } from '../auth/token-manager';

export class GeminiChatProvider implements IChatProvider {
  readonly id = 'gemini';
  readonly name = 'Google Gemini';
  readonly defaultModel = 'gemini-2.5-flash';
  readonly supportedModels = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.7-flash'];

  async isConfigured(): Promise<boolean> {
    const token = await getValidAccessToken();
    return !!token;
  }

  async sendMessage(options: SendMessageOptions): Promise<string> {
    let fullText = '';
    await this.streamMessage({
      ...options,
      callbacks: {
        onChunk: (chunk) => {
          fullText += chunk;
        },
        onError: (err) => {
          options.callbacks?.onError(err);
        },
        onFinish: (result) => {
          options.callbacks?.onFinish(result);
        },
      },
    });
    return fullText;
  }

  async streamMessage(options: SendMessageOptions): Promise<void> {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      const err = new Error(
        'Not signed in with Google. Please click the Chetty toolbar icon and select "Sign in with Google" to connect your account.'
      );
      options.callbacks?.onError(err);
      throw err;
    }

    const model = options.model || this.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

    // 1. Construct multi-turn contents
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    // Add prior session conversation turns
    for (const msg of options.messages) {
      if (msg.role === 'user') {
        const textWithContext = msg.contextSnippet
          ? formatContextForPrompt(msg.contextSnippet) + msg.text
          : msg.text;
        contents.push({
          role: 'user',
          parts: [{ text: textWithContext }],
        });
      } else if (msg.role === 'model') {
        contents.push({
          role: 'model',
          parts: [{ text: msg.text }],
        });
      }
    }

    // Add the current prompt with current context snippet
    const contextPrefix = formatContextForPrompt(options.contextSnippet);
    contents.push({
      role: 'user',
      parts: [{ text: contextPrefix + options.currentPrompt }],
    });

    const body = {
      contents,
      systemInstruction: {
        parts: [
          {
            text:
              'You are Chetty, a smart and helpful cross-browser floating AI web assistant. ' +
              'You help the user understand, analyze, summarize, and explore content on web pages. ' +
              'When page or element context is provided, use it to give accurate, grounded, and concise answers. ' +
              'Format your responses with clean Markdown.',
          },
        ],
      },
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
      },
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (err) {
      const error = new Error(`Network error calling Gemini: ${(err as Error).message}`);
      options.callbacks?.onError(error);
      throw error;
    }

    if (!response.ok) {
      let errorMsg = `Gemini API error (${response.status} ${response.statusText})`;
      try {
        const errJson = await response.json();
        if (errJson.error?.message) {
          errorMsg = errJson.error.message;
        }
      } catch {
        // use fallback text
      }

      if (response.status === 401) {
        errorMsg = 'Google authentication expired or invalid. Please sign in again via the Chetty popup.';
      }

      const error = new Error(errorMsg);
      options.callbacks?.onError(error);
      throw error;
    }

    if (!response.body) {
      const error = new Error('No response stream received from Gemini');
      options.callbacks?.onError(error);
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const jsonStr = trimmed.replace(/^data:\s*/, '');
          if (jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            const candidates = data.candidates;
            if (candidates && candidates.length > 0) {
              const parts = candidates[0].content?.parts;
              if (parts && parts.length > 0) {
                for (const part of parts) {
                  if (part.text) {
                    accumulatedText += part.text;
                    options.callbacks?.onChunk(part.text);
                  }
                }
              }
            }
          } catch {
            // Ignore incomplete line parse
          }
        }
      }

      options.callbacks?.onFinish(accumulatedText);
    } catch (streamErr) {
      if ((streamErr as Error).name === 'AbortError') {
        options.callbacks?.onFinish(accumulatedText);
        return;
      }
      options.callbacks?.onError(streamErr as Error);
      throw streamErr;
    }
  }
}
