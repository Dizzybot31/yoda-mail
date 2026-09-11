#!/usr/bin/env node
// Build an installable zip:  npm run package
//
// Produces dist/yoda-mail-<version>.zip containing only the files Chrome needs —
// no tests, no tooling, no git metadata. Attach it to a GitHub release so people
// can install without cloning.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const outDir = path.join(root, 'dist');
const outFile = path.join(outDir, `yoda-mail-${manifest.version}.zip`);

// Everything the extension actually loads at runtime.
const SHIPPED = ['manifest.json', 'src', 'popup', 'icons', 'assets', 'LICENSE'];

for (const entry of SHIPPED) {
  if (!fs.existsSync(path.join(root, entry))) {
    console.error(`Missing ${entry} — run "npm run icons" first?`);
    process.exit(1);
  }
}

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(outFile, { force: true });

try {
  execFileSync('zip', ['-r', '-q', '-X', outFile, ...SHIPPED], { cwd: root, stdio: 'inherit' });
} catch (err) {
  console.error('Could not run `zip`. On Debian/Ubuntu: sudo apt install zip');
  process.exit(1);
}

const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log(`dist/yoda-mail-${manifest.version}.zip  (${kb} KB)`);
