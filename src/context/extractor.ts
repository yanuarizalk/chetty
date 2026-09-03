import { extractFromHtml } from '@extractus/article-extractor';
import type { ContextSnippet } from '../types/session';

/**
 * Extract clean context from the current page using article-extractor with smart DOM fallback
 */
export async function extractCurrentPageContext(): Promise<ContextSnippet> {
  const url = window.location.href;
  const title = document.title || window.location.hostname;

  // 1. If user has text actively highlighted/selected on page, prioritize it!
  const selection = window.getSelection()?.toString().trim();
  if (selection && selection.length > 10) {
    return {
      type: 'current_tab',
      title: `${title} (Selected Text)`,
      url,
      content: selection,
      summary: `User selection from ${title} (${selection.length} chars)`,
    };
  }

  // 2. Try @extractus/article-extractor
  try {
    const rawHtml = document.documentElement.outerHTML;
    const article = await extractFromHtml(rawHtml, url);

    if (article && article.content) {
      // Clean HTML tags from extracted article content
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = article.content;
      const cleanText = tempDiv.textContent || tempDiv.innerText || '';

      if (cleanText.trim().length > 100) {
        return {
          type: 'current_tab',
          title: article.title || title,
          url,
          content: cleanText.trim().slice(0, 15000), // safe token limit
          summary: article.description || `Article extracted from ${title}`,
        };
      }
    }
  } catch (err) {
    console.warn('[Chetty] article-extractor failed or page is not an article, falling back to DOM scraper:', err);
  }

  // 3. Fallback: Smart DOM scraping (removes scripts, styles, navigations)
  const clone = document.body.cloneNode(true) as HTMLElement;
  // Remove chetty itself and scripts/styles/navs
  const toRemove = clone.querySelectorAll('script, style, noscript, nav, header, footer, iframe, svg, [aria-hidden="true"], chetty-shadow-host');
  toRemove.forEach((el) => el.remove());

  const pageText = (clone.textContent || clone.innerText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 15000);

  const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

  return {
    type: 'current_tab',
    title,
    url,
    content: pageText,
    summary: metaDesc || `Webpage content from ${title}`,
  };
}

/**
 * Format a context snippet into a clear prompt prefix for the LLM
 */
export function formatContextForPrompt(contextSnippet?: ContextSnippet | null): string {
  if (!contextSnippet || !contextSnippet.content) {
    return '';
  }

  const header = `[Context Information - ${contextSnippet.type.toUpperCase()}]`;
  const meta = [
    contextSnippet.title ? `Title: ${contextSnippet.title}` : '',
    contextSnippet.url ? `URL: ${contextSnippet.url}` : '',
    contextSnippet.selector ? `DOM Selector: ${contextSnippet.selector}` : '',
  ].filter(Boolean).join('\n');

  return `${header}\n${meta}\n\nContent:\n"""\n${contextSnippet.content}\n"""\n\n`;
}
