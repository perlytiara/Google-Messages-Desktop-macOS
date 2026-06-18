const { execSync } = require('child_process');

console.log('Building Messages for Apple Silicon (arm64) and Intel (x64)...');
execSync('npx electron-builder --mac dmg --arm64 --x64 -p never', { stdio: 'inherit' });
console.log('Done. DMGs are in dist/');
