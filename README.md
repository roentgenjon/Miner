# Schacht

Pixel-Grabespiel im Browser: Grabe dich durch einen 7 Spalten breiten Schacht bis zum **Herz des Bergs** in 250 m Tiefe.
Vite + TypeScript (strict), Rendering per Canvas 2D, als PWA offline spielbar und auf dem Handy installierbar.

> **Hinweis:** Diese Version wurde nach der Feature-Beschreibung neu geschrieben, die ursprüngliche `schacht.html`
> lag nicht vor. Balancing-Werte, Look und das Speicherformat sind daher eine eigene Umsetzung. Alle Werte stehen
> zentral in [`src/config.ts`](src/config.ts) und lassen sich dort an das Original angleichen.

## Schnellstart

```bash
npm install        # Abhängigkeiten installieren
npm run dev        # Entwicklungsserver (http://localhost:5173)
npm run build      # Typprüfung + Produktions-Build nach dist/
npm run preview    # Build lokal ausprobieren (inkl. Service Worker)
npm test           # Vitest-Tests
npm run icons      # PWA-Icons neu erzeugen (public/icons)
```

Benötigt Node.js ≥ 20.

## Spielen

| Eingabe | Aktion |
| --- | --- |
| ← → ↓ / A D S | links, rechts, nach unten graben bzw. laufen |
| Leertaste / Button „TNT“ | Dynamit legen |
| P / Esc / Button „II“ | Pause |
| Tippen | in Richtung des Tippens (relativ zur Spielfigur) graben, gedrückt halten = weitergraben |
| Wischen | in Wischrichtung graben |

- **Lampe** ist deine Energie – sie verbraucht sich unter Tage, **Kohle** füllt sie auf. Ist sie leer, wird es dunkel und gefährlich.
- **Zonen:** Erde (0 m) → Tiefschiefer (40 m) → Magmazone (110 m) → Kristallhöhle (200 m) → Herz (250 m = Sieg).
- **Erze** bringen Münzen, aufeinanderfolgende Erze erhöhen den **Kombo-Multiplikator**.
- **Truhen** enthalten Münzen, Kohle, Dynamit oder ein Leben. **Sprengkisten** explodieren, sobald man sie abbaut – und lösen Kettenreaktionen aus.
- Gefahren: fallendes **Geröll**, tropfende **Lava**, **Fledermäuse** (Hineinlaufen = Schlag).
- **Dynamit** sprengt einen Bereich um die Figur; weiteres Dynamit und Sprengkisten im Radius zünden nacheinander (Kettenreaktion). Start-Dynamit = 40 + 3 pro Upgrade-Stufe.
- **Werkstatt:** 10 Upgrades, bezahlt mit Münzen. **Missionen:** 3 zufällige pro Runde. **Erfolge:** 9 Stück.
- **Tagesschacht:** gleicher Seed für alle am selben Kalendertag. Die **Rekordlinie** zeigt deine bisher größte Tiefe.
- Fortschritt liegt in `localStorage` unter dem Schlüssel `schacht-meta`.

## Projektstruktur

```
src/
  config.ts            zentrale Spielwerte (Kosten, Wahrscheinlichkeiten, Schaden, Zonen, Dynamit …)
  main.ts              Verdrahtung: Loop, Eingabe, UI, Renderer, Audio, Speicherstand
  loop.ts              FixedStepper – fester Zeitschritt (60 Hz Logik, bildratenunabhängig)
  game/                reine Spiellogik, kein DOM
    types.ts           Blocktypen, Ereignisse, gemeinsame Typen
    rng.ts             Seed-Zufall, Tagesschacht-Seed
    world.ts           Weltgenerierung (Zonen, Erze, Höhlen), Zellzugriff
    state.ts           GameState, Spieler, Entitäten, Schaden
    player.ts          Bewegung, Graben, Schwerkraft, Fallschaden
    bats.ts            Fledermäuse
    physics.ts         Geröll (Wackeln, Fallen) und tropfende Lava
    tnt.ts             Dynamit, Explosion, Kettenreaktion
    loot.ts            Erz/Kohle/Truhen, Kombo
    game.ts            step(): ein Logikschritt
  meta/                Fortschritt über Runden hinweg
    save.ts            localStorage, fehlertolerantes Laden
    shop.ts            Upgrade-Preise, Kauf, Umrechnung in Spielwerte
    missions.ts        Missionen ziehen und verfolgen
    achievements.ts    Erfolge
    progress.ts        Rundenergebnis in den Speicherstand übertragen
  render/              Canvas-Rendering (nur lesend)
    sprites.ts         Pixel-Sprites als ASCII-Daten
    textures.ts        Texturen/Sprites zu Canvas
    renderer.ts        Zeichnen, Kamera, Dunkelheit/Lichtkegel, Partikel
  audio/sfx.ts         Soundeffekte per WebAudio (synthetisch)
  input/controls.ts    Tastatur, Bildschirm-Buttons, Tippen/Wischen
  ui/                  HUD und Menüs (DOM)
public/                Manifest, Icons
scripts/               Icon-Generator
tests/                 Vitest
```

Die Spiellogik (`src/game`, `src/meta`) importiert weder DOM noch Canvas und ist deshalb ohne Browser testbar.
Das Rendering liest den Zustand nur; die Logik gibt Ereignisse (`GameEvent`) aus, auf die Ton, Partikel und HUD reagieren.

## Tests

`npm test` prüft u. a.

- Weltgenerierung: gleicher Seed → identische Welt (Tagesschacht), Zonen, Herz bei 250 m
- Dynamit: Radius, Schaden, Kettenreaktion über Dynamit und Sprengkisten
- Werkstatt: Kauf, zu wenig Geld, Maximalstufe, Start-Dynamit = 40 + 3 × Stufe
- Missionen: Ziehen, Fortschritt, Belohnung
- Speicherstand, Erfolge, Rundenergebnis
- Fester Zeitschritt: 60 Hz und 120 Hz liefern gleich viele Logikschritte
- Ein Bot-Test als Balancing-Plausibilitätsprüfung

## Deployment

Der Build ist ein statischer Ordner (`dist/`) mit **relativem Basispfad** (`base: './'`), er läuft deshalb unverändert
unter `https://nutzer.github.io/repo/` ebenso wie auf einer eigenen Domain. Soll ein absoluter Pfad erzwungen werden:
`VITE_BASE=/repo/ npm run build`.

### GitHub Pages (eingerichtet)

1. Repository auf GitHub pushen, Branch `main`.
2. **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
3. Jeder Push auf `main` startet [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): Tests, Build, Veröffentlichung.

### Netlify

Repository verbinden – [`netlify.toml`](netlify.toml) enthält Build-Befehl (`npm run build`) und Ordner (`dist`).

### Cloudflare Pages

Neues Projekt aus dem Repository, Build-Befehl `npm run build`, Ausgabeordner `dist`, Node 22.
Die Cache-Header für `sw.js` und `assets/` stehen in [`public/_headers`](public/_headers).

## PWA

- `public/manifest.webmanifest` und Icons in `public/icons` (Pixel-Icon, per `npm run icons` erzeugt, inkl. maskable).
- Der Service Worker `sw.js` wird beim Build von einem kleinen Vite-Plugin (`vite.config.ts`) mit allen Build-Dateien erzeugt
  und cached sie beim ersten Besuch – danach läuft das Spiel offline. Er wird nur im Produktions-Build registriert.
- Installieren: Android/Chrome „App installieren“, iOS Safari „Zum Home-Bildschirm“.

## Mobile

Safe-Areas (`viewport-fit=cover`, `env(safe-area-inset-*)`), Zoom und Scrollen sind beim Spielen deaktiviert
(`touch-action: none`, `user-scalable=no`). Die Bildschirm-Buttons werden nur auf Touch-Geräten bzw. kleinen Fenstern gezeigt.
