const api = typeof browser !== 'undefined' ? browser : chrome;

const form = document.getElementById('form');
const input = document.getElementById('password');
const submit = document.getElementById('submit');
const msg = document.getElementById('msg');
const restoreInfo = document.getElementById('restoreInfo');

// Escalating delay so the lock page is not a fast brute-force oracle.
let attempts = 0;

function send(message) {
  return new Promise((resolve) => api.runtime.sendMessage(message, resolve));
}

async function refresh() {
  const status = await send({ type: 'status' });
  if (!status) return;

  if (!status.hasPassword) {
    document.getElementById('sub').textContent =
      'No password is set. Open the extension options to configure one.';
    form.hidden = true;
    return;
  }

  if (!status.locked) {
    // Someone unlocked from another window.
    window.close();
    return;
  }

  const tabCount = (status.session || []).reduce((n, w) => n + w.tabs.length, 0);
  if (tabCount > 0) {
    const when = status.sessionSavedAt
      ? new Date(status.sessionSavedAt).toLocaleString()
      : 'the last session';
    restoreInfo.textContent = `${tabCount} tab${tabCount === 1 ? '' : 's'} saved from ${when} will be restored.`;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = input.value;
  if (!password) return;

  submit.disabled = true;
  msg.className = 'msg';
  msg.textContent = 'Checking…';

  const result = await send({ type: 'unlock', password });

  if (result && result.ok) {
    msg.className = 'msg ok';
    msg.textContent = 'Unlocked. Restoring your session…';
    return; // the background script closes this tab once restore finishes
  }

  attempts++;
  const delay = Math.min(attempts * 1000, 10000);
  input.value = '';
  msg.textContent = (result && result.error) || 'Incorrect password.';

  setTimeout(() => {
    submit.disabled = false;
    input.focus();
  }, delay);
});

// Discourage the obvious "just close the tab" reflex; the background script
// reopens the lock page anyway, this only avoids the flicker.
window.addEventListener('beforeunload', (e) => {
  e.preventDefault();
  e.returnValue = '';
});

refresh();
