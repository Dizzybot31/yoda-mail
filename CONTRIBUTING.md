# Contributing

This is a toy, and contributions are welcome in that spirit. Small, focused pull
requests are much easier to accept than large ones.

## Getting set up

```bash
git clone https://github.com/Dizzybot31/yoda-mail.git
cd yoda-mail
npm test
```

No dependencies — Node 18+ and its built-in test runner are all you need.

Load the folder as an unpacked extension (`chrome://extensions` → Developer mode
→ Load unpacked) and reload it there after each change. Content script changes
also need a Gmail refresh.

## Before you open a pull request

- `npm test` passes.
- New behaviour in `src/text.js` or `src/watcher.js` comes with a test. Those two
  files are deliberately DOM-free so they can be tested in Node — please keep
  them that way, and put anything touching `document` or `chrome.*` elsewhere.
- Match the surrounding style: no build step, no framework, no dependencies.
- Comments explain *why*, especially for the many Chrome and Gmail workarounds.

## Reporting a bug

Please include your OS, Chrome version, and what the head did or did not do. If
it involves speech, say which voice you have selected.

If the head has stopped finding your emails, it is most likely that Gmail changed
its internal class names — mention that you saw "OPEN AN EMAIL YOU MUST" on an
email that was clearly open, and paste the class list of the message body element
from DevTools if you are comfortable doing that.

**Please do not paste the contents of real emails into an issue.** A synthetic
example that reproduces the same problem is just as useful.

## Areas that could use help

- Gmail selector resilience — the extractor in `src/content.js` is the most
  fragile part of the project.
- Non-English support. The pipeline is English-only, top to bottom.
- More Yoda inversions in `src/text.js`. There is a lot of room here.
