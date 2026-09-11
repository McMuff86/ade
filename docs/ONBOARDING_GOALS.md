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
| S1 | Desktop-Einrichtung verbindet Projektordner, native CLI-/Anmeldeprüfung, optionale Kopplung und Gerätefreigaben. Kein erzwungener Agent. Laden/Fehler/erneute Prüfung, Tastatur/Fokus, echte Electron-Prüfung | offen |
| S2 | Mobile-Einrichtungsstatus zeigt konkrete fehlende Rechte und nächste Schritte; Host-/Browser-Builds unterscheidbar, unbekannte/veraltete/offline Zustände ehrlich. Keine automatischen Mutationen oder Seitenneuladungen; signierter Zugriff und Browserprüfung | offen |
| S3 | Guide mit echten neuen Aufnahmen, Verträge/Status/Handoff synchron; vollständiges pnpm verify. Commit je Task, gemeinsamer Push und geprüfter ADE-Neustart unter Erhalt von Kopplung/Routen | offen |

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
