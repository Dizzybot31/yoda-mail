// Yoda Mail — the floating head.
//
// v1.0.0 loaded a green-background PNG and tried to flood-fill the background
// away on a <canvas> at runtime. When that canvas tainted or the image failed,
// the promise rejected inside an un-caught async handler, the <img> never got a
// src, and the fallback emoji was never shown either: an invisible 80px click
// target sitting on top of Gmail's toolbar. The mascot now ships with a real
// alpha channel, so all of that is gone.

const YodaFab = (function () {
  const ID = 'yoda-mail-fab';
  const SIZE = 72;
  const MARGIN = 24;

  let fab = null;
  let img = null;
  let emoji = null;
  let label = null;
  let onActivate = null;
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let offsetX = 0;
  let offsetY = 0;

  const DRAG_THRESHOLD = 5;

  // ─── Position ───────────────────────────────────────────────────────────────

  function applyPosition(x, y) {
    const clamped = YodaUtil.clampToViewport(x, y, SIZE, SIZE, 8);
    fab.style.left = clamped.x + 'px';
    fab.style.top = clamped.y + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
    return clamped;
  }

  function defaultPosition() {
    // Bottom-right: the old top-right default parked a max-z-index element over
    // Gmail's own settings and profile controls.
    return {
      x: Math.max(8, window.innerWidth - SIZE - MARGIN),
      y: Math.max(8, window.innerHeight - SIZE - MARGIN - 40),
    };
  }

  async function restorePosition() {
    const { fabX, fabY } = await YodaUtil.storageGet('local', ['fabX', 'fabY']);
    const fallback = defaultPosition();
    const x = typeof fabX === 'number' ? fabX : fallback.x;
    const y = typeof fabY === 'number' ? fabY : fallback.y;
    applyPosition(x, y);
  }

  async function resetPosition() {
    const { x, y } = defaultPosition();
    applyPosition(x, y);
    await YodaUtil.storageSet('local', { fabX: x, fabY: y });
  }

  // A saved position can fall outside a smaller window — clamp it back in.
  function handleResize() {
    if (!fab) return;
    const rect = fab.getBoundingClientRect();
    applyPosition(rect.left, rect.top);
  }

  // ─── Dragging ───────────────────────────────────────────────────────────────

  function onPointerDown(event) {
    if (!event.isPrimary || (event.button != null && event.button !== 0)) return; // left/touch only
    dragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    const rect = fab.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    fab.classList.add('dragging');
    // Pointer capture means we still get the release even if the pointer ends up
    // over a Gmail iframe or a context menu eats the mouseup.
    try {
      fab.setPointerCapture(event.pointerId);
    } catch (_) {}
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true;
    if (!moved) return;
    applyPosition(event.clientX - offsetX, event.clientY - offsetY);
  }

  function onPointerUp(event) {
    if (!dragging) return;
    dragging = false;
    fab.classList.remove('dragging');
    try {
      fab.releasePointerCapture(event.pointerId);
    } catch (_) {}

    if (!moved) {
      activate();
      return;
    }
    const rect = fab.getBoundingClientRect();
    YodaUtil.storageSet('local', { fabX: Math.round(rect.left), fabY: Math.round(rect.top) });
  }

  function activate() {
    if (!YodaUtil.isAlive()) {
      toast('RELOAD GMAIL,\nYOU MUST.');
      return;
    }
    if (onActivate) onActivate();
  }

  // ─── Building ───────────────────────────────────────────────────────────────

  function build() {
    fab = document.createElement('div');
    fab.id = ID;
    fab.dataset.state = 'idle';
    // Without these the head is invisible to keyboards and screen readers.
    fab.setAttribute('role', 'button');
    fab.setAttribute('tabindex', '0');
    fab.setAttribute('aria-label', 'Read this email aloud in Yoda’s voice');

    for (let i = 0; i < 3; i++) {
      const ring = document.createElement('div');
      ring.className = 'ym-ring';
      fab.appendChild(ring);
    }

    img = document.createElement('img');
    img.id = 'yoda-head';
    img.alt = '';
    img.decoding = 'async';

    emoji = document.createElement('div');
    emoji.className = 'ym-emoji';
    emoji.textContent = '🧙';

    label = document.createElement('div');
    label.className = 'ym-label';
    label.textContent = 'YODA READ';

    fab.append(img, emoji, label);

    // If the mascot cannot load for any reason, show the emoji instead of
    // leaving an invisible button behind.
    img.addEventListener('error', () => {
      img.style.display = 'none';
      emoji.style.display = 'block';
    });
    const src = YodaUtil.guard(() => chrome.runtime.getURL('assets/mascot.png'), null);
    if (src) img.src = src;
    else {
      img.style.display = 'none';
      emoji.style.display = 'block';
    }

    fab.addEventListener('pointerdown', onPointerDown);
    fab.addEventListener('pointermove', onPointerMove);
    fab.addEventListener('pointerup', onPointerUp);
    fab.addEventListener('pointercancel', () => {
      dragging = false;
      fab.classList.remove('dragging');
    });
    fab.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    });
    fab.addEventListener('contextmenu', event => event.preventDefault());

    document.body.appendChild(fab);
    restorePosition();
    window.addEventListener('resize', handleResize);
  }

  // Gmail rebuilds large parts of its DOM; if our node is gone, put it back.
  function ensure(options) {
    if (options && options.onActivate) onActivate = options.onActivate;
    if (!document.body) return;
    const existing = document.getElementById(ID);
    if (existing && existing.isConnected) {
      fab = existing;
      return;
    }
    build();
  }

  // ─── State ──────────────────────────────────────────────────────────────────

  function setState(state) {
    if (!fab || !fab.isConnected) return;
    fab.dataset.state = state;
    if (!label) label = fab.querySelector('.ym-label');
    if (label) {
      label.textContent =
        state === 'loading' ? 'THINKING...' : state === 'speaking' ? '[ STOP ]' : 'YODA READ';
    }
    fab.setAttribute(
      'aria-label',
      state === 'speaking' ? 'Stop reading' : 'Read this email aloud in Yoda’s voice'
    );
  }

  function bob() {
    if (!fab) return;
    // Animate whichever of the two is actually visible.
    const head = fab.querySelector('#yoda-head:not([style*="display: none"])') || fab.querySelector('.ym-emoji');
    if (!head) return;
    head.classList.add('bobbing');
    setTimeout(() => head.classList.remove('bobbing'), 1200);
  }

  function toast(message) {
    const existing = document.getElementById('yoda-mail-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'yoda-mail-toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function destroy() {
    window.removeEventListener('resize', handleResize);
    const existing = document.getElementById(ID);
    if (existing) existing.remove();
    fab = null;
  }

  return { ensure, setState, bob, toast, resetPosition, destroy, SIZE };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = YodaFab;
