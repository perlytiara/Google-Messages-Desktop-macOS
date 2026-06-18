const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__messagesNativeBridge', {
  deliverNotification(payload) {
    ipcRenderer.send('notification:incoming', payload);
  },
});

function forwardNotification(payload) {
  ipcRenderer.send('notification:incoming', payload);
}

function serializeData(data) {
  if (!data) {
    return '';
  }

  if (typeof data === 'string') {
    return data;
  }

  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function buildPayload(title, options = {}) {
  const body = options.body ?? '';
  return {
    title: typeof title === 'string' ? title : '',
    body: body || (typeof title === 'string' ? title : ''),
    data: serializeData(options.data),
    raw: serializeData({ title, ...options }),
    tag: options.tag ?? '',
    silent: options.silent ?? false,
  };
}

function deliverFromBridge(data) {
  forwardNotification({
    title: data.title ?? '',
    body: data.body ?? '',
    data: data.data ?? '',
    raw: data.raw ?? '',
    silent: data.silent ?? false,
    skipDedupe: data.skipDedupe ?? false,
  });
}

function installNotificationInterceptor() {
  const OriginalNotification = window.Notification;
  if (!OriginalNotification) {
    setTimeout(installNotificationInterceptor, 0);
    return;
  }

  function InterceptedNotification(title, options = {}) {
    const payload = buildPayload(title, options);
    forwardNotification(payload);

    this.title = payload.title;
    this.body = payload.body;
    this.tag = payload.tag;
    this.data = options.data ?? null;
    this.onclick = null;
    this.onshow = null;
    this.onerror = null;
    this.onclose = null;

    queueMicrotask(() => {
      if (typeof this.onshow === 'function') {
        this.onshow();
      }
    });
  }

  InterceptedNotification.prototype.close = function close() {
    if (typeof this.onclose === 'function') {
      this.onclose();
    }
  };

  Object.defineProperty(InterceptedNotification, 'permission', {
    get: () => 'denied',
  });

  InterceptedNotification.requestPermission = (callback) => {
    const result = Promise.resolve('denied');
    if (typeof callback === 'function') {
      result.then((status) => callback(status));
    }
    return result;
  };

  Object.defineProperty(InterceptedNotification, 'maxActions', {
    get: () => OriginalNotification.maxActions ?? 2,
  });

  window.Notification = InterceptedNotification;

  if (window.ServiceWorkerRegistration) {
    ServiceWorkerRegistration.prototype.showNotification = function showNotification(title, options) {
      forwardNotification(buildPayload(title, options ?? {}));
      return Promise.resolve();
    };
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || !data.__messagesNotif) {
      return;
    }

    deliverFromBridge(data);
  });
}

try {
  const channel = new BroadcastChannel('__messages_notifications__');
  channel.onmessage = (event) => {
    if (event.data?.__messagesNotif) {
      deliverFromBridge(event.data);
    }
  };
} catch {
  // BroadcastChannel unavailable in this context.
}

ipcRenderer.on('test:simulate-service-worker-notification', (_event, payload) => {
  deliverFromBridge({
    title: payload?.title ?? '',
    body: payload?.body ?? '',
    data: payload?.data ?? '',
    raw: payload?.raw ?? '',
    silent: false,
    skipDedupe: true,
  });
});

installNotificationInterceptor();
