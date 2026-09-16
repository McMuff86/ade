# Ollama-Profillogo — Abnahme vom 16. September 2026

Das [offizielle Ollama-SVG](https://github.com/ollama/ollama/blob/main/docs/ollama-logo.svg)
liegt lokal im gemeinsamen Runtime-Logosystem. Originalkontur erhalten; weisse
Farbe und quadratischer Bildrahmen passen zur bestehenden Profilanzeige. Die
MIT-Lizenz ist im SVG enthalten. Eigene Fotos haben weiter Vorrang.

## Ausführbare Nachweise

- Desktop: **17 Checks**, Logo in Rail und Profilkarte, Tastaturbedienung.
- Tablet-Browser: **24 Checks**, SVG geladen, Vergrösserung bei Pixeldichte 2,
  Escape/Fokusrückgabe und responsives Profil. Screenshots visuell geprüft.
- Vollständiges **pnpm verify bestanden**, Exit 0: drei TypeScript-Projekte,
  **72 Suiten / 3.088 Fachchecks**, Produktionsbuild, alle Electron-/Browser-
  Abläufe und **22 Visualchecks**. Kein physischer Tablet-Test behauptet.
- Während des ersten Gesamtversuchs entstanden parallele Diktat-Änderungen.
  Dieser Lauf wurde beendet; die vollständige positive Abnahme erfolgte im
  unveränderten Checkout `C:\Users\Adi.Muff\repos\ade-ollama-logo-ea14c18`.
- Log: `test-results/ollama-logo-verify-final.log`. Bildnachweise:
  `test-results/profile-logos/{desktop,tablet}-ollama.png`.

## Build und persönliche Aktivierung

- Codecommit **ea14c18fe3f9e7c9085615eb93ba3f1e489926fd**; sourceId **7bc2bd085b4f34107413**.
  24 Releaseartefakte aus dem geprüften Produktionsbuild, danach separate
  isolierte Electron-Startprobe bestanden.
- Release `dist/ollama-logo-ea14c18`; sauberer Tray-Neustart von PID
  **15628** auf **49556**, bestätigt um **2026-09-16T07:29:27.6118192Z** (UTC).
- 6 Profile und 4 Projekte per Hashvergleich erhalten;
  1 gekoppeltes Gerät verfügbar. Codex-, Claude-, Grok- und Ollama-Logo geladen;
  Tablet-Seite HTTP 200. Startmenüeintrag auf neuen Release aktualisiert.
- Sicherung: `C:\Users\Adi.Muff\ADE-Backups\OllamaLogo-20260916-092905`. Vorheriger Release bleibt verfügbar.
- Belege: `test-results/ollama-logo-release-smoke.json`,
  `test-results/ollama-logo-restart.json`,
  `dist/ollama-logo-ea14c18/activation.json` und `desktop-active.png` im Releaseordner.
- Kein Push beauftragt. Parallele Diktat-Arbeit ist nicht Teil dieser Aktivierung.
