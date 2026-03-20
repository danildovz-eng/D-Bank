self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
    // Порожній обробник, щоб браузер засчитав це як PWA
});