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
    caches
      .open(CACHE)
      .then((c) =>
        Promise.all(
          ASSETS.map((f) => {
            const url = new URL(f, scope).href;
            // cache: 'reload' umgeht den HTTP-Cache (GitHub Pages cached HTML 10 min), sonst landet eine veraltete Startseite im Cache.
            return fetch(url, { cache: 'reload' }).then((res) => {
              if (!res.ok) throw new Error(url + ' ' + res.status);
              return c.put(url, res);
            });
          }),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      // Offene Seiten informieren. Neue Seiten antworten sofort und laden sich selbst zum passenden
      // Zeitpunkt neu (nie mitten in einer Runde). Alte Seiten (ohne diese Logik) antworten nicht
      // und würden sonst ewig auf der alten Version bleiben, sie werden hier neu geladen.
      const clients = await self.clients.matchAll({ type: 'window' });
      await Promise.all(
        clients.map(
          (client) =>
            new Promise((resolve) => {
              const ch = new MessageChannel();
              let acked = false;
              ch.port1.onmessage = () => {
                acked = true;
                resolve();
              };
              client.postMessage({ type: 'schacht-update' }, [ch.port2]);
              setTimeout(() => {
                if (!acked) client.navigate(client.url).catch(() => undefined);
                resolve();
              }, 800);
            }),
        ),
      );
    })(),
  );
});

const HOME = new URL('./', scope).href;

// Seitenaufrufe: zuerst das Netz (immer die neueste Version), bei Ausfall der Cache (offline).
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(req, { cache: 'no-cache', signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      cache.put(HOME, res.clone());
    }
    return res;
  } catch {
    return (await cache.match(HOME)) || (await caches.match(req)) || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(scope)) return;
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req));
    return;
  }
  // Dateien mit Hash im Namen ändern sich nie: Cache zuerst.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/** Kennung des Builds (Datum + kurzer Commit), im Menü sichtbar, damit man die Version prüfen kann. */
const BUILD = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${process.env.GITHUB_SHA ? ' · ' + process.env.GITHUB_SHA.slice(0, 7) : ''}`;

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  // Relativer Basispfad: funktioniert auf GitHub Pages (Unterpfad), Netlify, Cloudflare.
  // Mit VITE_BASE=/mein-repo/ lässt sich ein absoluter Pfad erzwingen.
  base: process.env.VITE_BASE ?? './',
  plugins: [serviceWorker()],
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60_000 },
});
