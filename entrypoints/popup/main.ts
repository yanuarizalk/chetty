import { getAllSessions } from '../../src/storage/session-store';
import { getSettings, saveSettings } from '../../src/storage/settings-store';
import { signInWithGoogle, signOut } from '../../src/auth/token-manager';
import { checkExtensionPermissions, requestMissingPermissions } from '../../src/components/permission-banner';
import type { FloatingMode, ThemeMode } from '../../src/types/settings';

async function initPopup() {
  // 1. Version
  const manifest = chrome.runtime.getManifest();
  const versionEl = document.getElementById('app-version');
  if (versionEl) versionEl.textContent = `v${manifest.version}`;

  // 2. Load settings
  let settings = await getSettings();

  // Apply Theme
  applyTheme(settings.theme);

  // Apply Opacity
  const sliderOpacity = document.getElementById('slider-opacity') as HTMLInputElement;
  const opacityVal = document.getElementById('opacity-val');
  if (sliderOpacity && opacityVal) {
    const pct = Math.round(settings.opacity * 100);
    sliderOpacity.value = String(pct);
    opacityVal.textContent = `${pct}%`;
  }

  // Apply Default Floating Mode
  updateFloatingModeButtons(settings.defaultFloatingMode);

  // Apply Auth State
  updateAuthUI(settings.auth);

  // 3. Load Sessions
  await loadSessionsList();

  // 4. Check Permissions
  await checkPermissionsUI();

  // --- EVENT LISTENERS ---

  // Google Sign-In
  const btnSignIn = document.getElementById('btn-signin-google');
  btnSignIn?.addEventListener('click', async () => {
    btnSignIn.setAttribute('disabled', 'true');
    btnSignIn.textContent = 'Connecting...';
    try {
      const profile = await signInWithGoogle();
      settings = await getSettings();
      updateAuthUI(settings.auth);
    } catch (err) {
      alert(`Google Sign-In failed: ${(err as Error).message}`);
    } finally {
      btnSignIn.removeAttribute('disabled');
      btnSignIn.textContent = 'Sign In';
    }
  });

  // Google Sign-Out
  const btnSignOut = document.getElementById('btn-signout-google');
  btnSignOut?.addEventListener('click', async () => {
    await signOut();
    settings = await getSettings();
    updateAuthUI(settings.auth);
  });

  // Start New Session
  const btnNewSession = document.getElementById('btn-new-session');
  btnNewSession?.addEventListener('click', async () => {
    btnNewSession.setAttribute('disabled', 'true');
    btnNewSession.textContent = 'Opening...';
    try {
      await chrome.runtime.sendMessage({
        type: 'CHETTY_BG_NEW_SESSION',
      });
      window.close();
    } catch (err) {
      alert(`Failed to open new session: ${(err as Error).message}`);
      btnNewSession.removeAttribute('disabled');
      btnNewSession.textContent = 'Start New Session';
    }
  });

  // Select Existing Session
  const selectSession = document.getElementById('select-session') as HTMLSelectElement;
  const btnOpenSession = document.getElementById('btn-open-session') as HTMLButtonElement;

  selectSession?.addEventListener('change', () => {
    btnOpenSession.disabled = !selectSession.value;
  });

  btnOpenSession?.addEventListener('click', async () => {
    const sessionId = selectSession.value;
    if (!sessionId) return;

    btnOpenSession.disabled = true;
    btnOpenSession.textContent = 'Opening...';
    try {
      await chrome.runtime.sendMessage({
        type: 'CHETTY_BG_OPEN_SESSION',
        sessionId,
      });
      window.close();
    } catch (err) {
      alert(`Failed to open session: ${(err as Error).message}`);
      btnOpenSession.disabled = false;
      btnOpenSession.textContent = 'Open';
    }
  });

  // Floating Mode Toggle Buttons
  const floatingModeBtns = document.querySelectorAll('#group-floating-mode .toggle-btn');
  floatingModeBtns.forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const mode = (e.currentTarget as HTMLElement).getAttribute('data-mode') as FloatingMode;
      updateFloatingModeButtons(mode);
      await saveSettings({ defaultFloatingMode: mode });
    });
  });

  // Opacity Slider
  sliderOpacity?.addEventListener('input', async () => {
    const val = parseInt(sliderOpacity.value, 10);
    if (opacityVal) opacityVal.textContent = `${val}%`;
    await saveSettings({ opacity: val / 100 });
  });

  // Theme Toggle Buttons
  const themeBtns = document.querySelectorAll('#group-theme .toggle-btn');
  themeBtns.forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const theme = (e.currentTarget as HTMLElement).getAttribute('data-theme') as ThemeMode;
      applyTheme(theme);
      await saveSettings({ theme });
    });
  });
}

function applyTheme(theme: ThemeMode) {
  document.body.className = `theme-${theme}`;
  const themeBtns = document.querySelectorAll('#group-theme .toggle-btn');
  themeBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-theme') === theme);
  });
}

function updateFloatingModeButtons(mode: FloatingMode) {
  const btns = document.querySelectorAll('#group-floating-mode .toggle-btn');
  btns.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
  });
}

function updateAuthUI(auth: any) {
  const signedOutBox = document.getElementById('auth-signed-out');
  const signedInBox = document.getElementById('auth-signed-in');
  const userAvatar = document.getElementById('user-avatar') as HTMLImageElement;
  const userName = document.getElementById('user-name');
  const userEmail = document.getElementById('user-email');

  if (auth && auth.isAuthenticated) {
    if (signedOutBox) signedOutBox.style.display = 'none';
    if (signedInBox) signedInBox.style.display = 'flex';
    if (userName) userName.textContent = auth.profile?.name || 'Google User';
    if (userEmail) userEmail.textContent = auth.profile?.email || 'user@gmail.com';
    if (userAvatar) {
      if (auth.profile?.picture) {
        userAvatar.src = auth.profile.picture;
        userAvatar.style.display = 'block';
      } else {
        userAvatar.style.display = 'none';
      }
    }
  } else {
    if (signedOutBox) signedOutBox.style.display = 'flex';
    if (signedInBox) signedInBox.style.display = 'none';
  }
}

async function loadSessionsList() {
  const selectSession = document.getElementById('select-session') as HTMLSelectElement;
  if (!selectSession) return;

  const sessions = await getAllSessions();
  selectSession.innerHTML = '<option value="" disabled selected>Select an existing session...</option>';

  if (sessions.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.textContent = 'No previous sessions found';
    selectSession.appendChild(opt);
    return;
  }

  for (const sess of sessions) {
    const opt = document.createElement('option');
    opt.value = sess.id;
    const dateStr = new Date(sess.updatedAt).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    opt.textContent = `${sess.title} (${dateStr})`;
    selectSession.appendChild(opt);
  }
}

async function checkPermissionsUI() {
  const permText = document.getElementById('perm-text');
  const statusIndicator = document.querySelector('.status-indicator');
  const permStatus = await checkExtensionPermissions();

  if (permStatus.hasAllRequired) {
    if (permText) permText.textContent = 'All permissions active';
    if (statusIndicator) {
      statusIndicator.className = 'status-indicator online';
    }
  } else {
    if (permText) {
      permText.innerHTML = `Missing access: ${permStatus.missingPermissions.join(', ')} <a href="#" id="link-grant-perm" style="color:var(--accent);margin-left:4px;">Grant</a>`;
      const link = document.getElementById('link-grant-perm');
      link?.addEventListener('click', async (e) => {
        e.preventDefault();
        const granted = await requestMissingPermissions(permStatus.missingPermissions);
        if (granted) checkPermissionsUI();
      });
    }
    if (statusIndicator) {
      statusIndicator.className = 'status-indicator warning';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
