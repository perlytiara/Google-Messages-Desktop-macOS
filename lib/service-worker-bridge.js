const BROADCAST_CHANNEL = '__messages_notifications__';

const SERVICE_WORKER_PATCH = String.raw`(function () {
  if (self.__messagesNotificationPatch) return;
  self.__messagesNotificationPatch = true;

  const CHANNEL = '__messages_notifications__';

  function serializeData(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    try {
      return JSON.stringify(data);
    } catch (error) {
      return String(data);
    }
  }

  function deliver(payload) {
    try {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage(payload);
      channel.close();
    } catch (error) {}

    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage(payload));
    }).catch(() => {});
  }

  function forward(title, options) {
    const opts = options || {};
    const bodyText = String(opts.body || title || '');
    const payload = {
      __messagesNotif: true,
      title: String(title || ''),
      body: bodyText,
      data: serializeData(opts.data),
      raw: serializeData({ title, ...opts }),
      silent: !!opts.silent,
    };

    deliver(payload);
  }

  const proto = ServiceWorkerRegistration.prototype;
  proto.showNotification = function patchedShowNotification(title, options) {
    forward(title, options);
    return Promise.resolve();
  };
})();`;

const PAGE_BRIDGE_SCRIPT = String.raw`(function () {
  if (window.__messagesBroadcastBridge) return;
  window.__messagesBroadcastBridge = true;

  function deliver(data) {
    if (!data || !window.__messagesNativeBridge) return;
    window.__messagesNativeBridge.deliverNotification({
      title: data.title || '',
      body: data.body || '',
      data: data.data || '',
      raw: data.raw || '',
      silent: !!data.silent,
    });
  }

  try {
    const channel = new BroadcastChannel('__messages_notifications__');
    channel.onmessage = (event) => {
      if (event.data?.__messagesNotif) {
        deliver(event.data);
      }
    };
  } catch (error) {}

  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.__messagesNotif) {
      deliver(event.data);
    }
  });
})();`;

function setupServiceWorkerNotificationBridge(mainWindow, sessionRef) {
  const webContents = mainWindow.webContents;
  const debuggerSession = webContents.debugger;
  let debuggerAttached = false;

  const injectPageBridge = () => {
    if (webContents.isDestroyed()) {
      return;
    }

    webContents.executeJavaScript(PAGE_BRIDGE_SCRIPT, true).catch((error) => {
      console.error('[Messages] Failed to inject page notification bridge:', error);
    });
  };

  const injectPatch = async (sessionId) => {
    try {
      await debuggerSession.sendCommand(
        'Runtime.evaluate',
        { expression: SERVICE_WORKER_PATCH },
        sessionId,
      );
      console.log('[Messages] Service worker notification patch injected');
    } catch (error) {
      console.error('[Messages] Failed to patch service worker notifications:', error);
    }
  };

  const attachDebugger = () => {
    if (debuggerAttached || debuggerSession.isAttached() || webContents.isDestroyed()) {
      return;
    }

    try {
      debuggerSession.attach('1.3');
      debuggerAttached = true;
    } catch (error) {
      console.error('[Messages] Debugger attach failed:', error);
      return;
    }

    debuggerSession.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    }).catch((error) => {
      console.error('[Messages] Auto-attach failed:', error);
    });
  };

  webContents.on('did-finish-load', () => {
    injectPageBridge();
    attachDebugger();
  });

  webContents.on('dom-ready', () => {
    injectPageBridge();
  });

  debuggerSession.on('message', (_event, method, params) => {
    if (method !== 'Target.attachedToTarget') {
      return;
    }

    const { sessionId, targetInfo } = params;
    if (targetInfo?.type !== 'service_worker') {
      return;
    }

    injectPatch(sessionId);
  });

  sessionRef.serviceWorkers.on('registration-completed', (_event, details) => {
    if (!String(details.scope || '').includes('messages.google.com')) {
      return;
    }

    attachDebugger();
    injectPageBridge();
  });

  mainWindow.on('closed', () => {
    if (debuggerSession.isAttached()) {
      try {
        debuggerSession.detach();
      } catch {
        // Ignore detach errors during shutdown.
      }
    }
  });
}

module.exports = { setupServiceWorkerNotificationBridge, BROADCAST_CHANNEL };
