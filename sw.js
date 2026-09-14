self.addEventListener('push', event => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(
      data.title || '🏈 Touchdown Hit!',
      {
        body: data.body || 'Your anytime touchdown bet hit!',
        data: {
          url: data.url || './'
        },
        tag: data.tag || 'atd-touchdown'
      }
    )
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    clients.openWindow(
      event.notification.data?.url || './'
    )
  );
});
