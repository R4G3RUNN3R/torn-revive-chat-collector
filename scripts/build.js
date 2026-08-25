const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'torn-revive-chat-collector.user.js');
const outDir = path.join(root, 'dist');
const output = path.join(outDir, 'torn-revive-chat-collector.user.js');
const requiredSupportModules = [
  'src/core.js',
  'src/chat-dom.js',
  'src/public-channels.js',
  'src/client-chat-policy.js',
  'src/api-client.js',
  'src/revive-classifier.js',
  'src/candidate-pipeline.js'
];

if (!fs.existsSync(source)) {
  throw new Error('Installable userscript not found.');
}

for (const relativePath of requiredSupportModules) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`Required userscript support module not found: ${relativePath}`);
  }
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(source, output);
console.log(`Built ${path.relative(root, output)}`);
