import type { ContextSnippet } from '../types/session';

export function startElementInspector(): Promise<ContextSnippet | null> {
  return new Promise((resolve) => {
    // Check if inspector is already running
    if (document.getElementById('chetty-inspector-overlay')) {
      resolve(null);
      return;
    }

    // Create inspector elements
    const overlay = document.createElement('div');
    overlay.id = 'chetty-inspector-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 2147483645;
    `;

    // Highlight bounding box
    const box = document.createElement('div');
    box.id = 'chetty-inspector-box';
    box.style.cssText = `
      position: absolute;
      border: 2px solid #8b5cf6;
      background: rgba(139, 92, 246, 0.12);
      border-radius: 4px;
      pointer-events: none;
      transition: all 0.08s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 0 16px rgba(139, 92, 246, 0.4), inset 0 0 8px rgba(139, 92, 246, 0.2);
      display: none;
    `;

    // Tooltip badge
    const badge = document.createElement('div');
    badge.id = 'chetty-inspector-badge';
    badge.style.cssText = `
      position: absolute;
      background: #1e1b4b;
      color: #e0e7ff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid #6366f1;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      white-space: nowrap;
      pointer-events: none;
      z-index: 2147483646;
      display: none;
    `;

    // Floating instructions banner
    const banner = document.createElement('div');
    banner.id = 'chetty-inspector-banner';
    banner.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(12px);
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      padding: 10px 20px;
      border-radius: 9999px;
      border: 1px solid rgba(139, 92, 246, 0.5);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 12px;
      pointer-events: auto;
      cursor: default;
    `;
    banner.innerHTML = `
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981;"></span>
      <span><b>Chetty Inspect Mode:</b> Click any element boundary to use as context</span>
      <kbd style="background:rgba(255,255,255,0.15);padding:2px 6px;border-radius:4px;font-size:11px;">Esc to cancel</kbd>
    `;

    overlay.appendChild(box);
    overlay.appendChild(badge);
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(banner);

    let currentTarget: HTMLElement | null = null;

    const cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      banner.remove();
    };

    const getSelector = (el: HTMLElement): string => {
      if (el.id) return `#${el.id}`;
      let path = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (classes.length) path += '.' + classes.join('.');
      }
      return path;
    };

    const onMouseMove = (e: MouseEvent) => {
      // Find element under cursor
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!target || target === document.documentElement || target === document.body) {
        box.style.display = 'none';
        badge.style.display = 'none';
        currentTarget = null;
        return;
      }

      // Ignore Chetty's own shadow host or inspector banner
      if (target.closest('chetty-shadow-host') || target.closest('#chetty-inspector-banner') || target.closest('#chetty-inspector-overlay')) {
        box.style.display = 'none';
        badge.style.display = 'none';
        currentTarget = null;
        return;
      }

      currentTarget = target;
      const rect = target.getBoundingClientRect();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;

      box.style.display = 'block';
      box.style.top = `${rect.top + scrollY}px`;
      box.style.left = `${rect.left + scrollX}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;

      const selector = getSelector(target);
      const words = (target.textContent || '').trim().split(/\s+/).filter(Boolean).length;
      badge.textContent = `<${selector}> (${words} words)`;
      badge.style.display = 'block';

      // Position badge right above or below element
      const badgeTop = rect.top + scrollY - 26;
      badge.style.top = `${badgeTop < 10 ? rect.bottom + scrollY + 4 : badgeTop}px`;
      badge.style.left = `${Math.max(10, rect.left + scrollX)}px`;
    };

    const onClick = (e: MouseEvent) => {
      if (e.target && (e.target as HTMLElement).closest('#chetty-inspector-banner')) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (!currentTarget) {
        cleanup();
        resolve(null);
        return;
      }

      const selector = getSelector(currentTarget);
      const text = (currentTarget.textContent || currentTarget.innerText || '').trim();
      const outerHtml = currentTarget.outerHTML ? currentTarget.outerHTML.slice(0, 10000) : '';

      const snippet: ContextSnippet = {
        type: 'element_boundary',
        title: `Element <${selector}>`,
        url: window.location.href,
        selector,
        content: text ? `Text Content:\n${text}\n\nHTML:\n${outerHtml}` : outerHtml,
        summary: `Selected element <${selector}> (${text.split(/\s+/).length} words)`,
      };

      cleanup();
      resolve(snippet);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
        resolve(null);
      }
    };

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
  });
}
