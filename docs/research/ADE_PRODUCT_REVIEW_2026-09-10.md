# ADE: nächster Schritt nach dem Projektablauf

Stand: 10. September 2026. Codebasis: T7 `b2ca131`; ergänzende T6-Abnahme in
[STATUS](../STATUS.md). Dies aktualisiert die [Recherche vom 9. September](ADE_PRODUCT_REVIEW_2026-09-09.md).
Umsetzung und vorgeschlagene Folgearbeit bleiben getrennt.

## Was sich seit der ersten Recherche geändert hat

Der Weg Projekt-Stamm → Checkout/Branch → optionale Profilwahl → CLI → Git ist
auf Desktop und Tablet verbunden. Neue Projekte brauchen kein Profil. Git bietet
selektive Commits, Merge/Konfliktauflösung, Fetch/Fast-forward sowie bewusstes
Pushen und GitHub-PRs mit Zielvorschau. Belege stehen pro Task im
[Projekt-Goal](../PROJECT_WORKFLOW_GOALS.md); GitHub wird im Test über einen
kontrollierten Provider geprüft, ohne externen Test-PR.

Graph zeigt Prozessaktivität, Abschlussantwort und nun direkt die Run-Dateien.
Projekt → Ergebnisse öffnet dieselben Aufgaben-Arbeitskopien. Vorher-/Nachher-
Hashes unterscheiden neue, veränderte und gelöschte Dateien; Alt-Runs bleiben
unbekannt oder nur vom Agenten gemeldet. PNG-Vorschau sowie bytegleiche Bild- und
Tabellendownloads sind mit echter PTY und Chromium geprüft. Es gibt weiterhin
kein dauerhaftes Dateiarchiv unabhängig vom Workspace.

## Empfohlene Reihenfolge

| Priorität | Konkreter nächster Schritt | Abnahme |
|---|---|---|
| 1 | Geführte Ersteinrichtung: Stammordner, CLI-Anmeldung, Tablet-Kopplung und nötige Freigaben zusammenführen | Ein neuer Benutzer öffnet ein vorhandenes Projekt und startet eine CLI ohne Kenntnis von Agents/Worktrees; fehlende Rechte nennen genau den nächsten Schritt |
| 2 | Samsung Chrome systematisch prüfen: normale Tastatur, DeX, externe Tastatur, Hoch-/Querformat, Hintergrund und Reconnect | Zeichen erscheinen unmittelbar, Cursor bleibt sichtbar, Fokus löst die Tastatur aus; keine doppelte Eingabe nach Wiederverbindung. Messung mit realem Gerät separat von simulierter Geometrie |
| 3 | Ergebnisse dauerhaft halten und grosse Listen blättern | Ein bewusst archiviertes Ergebnis bleibt nach Entfernen des Task-Workspaces herunterladbar, mit Hash/Grösse/Retention und klarer Anzeige historischer gegenüber aktueller Datei |
| 4 | WSL-Verfügbarkeit und Lebenszyklus untersuchen | Bereitschaftsprobe, CLI-Start/Ende, Reconnect und native WSL-Dateizugriffe bestehen in einem eigens ausgewiesenen Windows→WSL-Test; kein stiller Ersatz durch Windows |
| 5 | Mobile zeigt Host-/Build-Stand, konsistente Begriffe und verständliche Updatehinweise | Benutzer erkennt einen alten Host, benötigt keinen Cache-Ratversuch und findet Projekte, Terminal, Git und Ergebnisse per Tastatur und Touch |

Die WSL-Probe `/bin/true` erreichte auch am 10. September nach 15 Sekunden keinen
Abschluss. Daraus lässt sich keine konkrete WSL-Ursache ableiten. Der Probeprozess
wurde beendet; Distribution und laufende persönliche Assistenten wurden nicht
neu gestartet. Diese Untersuchung ist ein eigener Folgeschritt.

## Recherche, die die Priorisierung stützt

Chrome auf Android verkleinert bei Bildschirmtastatur standardmässig den sichtbaren
Viewport; die Layoutfläche muss dabei nicht schrumpfen. Deshalb sind reine
Desktop-Grössenänderungen kein vollständiger Ersatz für einen physischen
Tastaturtest. ADEs VisualViewport-Behandlung und die Testmatrix sollten zusammen
beurteilt werden. Das ist unsere Ableitung aus der
[Chrome-Dokumentation zum Tastatur-Viewport](https://developer.chrome.com/blog/viewport-resize-behavior).

Tailscales Android-Ausschlüsse verändern Routing und DNS der betroffenen App.
Eine verbundene Tailscale-App allein beweist daher nicht, dass Chrome denselben
Weg verwendet. Der Verbindungsleitfaden soll PC-Erreichbarkeit, Browserroute und
ADE-Berechtigung getrennt prüfen. Grundlage:
[Tailscale: App-basiertes Split-Tunneling](https://tailscale.com/docs/features/client/android-app-split-tunneling).

## Grenzen dieser Untersuchung

Geprüft wurden der lokale Produktionscode, isolierte Git-/PTY-/Browserabläufe,
Dokumentation und die beschriebenen Nutzerbeobachtungen. Die Screenshots sind
echte ADE-Aufnahmen mit Demodaten. Eine vollständige Samsung-Messung, echte
Providerantworten für jedes Modell, Live-GitHub-PRs und eine neue Linux-/macOS-
Abnahme sind damit nicht belegt. Die genannten Folgeschritte sind Vorschläge
für die nächste Besprechung, keine bereits beauftragte Erweiterung.
