import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';

export default defineConfig({
  root: 'src/mobile',
  base: '/',
  plugins: [react(), {
    name: 'ade-public-shell-worker',
    generateBundle(_options, bundle) {
      const files = ['/', '/manifest.webmanifest', '/icon.svg', ...Object.keys(bundle).map((name) => `/${name}`)];
      const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE = 'ade-mobile-${version}';
const SHELL = ${JSON.stringify(files)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ade-mobile-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(url.pathname)).then(response => response || Response.error())));
});
` });
    },
  }],
  build: { outDir: '../../out/mobile', emptyOutDir: true },
});
