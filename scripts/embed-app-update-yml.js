#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const publish = packageJson.build?.publish;

if (!publish || publish.provider !== 'github') {
  console.warn('[embed-app-update-yml] No GitHub publish config in package.json — skipping.');
  process.exit(0);
}

const appRoots = [
  path.join(ROOT, 'dist', 'mac-arm64', 'Messages.app'),
  path.join(ROOT, 'dist', 'mac', 'Messages.app'),
];

const contents = [
  `owner: ${publish.owner}`,
  `repo: ${publish.repo}`,
  `provider: ${publish.provider}`,
  `releaseType: ${publish.releaseType || 'release'}`,
  `updaterCacheDirName: ${packageJson.name}-updater`,
  '',
].join('\n');

let wrote = 0;

for (const appRoot of appRoots) {
  const resourcesDir = path.join(appRoot, 'Contents', 'Resources');
  if (!fs.existsSync(resourcesDir)) {
    continue;
  }

  fs.writeFileSync(path.join(resourcesDir, 'app-update.yml'), contents);
  console.log('[embed-app-update-yml] Wrote', path.join(resourcesDir, 'app-update.yml'));
  wrote += 1;
}

if (!wrote) {
  console.warn('[embed-app-update-yml] No Messages.app found in dist/ — run npm run pack first.');
  process.exit(1);
}
