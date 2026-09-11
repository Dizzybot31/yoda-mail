// Yoda Mail — settings popup.

const DEFAULTS = { speechRate: 0.9, voiceName: '', chimeEnabled: false };

const rateSlider = document.getElementById('speechRate');
const rateVal = document.getElementById('rateVal');
const voiceSelect = document.getElementById('voiceName');
const voiceHint = document.getElementById('voiceHint');
const chimeToggle = document.getElementById('chimeEnabled');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const resetBtn = document.getElementById('reset');
const statusEl = document.getElementById('status');

// The same order the content script prefers, so the popup recommends what it
// would actually pick.
const PREFERRED = [
  'Superstar', 'Trinoids', 'Zarvox', 'Bad News', 'Albert', 'Fred',
  'Ralph', 'Grandpa', 'Daniel', 'Google UK English Male',
];

let saved = Object.assign({}, DEFAULTS);

// ─── Voices ───────────────────────────────────────────────────────────────────

// getVoices() is empty until the list loads, and voiceschanged may fire late or
// never — so populate now, again on the event, and once more after a timeout.
function populateVoices() {
  const voices = window.speechSynthesis.getVoices() || [];
  const chosen = voiceSelect.value || saved.voiceName || '';

  voiceSelect.textContent = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = voices.length ? 'AUTO (BEST AVAILABLE)' : 'AUTO (LOADING…)';
  voiceSelect.appendChild(auto);

  const english = voices.filter(v => /^en/i.test(v.lang));
  const rest = voices.filter(v => !/^en/i.test(v.lang));

  for (const voice of english.concat(rest)) {
    const option = document.createElement('option');
    option.value = voice.name;
    const star = PREFERRED.includes(voice.name) ? '★ ' : '';
    option.textContent = `${star}${voice.name} (${voice.lang})`;
    voiceSelect.appendChild(option);
  }

  if (chosen && voices.some(v => v.name === chosen)) voiceSelect.value = chosen;

  const hasSilly = voices.some(v => PREFERRED.slice(0, 6).includes(v.name));
  voiceHint.style.display = hasSilly ? 'none' : '';
}

window.speechSynthesis.addEventListener('voiceschanged', populateVoices);
setTimeout(populateVoices, 400);
populateVoices();

// ─── Load ─────────────────────────────────────────────────────────────────────

chrome.storage.sync.get(DEFAULTS, data => {
  if (chrome.runtime.lastError) {
    flash('Load your settings, I could not.', 'error');
    return;
  }
  saved = Object.assign({}, DEFAULTS, data);
  rateSlider.value = saved.speechRate;
  chimeToggle.checked = Boolean(saved.chimeEnabled);
  populateVoices();
  updateLabels();
});

rateSlider.addEventListener('input', updateLabels);

function updateLabels() {
  rateVal.textContent = parseFloat(rateSlider.value).toFixed(2) + '×';
}

// ─── Save ─────────────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
  const next = {
    speechRate: parseFloat(rateSlider.value),
    voiceName: voiceSelect.value,
    chimeEnabled: chimeToggle.checked,
  };
  chrome.storage.sync.set(next, () => {
    // Without this check a failed write (quota, sync off) still said "Saved".
    if (chrome.runtime.lastError) {
      flash('Save it, I could not: ' + chrome.runtime.lastError.message, 'error');
      return;
    }
    saved = next;
    flash('Saved, your settings are. 🧙', 'success');
  });
});

testBtn.addEventListener('click', () => {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance('Read your email, I will. Patience, you must have.');
  const voice = (window.speechSynthesis.getVoices() || []).find(v => v.name === voiceSelect.value);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.pitch = 0.65;
  utterance.rate = parseFloat(rateSlider.value);
  window.speechSynthesis.speak(utterance);
});

resetBtn.addEventListener('click', () => {
  // The content script watches this key and moves the head back into view.
  chrome.storage.local.set({ resetFabPosition: Date.now() }, () => {
    if (chrome.runtime.lastError) {
      flash('Move it, I could not.', 'error');
      return;
    }
    flash('Home, the head has gone.', 'success');
  });
});

function flash(message, type) {
  statusEl.textContent = message;
  statusEl.className = type;
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = '';
  }, 3500);
}
