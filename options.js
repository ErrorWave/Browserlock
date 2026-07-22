const api = typeof browser !== 'undefined' ? browser : chrome;

const state = document.getElementById('state');
const form = document.getElementById('form');
const currentWrap = document.getElementById('currentWrap');
const current = document.getElementById('current');
const next = document.getElementById('next');
const confirm = document.getElementById('confirm');
const msg = document.getElementById('msg');
const startup = document.getElementById('startup');

function send(message) {
  return new Promise((resolve) => api.runtime.sendMessage(message, resolve));
}

function show(text, ok) {
  msg.className = ok ? 'msg ok' : 'msg';
  msg.textContent = text;
}

async function refresh() {
  const status = await send({ type: 'status' });
  const set = !!(status && status.hasPassword);
  currentWrap.hidden = !set;
  state.textContent = set
    ? 'A password is set. The browser will lock on startup.'
    : 'No password set yet — the browser will not lock until you set one.';
  startup.checked = !status || status.lockOnStartup !== false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (next.value !== confirm.value) {
    show('The two new passwords do not match.');
    return;
  }

  const result = await send({
    type: 'setPassword',
    currentPassword: current.value,
    newPassword: next.value
  });

  if (result && result.ok) {
    current.value = next.value = confirm.value = '';
    show('Password saved.', true);
    refresh();
  } else {
    show((result && result.error) || 'Could not save the password.');
  }
});

startup.addEventListener('change', async () => {
  await send({ type: 'setLockOnStartup', value: startup.checked });
  show(startup.checked ? 'Will lock on startup.' : 'Startup locking disabled.', true);
});

document.getElementById('lockNow').addEventListener('click', async () => {
  const status = await send({ type: 'status' });
  if (!status || !status.hasPassword) {
    show('Set a password first.');
    return;
  }
  await send({ type: 'lock' });
});

document.getElementById('clear').addEventListener('click', async () => {
  const result = await send({ type: 'clearPassword', currentPassword: current.value });
  if (result && result.ok) {
    show('Password removed. The browser will no longer lock.', true);
    current.value = '';
    refresh();
  } else {
    show((result && result.error) || 'Enter your current password to remove it.');
  }
});

refresh();
