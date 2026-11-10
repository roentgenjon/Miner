/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

/** Dateien aus public/, die der Service Worker vorab cachen soll. */
const PUBLIC_FILES = [
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

/** Erzeugt sw.js mit der Liste aller gebauten Dateien (Offline-Betrieb). */
function serviceWorker(): Plugin {
  return {
    name: 'schacht-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = ['./', 'index.html', ...Object.keys(bundle).filter((f) => f !== 'sw.js' && f !== 'index.html'), ...PUBLIC_FILES];
      const version = Date.now().toString(36);
      const source = `// automatisch erzeugt
const CACHE = 'schacht-${version}';
const ASSETS = ${JSON.stringify(files)};
const scope = self.registration.scope;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS.map((f) => new URL(f, scope).href))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(scope)) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => (req.mode === 'navigate' ? caches.match(new URL('./', scope).href) : Response.error())),
    ),
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relativer Basispfad: funktioniert auf GitHub Pages (Unterpfad), Netlify, Cloudflare.
  // Mit VITE_BASE=/mein-repo/ lässt sich ein absoluter Pfad erzwingen.
  base: process.env.VITE_BASE ?? './',
  plugins: [serviceWorker()],
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
