// Service Worker for Push MFA App

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Holds payloads from notification clicks until the client signals it's ready
const pendingPayloads = new Map(); // clientId -> payload

self.addEventListener('push', event => {
  const payload = event.data ? event.data.json() : {};

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const visibleClient = clientList.find(c => c.visibilityState === 'visible');

      if (visibleClient) {
        visibleClient.postMessage({ type: 'PUSH_REQUEST', data: payload });
      } else {
        return self.registration.showNotification('MFA Request', {
          body: payload.message || 'Approve or deny the request',
          data: payload,
          tag: payload.request_id,
          requireInteraction: true,
        });
      }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const pushData = event.notification.data;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const existingClient = clientList.find(c => c.url && c.focus);

      const clientPromise = existingClient
        ? existingClient.focus()
        : self.clients.openWindow('/mfa');

      return clientPromise.then(client => {
        if (client) {
          // Store the payload keyed by client id — the app will request it on mount
          pendingPayloads.set(client.id, pushData);
        }
      });
    })
  );
});

// When the React app mounts it sends CLIENT_READY; flush any pending payload
self.addEventListener('message', event => {
  if (event.data?.type === 'CLIENT_READY' && event.source) {
    const payload = pendingPayloads.get(event.source.id);
    if (payload) {
      pendingPayloads.delete(event.source.id);
      event.source.postMessage({ type: 'PUSH_REQUEST', data: payload });
    }
  }
});
