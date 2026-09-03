import { handleAuthRedirectUrl } from '../../src/auth/token-manager';

async function init() {
  const titleEl = document.getElementById('status-title');
  const descEl = document.getElementById('status-desc');
  const iconEl = document.getElementById('status-icon');
  const spinnerEl = document.getElementById('status-spinner');

  try {
    const currentUrl = window.location.href;
    const profile = await handleAuthRedirectUrl(currentUrl);

    if (titleEl) titleEl.textContent = 'Signed in as ' + (profile.name || profile.email);
    if (descEl) descEl.textContent = 'Google Account successfully connected! You can close this tab now.';
    if (iconEl) iconEl.textContent = '✓';
    if (spinnerEl) spinnerEl.style.display = 'none';

    // Auto-close after brief delay
    setTimeout(() => {
      window.close();
    }, 1200);
  } catch (err) {
    console.error('[Chetty OAuth Callback Error]:', err);
    if (titleEl) titleEl.textContent = 'Sign-In Failed';
    if (descEl) descEl.textContent = (err as Error).message || 'Could not complete Google authentication.';
    if (iconEl) {
      iconEl.textContent = '!';
      iconEl.style.background = '#ef4444';
    }
    if (spinnerEl) spinnerEl.style.display = 'none';
  }
}

init();
