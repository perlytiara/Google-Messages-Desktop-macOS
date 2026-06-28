const { execSync } = require('child_process');

console.log('Building Messages for Apple Silicon (arm64) and Intel (x64)...');
console.log('Targets: DMG (manual install) + ZIP (auto-update)');
execSync('npx electron-builder --mac dmg zip --arm64 --x64 -p never', { stdio: 'inherit' });
console.log('Done. DMGs and ZIPs are in dist/');
