const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'torn-revive-chat-collector.user.js');
const outDir = path.join(root, 'dist');
const output = path.join(outDir, 'torn-revive-chat-collector.user.js');

if (!fs.existsSync(source)) {
  throw new Error('Installable userscript not found.');
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(source, output);
console.log(`Built ${path.relative(root, output)}`);
