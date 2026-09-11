# ADE: Einrichtung und Orientierung

Stand: 11. September 2026. Beauftragter Folge-Goal nach dem abgeschlossenen
Projektablauf. Grundlage sind Priorität 1 und 5 des
[Produktreviews](research/ADE_PRODUCT_REVIEW_2026-09-10.md).

Ein neuer Benutzer soll den Projekt-Stamm, seine CLI-Anmeldung und den optionalen
Tablet-Zugang in einem nachvollziehbaren Weg einrichten. Ein gekoppeltes Tablet
soll zeigen, welche Schritte und Freigaben fehlen und welchen PC-/Browser-Build
es verwendet. Profile bleiben optional; vorhandene Arbeitsabläufe bleiben erhalten.

| Task | Abnahme | Stand |
|---|---|---|
| S0 | Umfang, Grenzen und Prüfkriterien festhalten | abgeschlossen |
| S1 | Desktop-Einrichtung verbindet Projektordner, native CLI-/Anmeldeprüfung, optionale Kopplung und Gerätefreigaben. Kein erzwungener Agent. Laden/Fehler/erneute Prüfung, Tastatur/Fokus, echte Electron-Prüfung | abgeschlossen für native Windows |
| S2 | Mobile-Einrichtungsstatus zeigt konkrete fehlende Rechte und nächste Schritte; Host-/Browser-Builds unterscheidbar, unbekannte/veraltete/offline Zustände ehrlich. Keine automatischen Mutationen oder Seitenneuladungen; signierter Zugriff und Browserprüfung | abgeschlossen für native Windows/Chromium |
| S3 | Guide mit echten neuen Aufnahmen, Verträge/Status/Handoff synchron; vollständiges pnpm verify. Commit je Task, gemeinsamer Push und geprüfter ADE-Neustart unter Erhalt von Kopplung/Routen | abgeschlossen |

Grenzen: Die Einrichtung nutzt vorhandene typisierte Dienste. Sie installiert
keine CLI und speichert keine erfundene erfolgreiche Anmeldung. Terminalstarts
bleiben ausdrücklich im gewählten Projekt. Kopplung, Gerätefreigaben und
Veröffentlichungen verlangen die vorhandene bewusste Benutzeraktion.
Host-Metadaten enthalten keine absoluten Pfade oder Zugangsdaten. Fehlende
Build-Daten alter Hosts bedeuten unbekannt; Offline-Daten werden nie als aktuelle
Erreichbarkeit ausgegeben. Dialoge bewahren Fokus und vorhandene Entwürfe.

Ausführbare Abnahme auf nativem Windows mit isolierten Profilen und kontrollierten
CLIs; physische Samsung-/DeX-Messung, WSL-Bereitschaft und dauerhaftes Dateiarchiv
bleiben eigene Folgearbeiten. Vor dem Neustart aktive Runs, Leases und Terminals
prüfen. Die bestehende persönliche ADE-Instanz ist keine Test-Fixture.

Basis: `7218991`, vollständige vorherige Abnahme mit 2.588 Checks. Neue Nachweise
werden hier pro Task eingetragen; die Basis ersetzt deren Prüfung nicht.

## S1: Desktop-Einrichtung

16 echte Electron-Prüfungen bestanden: leeres Profil, ungültiger/gültiger Stamm,
CLI-Anmeldung/Abmeldung, fehlgeschlagene Prüfung mit erfolgreichem Retry, Fokus,
schmale Ansicht und echte Shell im vorhandenen Checkout ohne Agent/Kategorie.
TypeScript und Produktionsbuild grün. Log: `test-results/setup-electron.log`;
Driver ist in pnpm verify aufgenommen. Guide-Bild 25 stammt aus diesem Lauf.
Keine Provider-Inferenz und keine Änderung an der persönlichen ADE-Instanz.

## S2: Freigaben und Build-Stand

26 fokussierte Checks für Rechte, unbekannte/offline Zustände und Build-Herkunft.
Der erweiterte echte Electron-/HTTPS-Browserflow besteht mit 37 Checks insgesamt
(16 Desktop + 21 Mobile/Freigaben). Negative Kontrollen: fehlende Rechte,
abweichender/fehlender Build, fehlgeschlagene Statusantwort, Verbindungsverlust;
abschliessende positive Wiederherstellung erfolgreich. Die Tailscale-CLI und
Provider sind isolierte Fixtures; signierte Host-Aufrufe und Gerätefreigaben echt.
TypeScript und Produktionsbuild grün. Logs: `test-results/setup-s2-typecheck.log`,
`setup-s2-build.log`, `setup-s2-electron.log`. Neue Aufnahmen 25–27 im Guide.
Die Vollprüfung und Auslieferung sind in S3 dokumentiert; persönliche Rechte unverändert.

## S3: Gesamtprüfung und Auslieferung

Vollständiges `pnpm verify` am 11. September bestanden, Exit 0: **2.651 Checks**,
drei TypeScript-Projekte, 41 fokussierte Suiten/2.058 Checks, Produktionsbuild und
593 echte Electron-/Chromium-/Visual-Checks. Log: `test-results/onboarding-verify.log`.
Danach nur Dokumentation geändert. Guide und 65 Markdown-Dokumente abgeglichen;
222 relative Ziele gültig. Keine weitere Archivierung gültiger Verträge erforderlich.

Task-Commits: S0 `58abdfe`, S1 `cb442e5`, S2 `4288a32`; S3 hält diese Abnahme und
den Operator-Neustart fest. Die Task-Commits bilden eine gemeinsame Auslieferung
auf `main` mit normalem abschliessendem Push.
ADE läuft aus der festen geprüften Kopie `test-results/operator-release-4288a32`,
PID 51956, seit **11. September 2026, 06:49:59 Europe/Zurich**. Kein aktiver Run,
Task, Lease oder Terminal vor dem Ersetzen der alten PID 65456. Desktop sichtbar,
Listener ausschliesslich `127.0.0.1:4317`, privates HTTPS 200. Die ausgelieferten
Mobile-Dateien stimmen bytegenau mit dem verifizierten Build überein; PC und
Browser haben Quellkennung `3147fc1fa3170895ceab`. Geräte-/Freigabendatei und
Tailscale Serve unverändert. Nachweis: `test-results/onboarding-final-restart.json`.
Die ursprünglichen PNG-/Excel-/Markdown-Ergebnisdateien sind weiterhin lesbar;
kein erneuter Modelllauf. Details und getrennte Folgeabnahmen in HANDOFF.
