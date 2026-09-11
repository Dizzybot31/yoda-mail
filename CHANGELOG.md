# Changelog

## 1.1.1 — 2026-09-11

### Fixed

- **The extension would not load at all.** `web_accessible_resources[0].matches`
  was narrowed to `https://mail.google.com/mail/*`. Chrome requires a host-level
  pattern there — unlike `content_scripts.matches`, the path cannot be
  restricted — so Chrome rejected the manifest with "Invalid match pattern" and
  refused to install 1.1.0.

Added `test/manifest.test.js`, which checks the match-pattern rule, that every
file the manifest references exists, that content scripts are listed in
dependency order, and that no unused permission creeps back in.

## 1.1.0 — 2026-09-11

First public release. The extension was rewritten from a single 460-line content
script into tested modules, and a pile of real bugs went with it.

### Fixed

- **The chime fired every time you opened an email.** The unread count was read
  from the page title, and "no count in the title" — which is what Gmail shows
  while you are reading a message — was treated as *zero unread*. Opening a mail
  with 3 unread counted as 3 → 0, and going back to the inbox counted as 0 → 3,
  i.e. "3 new emails". The watcher now distinguishes a real count, a genuine
  zero, and *unknown*, and unknown never moves the baseline. Covered by tests.
- **The floating head could be invisible.** The old icon had a green background
  that was flood-filled away on a `<canvas>` at runtime; if that tainted or the
  image failed, the promise rejected inside an uncaught handler, the `<img>`
  never got a source, and the emoji fallback never appeared — leaving an
  invisible 80px click target over Gmail's toolbar. The mascot now ships with a
  real alpha channel and the fallback works.
- **Speech stopped after about fifteen seconds.** Chrome kills long utterances
  unless pinged. Added a pause/resume heartbeat and a hard cap on chunk length.
- **The button could hang on "THINKING..." forever.** `getVoices()` is empty
  until voices load and `voiceschanged` may never fire. Voice loading now always
  resolves, with a timeout, and speaks with the platform default if need be.
- **An email could start reading itself, twice.** `onvoiceschanged` was assigned
  a closure that was never cleared, so later voice-list changes replayed a stale
  email and started a second overlapping read. Replaced with a one-shot listener
  and a run token.
- **Stop-then-start desynchronised the button.** Two read loops could interleave;
  each read now owns a token and stale loops exit.
- **Whole emails were read verbatim.** A body of two paragraphs or fewer skipped
  the summariser entirely and up to 4000 characters went straight to the voice.
  Everything is capped now.
- **Sign-offs deleted the email.** The boilerplate stripper cut at the first
  "thanks/regards/best" that ended a line — often the first line — and discarded
  everything after it. It now only cuts a short sign-off near the end.
- **Quoted replies, footers and URLs were read aloud.** Reply chains, forwarded
  headers, unsubscribe blocks, confidentiality notices and raw links are removed.
- **Junk outranked content.** The importance regex matched the bare word "by",
  so legal disclaimers scored higher than the actual message.
- **Hidden and stale messages were read.** The extractor took the last `.a3s` in
  the document regardless of visibility, which could be a collapsed message or
  the previous thread. Only visible messages count now.
- **The head could be dragged off screen permanently.** Positions are clamped on
  restore and on window resize, and there is a RESET HEAD button.
- **Notifications went silent over time.** A new `AudioContext` was created per
  chime and never closed, until Chrome refused to create more.
- **Every open Gmail tab chimed separately.** One chime per arrival now.
- **Reloading the extension left a dead head on the page** throwing "Extension
  context invalidated" on every click. All `chrome.*` calls are guarded.
- **The popup said "Saved" even when the write failed.** It checks
  `chrome.runtime.lastError` now.

### Changed

- Original pixel-art mascot, drawn programmatically — replaces third-party
  character artwork.
- The new-mail chime is **off by default**: Yoda speaks for the mail you open.
- Added a voice picker and TEST VOICE, so the extension is usable off macOS.
- The subject is spoken as its own line instead of being glued to the first
  sentence.
- Dropped the Google Fonts requests from both the popup and Gmail — no remote
  resources are loaded at all.
- Removed the dead ElevenLabs service worker, which handled an API key no UI
  could set and called a host the manifest did not permit.
- Dropped the unused `activeTab` permission; narrowed the host match to
  `mail.google.com/mail/*` and excluded the basic-HTML view and compose popups.
- The button is keyboard accessible, honours `prefers-reduced-motion`, and sits
  bottom-right instead of over Gmail's toolbar.

## 1.0.0

Initial private version.
