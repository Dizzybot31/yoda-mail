// Yoda Mail — shared helpers.
//
// The important one is isAlive(). When Chrome reloads or updates an extension,
// the old content script keeps running in the page but its chrome.* bridge is
// gone, so every call throws "Extension context invalidated". Without a guard
// that leaves a dead Yoda head sitting on Gmail throwing errors on every click.

const YodaUtil = (function () {
  let invalidated = false;

  function isAlive() {
    if (invalidated) return false;
    try {
      // Reading runtime.id is the cheapest way to ask "is my extension still there".
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      invalidated = true;
      return false;
    }
  }

  function markDead() {
    invalidated = true;
  }

  // Every chrome.* call goes through here so a torn-down extension degrades
  // quietly instead of spraying the console.
  function guard(fn, fallback) {
    if (!isAlive()) return fallback;
    try {
      return fn();
    } catch (err) {
      if (String(err && err.message).includes('Extension context invalidated')) markDead();
      return fallback;
    }
  }

  function storageGet(area, keys) {
    return new Promise(resolve => {
      const done = guard(
        () =>
          chrome.storage[area].get(keys, data => {
            void chrome.runtime.lastError; // read it so Chrome does not log it
            resolve(data || {});
          }),
        null
      );
      if (done === null) resolve({});
    });
  }

  function storageSet(area, items) {
    return new Promise(resolve => {
      const done = guard(
        () =>
          chrome.storage[area].set(items, () => {
            void chrome.runtime.lastError;
            resolve(true);
          }),
        null
      );
      if (done === null) resolve(false);
    });
  }

  function onStorageChanged(handler) {
    guard(() =>
      chrome.storage.onChanged.addListener((changes, area) => {
        try {
          handler(changes, area);
        } catch (_) {}
      })
    );
  }

  // Keep a floating element on screen: after a resize (or a drag to the far edge
  // on a big monitor) a saved position can otherwise be unreachable forever.
  function clampToViewport(x, y, width, height, margin) {
    const m = margin == null ? 8 : margin;
    const maxX = Math.max(m, window.innerWidth - width - m);
    const maxY = Math.max(m, window.innerHeight - height - m);
    return {
      x: Math.min(Math.max(x, m), maxX),
      y: Math.min(Math.max(y, m), maxY),
    };
  }

  return { isAlive, markDead, guard, storageGet, storageSet, onStorageChanged, clampToViewport };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = YodaUtil;
