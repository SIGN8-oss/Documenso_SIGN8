#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const fs = require('fs');

const wellKnownPath = path.join(__dirname, '../.well-known');
const destPath = path.join(__dirname, '../apps/remix/public/.well-known');

console.log('Copying .well-known/ contents to apps');

if (fs.existsSync(destPath)) {
  fs.rmSync(destPath, { recursive: true, force: true });
}

fs.mkdirSync(destPath, { recursive: true });

for (const file of fs.readdirSync(wellKnownPath)) {
  fs.copyFileSync(path.join(wellKnownPath, file), path.join(destPath, file));
}
