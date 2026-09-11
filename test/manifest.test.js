// Manifest rules that Chrome only tells you about at load time.
//
// v1.1.0 shipped a manifest Chrome refused outright: web_accessible_resources
// had its path narrowed to /mail/*, which is legal in content_scripts.matches
// but not there. "Failed to load extension: Invalid match pattern" is a bad way
// to find that out, so the rules live here instead.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('web_accessible_resources match patterns are host-level', () => {
  // Chrome requires <scheme>://<host>/* here — a narrower path is rejected and
  // the whole extension fails to load.
  for (const entry of manifest.web_accessible_resources || []) {
    for (const pattern of entry.matches) {
      assert.match(
        pattern,
        /^[a-z*]+:\/\/[^/]+\/\*$/,
        `"${pattern}" narrows the path; web_accessible_resources matches must end in /*`
      );
    }
  }
});

test('every file the manifest references exists', () => {
  const script = manifest.content_scripts[0];
  const referenced = [
    ...script.js,
    ...script.css,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...(manifest.web_accessible_resources || []).flatMap(entry => entry.resources),
  ];
  for (const file of new Set(referenced)) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `manifest references missing file: ${file}`);
  }
});

test('content scripts are listed in dependency order', () => {
  // They share one scope and run in order, so a module must be defined before
  // anything that uses it.
  const order = manifest.content_scripts[0].js;
  const defines = { 'src/util.js': 'YodaUtil', 'src/text.js': 'YodaText', 'src/speech.js': 'YodaSpeech', 'src/watcher.js': 'YodaWatcher', 'src/fab.js': 'YodaFab' };
  const seen = new Set();
  for (const file of order) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const [defining, name] of Object.entries(defines)) {
      if (defining === file || seen.has(name)) continue;
      assert.ok(
        !new RegExp(`\\b${name}\\.`).test(source),
        `${file} uses ${name} before ${defining} is loaded`
      );
    }
    if (defines[file]) seen.add(defines[file]);
  }
});

test('manifest and package versions agree', () => {
  assert.strictEqual(manifest.version, pkg.version);
});

test('no permission is declared that the code does not use', () => {
  const source = manifest.content_scripts[0].js
    .concat(['popup/popup.js'])
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');
  for (const permission of manifest.permissions) {
    assert.ok(
      source.includes(`chrome.${permission}`),
      `"${permission}" is declared but never used — it only inflates the install warning`
    );
  }
});

test('no background service worker ships', () => {
  // The ElevenLabs worker was unreachable dead code that called an undeclared host.
  assert.ok(!manifest.background, 'a background worker reappeared');
});

test('the extension requests no host beyond Gmail', () => {
  for (const host of manifest.host_permissions) {
    assert.match(host, /^https:\/\/mail\.google\.com\//, `unexpected host permission: ${host}`);
  }
});
