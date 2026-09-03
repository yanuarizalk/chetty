import type { IChatProvider } from '../types/provider';
import { GeminiChatProvider } from './gemini';

class ProviderRegistry {
  private providers = new Map<string, IChatProvider>();

  constructor() {
    this.register(new GeminiChatProvider());
  }

  register(provider: IChatProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string = 'gemini'): IChatProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      // Fallback to gemini
      return this.providers.get('gemini')!;
    }
    return provider;
  }

  getAll(): IChatProvider[] {
    return Array.from(this.providers.values());
  }
}

export const providerRegistry = new ProviderRegistry();

export function getChatProvider(id?: string): IChatProvider {
  return providerRegistry.get(id);
}
