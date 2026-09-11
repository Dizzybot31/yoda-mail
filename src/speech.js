// Yoda Mail — speech engine.
//
// Chrome's speechSynthesis is charming but hostile. Three of its quirks are
// handled here, and each one was a real bug in v1.0.0:
//
//   1. It silently stops after ~15 seconds unless you pause()/resume() at it.
//   2. getVoices() is empty until the voice list loads, and the voiceschanged
//      event may never fire at all — the old code hung on "THINKING..." forever.
//   3. cancel() does not reliably deliver onend, so an awaited utterance can
//      hang the read loop. Every wait has a watchdog and every run has a token.

const YodaSpeech = (function () {
  // macOS ships the properly silly ones; the rest are cross-platform fallbacks.
  const VOICE_PRIORITY = [
    'Superstar',
    'Trinoids',
    'Zarvox',
    'Bad News',
    'Albert',
    'Fred',
    'Ralph',
    'Grandpa',
    'Daniel',
    'Google UK English Male',
    'Microsoft George - English (United Kingdom)',
  ];

  const PITCH = 0.65;          // Yoda's register — not touched by the speed slider
  const NONVERBAL_PITCH = 0.55;
  const NONVERBAL_RATE = 0.7;
  const KEEPALIVE_MS = 9000;   // comfortably under Chrome's ~15s cutoff

  let runToken = 0;            // every read gets a token; stale loops exit on sight
  let keepAliveTimer = null;
  const inFlight = new Set();  // hold utterance refs so GC cannot drop onend

  function synth() {
    return window.speechSynthesis || null;
  }

  // ─── Voices ─────────────────────────────────────────────────────────────────

  // Resolves with whatever voices exist, or [] once the timeout expires — it
  // must never hang, because the caller shows a spinner until it resolves.
  function voicesReady(timeoutMs) {
    const s = synth();
    if (!s) return Promise.resolve([]);
    const existing = s.getVoices();
    if (existing && existing.length) return Promise.resolve(existing);

    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        s.removeEventListener('voiceschanged', finish);
        resolve(s.getVoices() || []);
      };
      // addEventListener, not onvoiceschanged: the old code overwrote a global
      // handler that later fired again and replayed a stale email.
      s.addEventListener('voiceschanged', finish);
      const timer = setTimeout(finish, timeoutMs == null ? 2500 : timeoutMs);
    });
  }

  function listVoices() {
    const s = synth();
    return s ? s.getVoices() || [] : [];
  }

  function pickVoice(preferredName) {
    const voices = listVoices();
    if (!voices.length) return null; // null is fine — the platform default speaks

    if (preferredName) {
      const chosen = voices.find(v => v.name === preferredName);
      if (chosen) return chosen;
    }
    for (const name of VOICE_PRIORITY) {
      const v = voices.find(voice => voice.name === name);
      if (v) return v;
    }
    return (
      voices.find(v => /^en[-_]GB/i.test(v.lang)) ||
      voices.find(v => /^en/i.test(v.lang)) ||
      voices[0] ||
      null
    );
  }

  // ─── Keep-alive ─────────────────────────────────────────────────────────────

  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => {
      const s = synth();
      if (!s) return stopKeepAlive();
      if (s.speaking && !s.paused) {
        // The pause/resume pair resets Chrome's internal watchdog.
        s.pause();
        s.resume();
      }
    }, KEEPALIVE_MS);
  }

  function stopKeepAlive() {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }

  // ─── One utterance ──────────────────────────────────────────────────────────

  function speakChunk(text, voice, pitch, rate) {
    return new Promise(resolve => {
      const s = synth();
      if (!s) return resolve({ ok: false, error: 'unsupported' });

      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = (voice && voice.lang) || 'en-GB';
      u.pitch = pitch;
      u.rate = rate;
      u.volume = 1;
      inFlight.add(u);

      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        inFlight.delete(u);
        resolve(result);
      };

      u.onend = () => finish({ ok: true });
      u.onerror = event => {
        const reason = (event && event.error) || 'unknown';
        // "canceled"/"interrupted" mean we called cancel() — that is not a failure.
        finish({ ok: reason === 'canceled' || reason === 'interrupted', error: reason });
      };

      // If neither event ever arrives the read loop would wedge, so give every
      // utterance a generous ceiling and move on when it passes. cancel() first:
      // a wedged engine still holds the queue, and the next speak() would be
      // silently ignored while we carried on through the remaining chunks.
      const budget = Math.max(8000, (text.length / Math.max(rate, 0.5)) * 220);
      const watchdog = setTimeout(() => {
        try {
          s.cancel();
        } catch (_) {}
        finish({ ok: true, error: 'timeout' });
      }, budget);

      s.speak(u);
    });
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ─── A whole read ───────────────────────────────────────────────────────────

  // opts: { rate, voiceName, onError }
  // Returns a promise that resolves when the read finishes OR is superseded.
  async function speak(chunks, opts) {
    const options = opts || {};
    const s = synth();
    if (!s) {
      if (options.onError) options.onError('unsupported');
      return { completed: false, reason: 'unsupported' };
    }

    // Supersede any run already in progress.
    const token = ++runToken;
    s.cancel();
    await sleep(120); // Chrome ignores speak() fired immediately after cancel()

    if (token !== runToken) return { completed: false, reason: 'superseded' };

    const voice = pickVoice(options.voiceName);
    const rate = clampRate(options.rate);
    startKeepAlive();

    let spokeSomething = false;
    let hardError = null;

    for (const chunk of chunks) {
      if (token !== runToken) break;
      const nonverbal = chunk.type === 'nonverbal';
      const result = await speakChunk(
        chunk.text,
        voice,
        nonverbal ? NONVERBAL_PITCH : PITCH,
        nonverbal ? NONVERBAL_RATE : rate
      );
      if (token !== runToken) break;

      if (result.ok) {
        spokeSomething = true;
      } else if (result.error === 'not-allowed') {
        hardError = 'not-allowed';
        break;
      } else if (!spokeSomething) {
        hardError = result.error || 'synthesis-failed';
        break;
      }
      await sleep(nonverbal ? 380 : 120);
    }

    if (token !== runToken) return { completed: false, reason: 'superseded' };

    stopKeepAlive();
    if (hardError && options.onError) options.onError(hardError);
    return { completed: !hardError, reason: hardError };
  }

  function stop() {
    runToken++; // invalidate any loop still awaiting a chunk
    stopKeepAlive();
    inFlight.clear();
    const s = synth();
    if (s) s.cancel();
  }

  function clampRate(rate) {
    const n = parseFloat(rate);
    if (!isFinite(n)) return 0.9;
    return Math.min(Math.max(n, 0.5), 1.5);
  }

  return { speak, stop, voicesReady, listVoices, pickVoice, clampRate, VOICE_PRIORITY };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = YodaSpeech;
