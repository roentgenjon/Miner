# Schacht-Server

Kleiner Server für Online-Konten, Cloud-Spielstand und Geschenke an andere Spieler.
Läuft als **Cloudflare Worker** mit einer **D1-Datenbank** (SQLite). Das Spiel selbst bleibt eine statische Seite
(GitHub Pages) und ruft diesen Server nur auf, wenn man ein Online-Konto verbindet.

Aktuell deployt unter `https://schacht-api.<dein-workers-subdomain>.workers.dev`.

## Was er kann

| Pfad | Zweck |
| --- | --- |
| `POST /api/register` · `POST /api/login` · `POST /api/logout` | Konto anlegen, anmelden, abmelden |
| `GET /api/me` | Name, ob ein Spielstand liegt, Anzahl Geschenke im Posteingang |
| `GET /api/save` · `PUT /api/save` | Cloud-Spielstand lesen / schreiben (mit Versionsprüfung gegen Überschreiben) |
| `POST /api/send` | Münzen oder gekauften Skin an einen Spieler (per Name) schicken |
| `GET /api/inbox` · `POST /api/inbox/claim` | Geschenke ansehen und annehmen |

Sicherheit:

- Passwörter: PBKDF2-SHA256, 100 000 Runden, eigenes Salz pro Konto – im Klartext wird nichts gespeichert.
- Anmeldung liefert ein zufälliges 256-Bit-Token; in der Datenbank liegt nur dessen SHA-256. Sitzungen laufen nach 30 Tagen ab, höchstens 10 pro Konto.
- Nach 5 falschen Passwörtern ist das Konto 60 s gesperrt. Falscher Name und falsches Passwort sehen gleich aus.
- Verschenken und Annehmen laufen in **einer Datenbank-Transaktion**: Münzen gehen nie verloren oder doppelt durch (getestet, auch mit gleichzeitigen Anfragen).
- Begrenzungen: 30 Geschenke pro Stunde und Absender, 100 offene Geschenke pro Empfänger, Spielstand höchstens 100 kB.
- CORS: nur die in `ALLOWED_ORIGINS` (`wrangler.toml`) genannten Adressen dürfen aus dem Browser zugreifen.

**Grenze:** Das Spiel läuft im Browser, der Server kann den Spielverlauf nicht nachrechnen. Er prüft deshalb nur Form und Plausibilität
des Spielstands, nicht ob die Münzen „ehrlich“ verdient wurden. Wer seinen eigenen Spielstand manipuliert, kann sich damit Münzen
verschaffen und verschenken. Das schützt vor Fehlern und Missbrauch fremder Konten, nicht vor Schummeln.

## Einrichten und Deployen

Voraussetzung: ein Cloudflare-Konto und `npx wrangler login` (oder die Umgebungsvariable `CLOUDFLARE_API_TOKEN`).

```bash
cd server
npx wrangler d1 create schacht-db                              # einmalig; die ausgegebene database_id in wrangler.toml eintragen
npx wrangler d1 execute schacht-db --remote --file=schema.sql  # Tabellen anlegen (kann mehrfach laufen)
npx wrangler deploy                                            # Worker veröffentlichen
```

Danach in `src/net/api.ts` (oder per `VITE_API_URL` beim Build) die Adresse des Workers eintragen und das Spiel neu bauen.
Die Adresse der Spielseite muss in `ALLOWED_ORIGINS` stehen.

## Tests

```bash
npm test      # tests/server.test.ts: Server gegen SQLite im Speicher (gleiche SQL-Anweisungen wie D1)
```
