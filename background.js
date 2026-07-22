// BrowserLock background logic.
//
// Responsibilities:
//   1. Continuously snapshot the open tabs while the browser is unlocked.
//   2. On browser startup (or on demand), enter the locked state: close/redirect
//      everything to the lock page.
//   3. On a correct password, rebuild the snapshot and leave the locked state.

const api = typeof browser !== 'undefined' ? browser : chrome;
const LOCK_URL = api.runtime.getURL('lock.html');

const PBKDF2_ITERATIONS = 250000;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function derive(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return toHex(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    saltHex: toHex(salt),
    hashHex: await derive(password, salt, PBKDF2_ITERATIONS),
    iterations: PBKDF2_ITERATIONS
  };
}

async function verifyPassword(password, auth) {
  if (!auth) return false;
  const candidate = await derive(password, fromHex(auth.saltHex), auth.iterations);
  if (candidate.length !== auth.hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ auth.hashHex.charCodeAt(i);
  }
  return diff === 0;
}

// --- storage helpers -------------------------------------------------------

async function get(keys) {
  return api.storage.local.get(keys);
}

async function set(items) {
  return api.storage.local.set(items);
}

async function isLocked() {
  const { locked } = await get('locked');
  return locked === true;
}

async function hasPassword() {
  const { auth } = await get('auth');
  return !!auth;
}

// --- session snapshotting --------------------------------------------------

// A URL we can neither restore nor should preserve (about:blank chrome pages,
// the lock page itself, privileged pages that tabs.create rejects).
function isRestorable(url) {
  if (!url) return false;
  if (url.startsWith(LOCK_URL)) return false;
  return /^(https?|file|ftp):/i.test(url);
}

let snapshotTimer = null;

function scheduleSnapshot() {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    takeSnapshot();
  }, 1000);
}

async function takeSnapshot() {
  // Never overwrite the saved session while locked — the visible tabs are all
  // lock pages at that point.
  if (await isLocked()) return;
  if (!(await hasPassword())) return;

  let windows;
  try {
    windows = await api.windows.getAll({ populate: true });
  } catch (e) {
    return;
  }

  const session = windows
    .filter((w) => w.type === 'normal')
    .map((w) => ({
      incognito: w.incognito,
      state: w.state,
      tabs: w.tabs
        .filter((t) => isRestorable(t.url))
        .map((t) => ({ url: t.url, pinned: t.pinned, active: t.active }))
    }))
    .filter((w) => !w.incognito && w.tabs.length > 0);

  if (session.length > 0) {
    await set({ session, sessionSavedAt: Date.now() });
  }
}

// --- locking ---------------------------------------------------------------

let enforcing = false;

async function lock() {
  if (!(await hasPassword())) return;
  if (await isLocked()) return;

  await takeSnapshot();
  await set({ locked: true });
  await enforceLock();
}

// Make sure exactly one lock surface is visible and nothing else is reachable.
async function enforceLock() {
  if (enforcing) return;
  enforcing = true;
  try {
    if (!(await isLocked())) return;

    const tabs = await api.tabs.query({});
    const lockTabs = tabs.filter((t) => t.url && t.url.startsWith(LOCK_URL));
    const otherTabs = tabs.filter((t) => !t.url || !t.url.startsWith(LOCK_URL));

    if (lockTabs.length === 0) {
      if (otherTabs.length > 0) {
        // Reuse an existing tab so we never end up with zero windows.
        await api.tabs.update(otherTabs[0].id, { url: LOCK_URL });
        otherTabs.shift();
      } else {
        await api.windows.create({ url: LOCK_URL, focused: true });
      }
    }

    if (otherTabs.length > 0) {
      await api.tabs.remove(otherTabs.map((t) => t.id)).catch(() => {});
    }
  } finally {
    enforcing = false;
  }
}

async function unlock(password) {
  const { auth } = await get('auth');
  if (!(await verifyPassword(password, auth))) {
    return { ok: false, error: 'Incorrect password.' };
  }

  await set({ locked: false });
  await restoreSession();
  return { ok: true };
}

async function restoreSession() {
  const { session } = await get('session');
  const lockTabs = await api.tabs.query({ url: LOCK_URL + '*' });

  if (Array.isArray(session) && session.length > 0) {
    for (const win of session) {
      const urls = win.tabs.map((t) => t.url);
      if (urls.length === 0) continue;
      try {
        const created = await api.windows.create({ url: urls, focused: true });
        // Re-apply pinned state and the previously active tab.
        if (created && created.tabs) {
          for (let i = 0; i < created.tabs.length; i++) {
            const saved = win.tabs[i];
            if (!saved) continue;
            const props = {};
            if (saved.pinned) props.pinned = true;
            if (saved.active) props.active = true;
            if (Object.keys(props).length > 0) {
              await api.tabs.update(created.tabs[i].id, props).catch(() => {});
            }
          }
        }
      } catch (e) {
        // Keep going; a failed window should not strand the user on the lock page.
      }
    }
  } else {
    // Nothing to restore — leave them with a usable blank window.
    await api.windows.create({ focused: true }).catch(() => {});
  }

  // Only now tear down the lock pages, so the browser never hits zero windows.
  if (lockTabs.length > 0) {
    await api.tabs.remove(lockTabs.map((t) => t.id)).catch(() => {});
  }
}

// --- event wiring ----------------------------------------------------------

api.runtime.onStartup.addListener(async () => {
  const { lockOnStartup } = await get('lockOnStartup');
  if (lockOnStartup === false) return;
  if (!(await hasPassword())) return;

  // Do NOT snapshot here: the browser may still be restoring the previous
  // session, so the current tab list is unreliable. Use what we saved last run.
  await set({ locked: true });
  await enforceLock();
});

api.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await set({ lockOnStartup: true });
    api.runtime.openOptionsPage();
  }
});

api.tabs.onCreated.addListener(async (tab) => {
  if (await isLocked()) {
    if (tab.url && tab.url.startsWith(LOCK_URL)) return;
    enforceLock();
  } else {
    scheduleSnapshot();
  }
});

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (await isLocked()) {
    if (!changeInfo.url) return;
    if (changeInfo.url.startsWith(LOCK_URL)) return;
    api.tabs.update(tabId, { url: LOCK_URL }).catch(() => {});
  } else if (changeInfo.url || changeInfo.pinned !== undefined) {
    scheduleSnapshot();
  }
});

api.tabs.onRemoved.addListener(async () => {
  if (await isLocked()) {
    // The user closed the lock page; put it back.
    enforceLock();
  } else {
    scheduleSnapshot();
  }
});

api.windows.onCreated.addListener(async () => {
  if (await isLocked()) enforceLock();
  else scheduleSnapshot();
});

api.windows.onRemoved.addListener(async () => {
  if (await isLocked()) enforceLock();
});

api.action.onClicked.addListener(() => lock());

if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener((command) => {
    if (command === 'lock-now') lock();
  });
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'unlock':
        sendResponse(await unlock(msg.password));
        break;
      case 'lock':
        await lock();
        sendResponse({ ok: true });
        break;
      case 'setPassword': {
        const { auth } = await get('auth');
        if (auth && !(await verifyPassword(msg.currentPassword || '', auth))) {
          sendResponse({ ok: false, error: 'Current password is incorrect.' });
          return;
        }
        if (!msg.newPassword || msg.newPassword.length < 4) {
          sendResponse({ ok: false, error: 'Password must be at least 4 characters.' });
          return;
        }
        await set({ auth: await hashPassword(msg.newPassword) });
        await takeSnapshot();
        sendResponse({ ok: true });
        break;
      }
      case 'clearPassword': {
        const { auth } = await get('auth');
        if (auth && !(await verifyPassword(msg.currentPassword || '', auth))) {
          sendResponse({ ok: false, error: 'Current password is incorrect.' });
          return;
        }
        await api.storage.local.remove('auth');
        await set({ locked: false });
        sendResponse({ ok: true });
        break;
      }
      case 'status':
        sendResponse({
          locked: await isLocked(),
          hasPassword: await hasPassword(),
          ...(await get(['lockOnStartup', 'sessionSavedAt', 'session']))
        });
        break;
      case 'setLockOnStartup':
        await set({ lockOnStartup: !!msg.value });
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown message.' });
    }
  })();
  return true; // keep the channel open for the async response
});
