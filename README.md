# Schacht

Pixel-Grabespiel im Browser: Grabe dich durch einen 7 Spalten breiten Schacht bis zum **Herz des Bergs** in 1 000 000 000 m Tiefe.
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
| ← → ↓ ↑ / A D S W | links, rechts, nach unten graben bzw. laufen; ↑ / W klettert und gräbt nach oben |
| Leertaste / Button „TNT“ | Dynamit legen |
| T / Button „AUTO“ | Auto-Dynamit an/aus: legt beim Graben alle 25 ms eine Ladung 3 Felder voraus (verletzen dich nicht, auch kein Fallschaden in die aufgerissenen Schächte) |
| P / Esc / Button „II“ | Pause |
| Tippen | in Richtung des Tippens (relativ zur Spielfigur, auch nach oben) graben, gedrückt halten = weitergraben |
| Wischen | in Wischrichtung graben oder klettern |

- **Klettern:** Nach oben gräbt oder läuft die Figur und hält sich dabei kurz fest. Lässt du los, fällt sie nach einem Moment wieder (Fallschaden ab 4 Feldern).
- **Lampe** ist deine Energie – sie verbraucht sich unter Tage, **Kohle** füllt sie auf. Ist sie leer, wird es dunkel und gefährlich.
- **Zonen:** 100 000 000 Zonen à 10 m, reihum Erde, Tiefschiefer, Magmazone und Kristallhöhle ("Erde I", "Tiefschiefer I", … "Kristallhöhle 25000000"). Jeder Durchlauf hat einen eigenen Farbton; mit der Tiefe werden Zonen dunkler, verbrauchen mehr Lampenenergie, haben mehr Gefahren und wertvollere Erze (am Schachtende Lampenverbrauch ×2,5, Gefahren ×2,2, Erzwert ×10,9). Zonen werden bei Bedarf berechnet, nicht gespeichert; eine Meldung und eine beschriftete Linie gibt es alle 1 000 Zonen (10 000 m). Das Herz (1 000 000 000 m = Sieg) liegt am Ende. Tiefe und Zonenzahl stehen als `HEART_DEPTH` und `ZONE_COUNT` in `src/config.ts`.
- **Erze** bringen Münzen (Grundwerte ×10, Regler `ORE_VALUE_MULT` in `src/config.ts`), aufeinanderfolgende Erze erhöhen den **Kombo-Multiplikator**.
- **Truhen** enthalten Münzen, Kohle, Dynamit oder ein Leben. **Sprengkisten** explodieren, sobald man sie abbaut – und lösen Kettenreaktionen aus.
- Gefahren: fallendes **Geröll**, **Fledermäuse** (Hineinlaufen = Schlag).
- **Dynamit** sprengt einen Bereich um die Figur; weiteres Dynamit und Sprengkisten im Radius zünden nacheinander (Kettenreaktion). Start-Dynamit = 40 + 3 pro Upgrade-Stufe.
- **Werkstatt:** 21 Upgrades, 15 davon mit 600 bis 1 000 000 Stufen (Sammelkauf ×10/×100/×1k/Max), bezahlt mit Münzen. (Alle Preise × `UPGRADE_PRICE_MULT` = 0,1, siehe `src/config.ts`; Neu: Selbstheilung, Aderngespür, Glückstreffer, Kurze Lunte, Schreckstarre, Kopfgeld, Dynamit-Nachschub, Wendigkeit.) **Missionen:** 3 zufällige pro Runde. **Erfolge:** 9 Stück.
- **Tagesschacht:** gleicher Seed für alle am selben Kalendertag. Die **Rekordlinie** zeigt deine bisher größte Tiefe.
- **Konten:** Im Menü unter „Konto“ gibt es lokale Profile auf diesem Gerät (bis zu 12), jedes mit eigenem Spielstand: anlegen, wechseln, umbenennen, löschen. Das erste Konto („Spieler“) nutzt den Schlüssel `schacht-meta` weiter, vorhandene Spielstände laufen also unverändert. Es gibt **keine Anmeldung und keinen Server**: Ein Konto lebt nur in diesem Browser. Mit **Export** speicherst du ein Konto als Datei (`schacht-<Name>.json`), mit **Import** legst du daraus auf einem anderen Gerät ein neues Konto an.
- **Online-Konto (optional):** Unter „Konto → Online-Konto“ kannst du dich mit Name und Passwort **anmelden oder neu registrieren**. Dann wird der Spielstand des aktiven Kontos online gesichert (automatisch kurz nach jeder Änderung, auch auf anderen Geräten ladbar) und du kannst **Münzen oder Skins direkt an andere Spieler schicken** (Menü → Geschenke → „An Spieler“). Der Empfänger nimmt sie im **Posteingang** an. Sind Gerät und Online-Stand verschieden, fragt das Spiel, welcher gilt – nichts wird stillschweigend überschrieben. Jedes lokale Konto kann ein **eigenes** Online-Konto bekommen; ein altes Konto machst du in der Kontenliste mit „Online machen“ online (sein Spielstand wird hochgeladen, oder du wählst bei einem vorhandenen Online-Konto, welcher Stand gilt). Ohne Online-Konto läuft alles wie bisher offline. Der Server liegt in [`server/`](server/README.md) (Cloudflare Worker + D1).
- **Skins:** 26 Aussehen der Spielfigur: 16 zum Kaufen (von „Warnweste“ für 300 bis „Diamantpanzer“ für 25 000 Münzen, dazu Regenbogen und Neon mit Farbwechsel) und 9 durch Erfolge freigeschaltete (z. B. „Steinmetz“ für Schieferbrecher, „Glutträger“ für Magmaläufer, „Bergbaugeist“ für Herz des Bergs). Skins gehören zum Konto und lassen sich (Kaufskins) verschenken.
- **Geschenke:** Im Menü unter „Geschenke“ verschenkst du **Münzen** oder einen **gekauften Skin** (Standard- und Erfolgs-Skins nicht). Du bekommst einen Code und einen Link, die du selbst verschickst (Chat, Mail, „Teilen“). Beim Erstellen wird das Geschenk sofort von deinem Konto abgebucht; unter „Zuletzt verschenkt“ kannst du den Link erneut kopieren. Der Empfänger öffnet den Link (oder fügt den Code unter „Einlösen“ ein) und nimmt an. Ein Code funktioniert pro Gerät nur einmal (auch über Konten hinweg); eigene Geschenke lassen sich nicht selbst einlösen; einen schon vorhandenen Skin lehnt das Spiel ab, ohne den Code zu verbrauchen. **Grenze ohne Server:** Ein Code ist nicht an eine Person gebunden, und die Prüfsumme erkennt nur Tippfehler, keine absichtlichen Fälschungen. Für echte Sicherheit (Tausch, Bestenlisten, Handel) bräuchte es einen Server.
- Fortschritt liegt in `localStorage`: das Hauptkonto unter `schacht-meta`, weitere Konten unter `schacht-meta:<Kennung>`, die Kontenliste unter `schacht-accounts`, das Geschenk-Gerätebuch unter `schacht-gifts`.

## Projektstruktur

```
src/
  config.ts            zentrale Spielwerte (Kosten, Wahrscheinlichkeiten, Schaden, Zonen, Dynamit …)
  main.ts              Verdrahtung: Loop, Eingabe, UI, Renderer, Audio, Speicherstand
  loop.ts              FixedStepper – fester Zeitschritt (60 Hz Logik, bildratenunabhängig)
  game/                reine Spiellogik, kein DOM
    types.ts           Blocktypen, Ereignisse, gemeinsame Typen
    rng.ts             Seed-Zufall, Tagesschacht-Seed
    world.ts           Weltgenerierung abschnittsweise bei Bedarf (Zonen, Erze, Höhlen), Zellzugriff
    state.ts           GameState, Spieler, Entitäten, Schaden
    player.ts          Bewegung, Graben, Schwerkraft, Fallschaden
    bats.ts            Fledermäuse
    physics.ts         Geröll (Wackeln, Fallen)
    tnt.ts             Dynamit, Explosion, Kettenreaktion
    loot.ts            Erz/Kohle/Truhen, Kombo
    game.ts            step(): ein Logikschritt
  meta/                Fortschritt über Runden hinweg
    save.ts            localStorage, fehlertolerantes Laden
    accounts.ts        lokale Konten (Profile), Export/Import
    skins.ts           Skins kaufen und auswählen
    gifts.ts           Geschenke: Codes, Verschenken, Einlösen
  net/                 Online-Konto
    api.ts             Client für den Schacht-Server
    sync.ts            Anmelden, Sichern/Laden, Konflikte, Geschenke an Spieler
server/                Cloudflare Worker + D1 (Konten, Cloud-Spielstand, Geschenke), siehe server/README.md
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

- Weltgenerierung: gleicher Seed → identische Welt (Tagesschacht), Zonen, Herz am Schachtende
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

1. Code ist im Repository (Standard-Branch oder `main`).
2. **Settings → Pages → Build and deployment → Source: „GitHub Actions“** (einmalig).
3. Danach startet jeder Push auf `main` bzw. `claude/gracious-wright-j6q4sw`, oder **Actions → „Deploy auf GitHub Pages“ → Run workflow**, [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): Tests, Build, Veröffentlichung.
4. Die Seite erscheint unter `https://<nutzer>.github.io/<repo>/`; die genaue URL steht im Deploy-Job.

Wird der Branch später in `main` umbenannt oder zusammengeführt, passt der Workflow ohne Änderung.

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
