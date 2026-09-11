// Yoda Mail — glue.
//
// Pulls the open email out of Gmail, runs it through the text pipeline, and
// hands the result to the speech engine. Everything hard lives in the other
// modules; this file is the wiring and the state machine.

(function () {
  const DEFAULTS = {
    speechRate: 0.9,
    voiceName: '',
    chimeEnabled: false, // opt-in: Yoda speaks for the mail you open, nothing else
  };

  let settings = Object.assign({}, DEFAULTS);
  let reading = false;

  // ─── Reading Gmail ──────────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.height > 0 && rect.width > 0;
  }

  // Gmail keeps every message of a thread in the DOM, including collapsed ones
  // and the previous thread you looked at. Taking "the last .a3s in the
  // document" read hidden, stale conversations aloud; only visible nodes count.
  function extractEmail() {
    const bodies = Array.prototype.filter.call(document.querySelectorAll('.a3s'), isVisible);
    if (!bodies.length) return null;

    const body = (bodies[bodies.length - 1].innerText || '').trim();
    if (!body) return null;

    const heading = Array.prototype.filter.call(
      document.querySelectorAll('h2.hP, .ha h2'),
      isVisible
    )[0];

    return {
      subject: heading ? (heading.innerText || '').trim() : '',
      // The pipeline caps what is spoken; this only stops us regexing a novel.
      body: body.slice(0, 8000),
    };
  }

  // ─── Reading aloud ──────────────────────────────────────────────────────────

  const ERRORS = {
    'not-allowed': 'CLICK THE PAGE\nFIRST, YOU MUST.',
    unsupported: 'NO VOICE HERE,\nSPEAK I CANNOT.',
    'language-unavailable': 'NO ENGLISH VOICE,\nINSTALL ONE YOU MUST.',
  };

  function stopReading() {
    YodaSpeech.stop();
    reading = false;
    YodaFab.setState('idle');
  }

  async function onActivate() {
    if (reading) {
      stopReading();
      return;
    }

    const email = extractEmail();
    if (!email) {
      YodaFab.toast('OPEN AN EMAIL\nYOU MUST.');
      return;
    }

    YodaFab.setState('loading');

    // Never block forever here: voicesReady resolves with [] on timeout, and a
    // null voice still speaks with the platform default.
    await YodaSpeech.voicesReady(2500);

    const chunks = YodaText.yodaify(email.body, email.subject, {
      pick: arr => arr[Math.floor(Math.random() * arr.length)],
    });

    reading = true;
    YodaFab.setState('speaking');

    const result = await YodaSpeech.speak(chunks, {
      rate: settings.speechRate,
      voiceName: settings.voiceName,
      onError: reason => YodaFab.toast(ERRORS[reason] || 'SPEAK, I CANNOT.\nHMMM.'),
    });

    // A superseded run means another read already owns the button state.
    if (result.reason === 'superseded') return;
    reading = false;
    YodaFab.setState('idle');
  }

  // ─── Settings ───────────────────────────────────────────────────────────────

  async function loadSettings() {
    const stored = await YodaUtil.storageGet('sync', Object.keys(DEFAULTS));
    settings = Object.assign({}, DEFAULTS, stored);
    settings.speechRate = YodaSpeech.clampRate(settings.speechRate);
    YodaWatcher.setEnabled(settings.chimeEnabled);
  }

  function watchSettings() {
    YodaUtil.onStorageChanged((changes, area) => {
      if (area !== 'sync') return;
      for (const key of Object.keys(DEFAULTS)) {
        if (!(key in changes)) continue;
        settings[key] = changes[key].newValue;
      }
      settings.speechRate = YodaSpeech.clampRate(settings.speechRate);
      YodaWatcher.setEnabled(settings.chimeEnabled);
    });

    // The popup asks for a position reset through local storage.
    YodaUtil.onStorageChanged((changes, area) => {
      if (area === 'local' && changes.resetFabPosition) YodaFab.resetPosition();
    });
  }

  // ─── Boot ───────────────────────────────────────────────────────────────────

  function keepButtonAlive() {
    YodaFab.ensure({ onActivate });

    // Gmail re-renders constantly. An observer on <body> fires on nearly every
    // one of those, so the work it triggers has to be trivial — and a slow
    // interval covers the re-renders that do not touch body's direct children.
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (!YodaUtil.isAlive()) {
          observer.disconnect();
          YodaFab.destroy();
          return;
        }
        YodaFab.ensure({ onActivate });
      });
    });
    observer.observe(document.body, { childList: true });

    setInterval(() => {
      if (!YodaUtil.isAlive()) return;
      YodaFab.ensure({ onActivate });
    }, 5000);
  }

  // A popped-out compose window is served from the same origin but has no
  // message to read, so the head there is nothing but an obstruction.
  function isComposeWindow() {
    return /[?&]view=cm\b/.test(location.search) || /[?&]view=btop\b/.test(location.search);
  }

  async function boot() {
    if (!YodaUtil.isAlive() || isComposeWindow()) return;
    await loadSettings();
    watchSettings();
    keepButtonAlive();
    YodaWatcher.start({
      onNewMail: count => {
        YodaFab.toast(`${count} NEW EMAIL${count > 1 ? 'S' : ''},\nARRIVED ${count > 1 ? 'THEY HAVE' : 'IT HAS'}!`);
        YodaFab.bob();
      },
    });

    // Leaving the page mid-read otherwise keeps the voice going.
    window.addEventListener('pagehide', () => YodaSpeech.stop());
  }

  boot();
})();
