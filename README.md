# BrowserLock

A Chrome + Firefox (Manifest V3) extension that locks the browser behind a password on
startup and restores your previous tabs once you unlock.

## Install

**Chrome / Edge** — `chrome://extensions` → enable *Developer mode* → *Load unpacked* →
select this folder.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* →
select `manifest.json`. (Temporary add-ons are removed when Firefox restarts; to make it
permanent you need a signed build via [addons.mozilla.org](https://addons.mozilla.org).)

## Use

1. The options page opens on install — set a password there.
2. From then on, the extension snapshots your open tabs (URL, pinned state, window
   grouping) about once a second after any change.
3. On the next browser start it closes everything and shows the lock page.
4. Enter the password and the saved windows and tabs are recreated.

Lock on demand with the toolbar button or **Ctrl+Shift+L**.

## How it works

- The password is stored only as a PBKDF2-SHA256 hash (250k iterations, random 16-byte
  salt) in `chrome.storage.local`. The plaintext is never written anywhere.
- While locked, `tabs.onCreated` / `onUpdated` redirect every tab to the lock page and
  `onRemoved` reopens it, so there is no reachable page other than the lock screen.
- Snapshotting is suspended while locked so the lock page never overwrites your session.
- Failed unlock attempts add an escalating delay (up to 10s).

## Limitations — please read

This is a **deterrent, not a security boundary.** Anyone with access to your OS account can:

- disable or remove the extension from the extensions page,
- start the browser with `--disable-extensions` / in Firefox safe mode,
- launch a different browser profile, or
- read cookies, history and saved passwords straight off disk.

Incognito/private windows are deliberately not snapshotted or restored.

For real protection, lock your operating system account (Windows Hello, `Win+L`) and use
full-disk encryption. Use this extension for the "roommate walks past my desk" threat model.
