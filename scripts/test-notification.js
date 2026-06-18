const { app } = require('electron');
const { showMessageNotification } = require('../lib/notifications');

app.whenReady().then(() => {
  showMessageNotification({
    title: 'Test Contact',
    body: 'Your verification code is 482913',
    silent: false,
  });

  setTimeout(() => app.quit(), 2500);
});
