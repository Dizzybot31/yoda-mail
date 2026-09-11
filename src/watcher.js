// Yoda Mail — new-mail watcher.
//
// This is the part that used to chime every time you opened an email. The cause:
// getUnreadCount() returned 0 for "the title has no (n) in it", which is exactly
// what Gmail's title looks like while you are reading a message. Open a mail with
// 3 unread and the count went 3 -> 0; go back to the inbox and it went 0 -> 3,
// which read as "3 new emails arrived".
//
// The fix is to distinguish three states instead of two:
//   a number  — the title carries an explicit unread count
//   zero      — a mailbox view with no count, so genuinely nothing unread
//   unknown   — an open message, a search, a loading page: tells us nothing
// Unknown samples never move the baseline and never trigger a chime.
//
// The chime is also opt-in now (Settings -> NEW MAIL CHIME), so the default
// experience is exactly what was asked for: Yoda speaks for the mail you open,
// and stays quiet otherwise.

const YodaWatcher = (function () {
  const SETTLE_MS = 4500;      // ignore title churn for this long after a navigation
  const POLL_MS = 45000;       // backstop for missed mutations
  const HREF_POLL_MS = 1000;   // backstop for SPA navigations without an event
  const CROSS_TAB_MS = 4000;   // one chime per arrival, not one per open Gmail tab

  let enabled = false;
  let lastKnownUnread = null;
  let pageReady = false;
  let readyTimer = null;
  let audioCtx = null;
  let hooks = {};
  let started = false;
  let titleObserver = null;
  let titleTarget = null;
  let lastHref = typeof location !== 'undefined' ? location.href : '';

  // ─── Reading the title ──────────────────────────────────────────────────────

  // Returns a number, or null when the title cannot tell us anything.
  function readUnreadCount(title) {
    const t = String(title == null ? '' : title);

    // "(12) Inbox - you@gmail.com - Gmail" and the older "Inbox (12) - ..."
    const counted = t.match(/^\s*\((\d[\d,.\s]*)\)/) || t.match(/\bInbox\s*\((\d[\d,.\s]*)\)/i);
    if (counted) {
      const n = parseInt(counted[1].replace(/[^\d]/g, ''), 10);
      return isFinite(n) ? n : null;
    }

    // A mailbox view with no count really does mean zero unread.
    if (/^\s*(Inbox|Primary|Updates|Promotions|Social|Forums)\b/i.test(t)) return 0;

    // An open message, a search, "Gmail" while loading: no information.
    return null;
  }

  function currentUnread() {
    return readUnreadCount(document.title);
  }

  // ─── Settling ───────────────────────────────────────────────────────────────

  // Gmail's title flickers through intermediate states on every load and every
  // SPA navigation, so nothing counts until it has been quiet for a moment.
  function resetPageReady() {
    pageReady = false;
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      const count = currentUnread();
      if (count != null) lastKnownUnread = count; // silent baseline
      pageReady = true;
    }, SETTLE_MS);
  }

  // ─── The chime ──────────────────────────────────────────────────────────────

  function getAudioContext() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    // One context for the life of the page: Chrome caps how many a page may
    // open, and the old code made a fresh one per notification until they
    // stopped working entirely.
    if (!audioCtx || audioCtx.state === 'closed') {
      try {
        audioCtx = new Ctor();
      } catch (_) {
        return null;
      }
    }
    if (audioCtx.state === 'suspended') {
      // Only succeeds once the page has had a user gesture; harmless otherwise.
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playNotificationSound() {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running') return;
    try {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.11;
        gain.gain.setValueAtTime(0.22, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.start(t);
        osc.stop(t + 0.19);
      });
    } catch (_) {}
  }

  // Several Gmail tabs each run their own watcher; without this they all chime.
  async function claimChime() {
    const now = Date.now();
    const { lastChimeAt } = await YodaUtil.storageGet('local', 'lastChimeAt');
    if (typeof lastChimeAt === 'number' && now - lastChimeAt < CROSS_TAB_MS) return false;
    await YodaUtil.storageSet('local', { lastChimeAt: now });
    return true;
  }

  // ─── The check ──────────────────────────────────────────────────────────────

  // The whole notification decision, as a pure function — this is the logic the
  // "pings every time I open an email" bug lived in, so it is unit tested.
  function decide(previous, count) {
    if (count == null) return { baseline: previous, chime: 0 }; // unknown: change nothing
    if (previous == null || count <= previous) return { baseline: count, chime: 0 };
    return { baseline: count, chime: count - previous };
  }

  async function check() {
    if (!enabled || !pageReady) return;

    const { baseline, chime } = decide(lastKnownUnread, currentUnread());
    lastKnownUnread = baseline;
    if (chime <= 0) return;

    const diff = chime;
    if (!(await claimChime())) return;

    playNotificationSound();
    if (hooks.onNewMail) hooks.onNewMail(diff);
  }

  // ─── Wiring ─────────────────────────────────────────────────────────────────

  function watchTitle() {
    const titleEl = document.querySelector('title');
    if (!titleEl) return;
    if (titleObserver) titleObserver.disconnect();
    // characterData matters: Gmail usually rewrites the text node in place
    // rather than replacing the child, and childList alone can miss that.
    titleObserver = new MutationObserver(() => check());
    titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    titleTarget = titleEl;
  }

  function onNavigation() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    resetPageReady();
  }

  function start(options) {
    if (started) return;
    started = true;
    hooks = options || {};

    resetPageReady();
    watchTitle();

    // Gmail is a SPA. These fire immediately; the poll is only a backstop for
    // navigations that produce neither event.
    window.addEventListener('hashchange', onNavigation);
    window.addEventListener('popstate', onNavigation);
    setInterval(onNavigation, HREF_POLL_MS);

    // <head> can be rebuilt, taking our observer's target with it.
    if (document.head) {
      new MutationObserver(() => {
        const titleEl = document.querySelector('title');
        if (titleEl && titleEl !== titleTarget) watchTitle();
      }).observe(document.head, { childList: true });
    }

    setInterval(check, POLL_MS);
  }

  function setEnabled(value) {
    const next = Boolean(value);
    if (next === enabled) return;
    enabled = next;
    // Re-baseline when switching on so the first check cannot fire on a backlog.
    if (enabled) resetPageReady();
  }

  return { start, setEnabled, readUnreadCount, decide, playNotificationSound };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = YodaWatcher;
