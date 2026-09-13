# Übernahme älterer Änderungen und Agent-Obergruppen

Abgeschlossenes Ziel vom 13. September 2026. Auftrag: den Vorschlag aus
`FASTENER_INTEGRATION_REVIEW.md` implementieren, prüfen, committen, pushen und
ADE anschliessend mit genau einer geprüften Instanz neu starten.

## Teilziele und Abnahme

- [x] ADE: Quelle und Ziel einer Übernahme prüfen, eigene Commits und lokale
  Dateien sichern, in einer separaten Integrations-Arbeitskopie vorbereiten,
  Konflikte und Tests anzeigen und eine geprüfte Übernahme ausdrücklich bestätigen.
  Desktop und Mobile verwenden denselben Main-Service und Prüfbericht.
- [x] ADE: optionale Obergruppe über bestehenden Kategorien, Bearbeitung auf
  Desktop und Mobile, Suche, gespeicherte Auf-/Zuklapp-Auswahl und portable Daten.
- [x] ADE: abgeschlossene Runs auch auf Mobile mit Bestätigung löschen;
  dauerhafte Wiederholung nach Antwortverlust, geschützte Leases/Veröffentlichungen.
- [x] RhinoLayoutTools: FastenerPlace-Palette auf aktuellem Hauptstand mit
  `rlt_ui`, Silhouetten, korrektem Normwechsel und erhaltener Bohrungswahl;
  fokussierte Prüfungen und echte Rhino-Abnahme.
- [x] Beide Repositories: Dokumentation und vollständige vorgeschriebene Checks;
  Task-Änderungen committen und nach `origin` pushen.
- [x] Persönliches Profil: Hermes Agent, OpenClaw und GrokBuild unter der
  Obergruppe **Agent-Systeme** ordnen; Identitäten, Workspaces und Kopplung erhalten.
- [x] Alle ADE-Instanzen schliessen, genau eine geprüfte Instanz neu starten und
  private mobile HTTPS-Auslieferung kontrollieren.

## Abnahme vom 13. September 2026

Vollständiges `pnpm verify` besteht mit **3.018 Checks**: 48 fokussierte Suiten
(2.329 Checks), 14 echte Electron-/Browser-Abläufe (689 Checks), beide
Produktionsbuilds und alle drei TypeScript-Projekte. Der reale gemeinsame
Terminal-/Obergruppen-/Übernahmelauf besteht mit 190 Checks. Belege:
`test-results/integration-final-verify.log` und `integration-final-results.json`.
Quellfingerabdruck des geprüften Builds: `ede490ffbd9f434df6e8`.
ADE-Code-Commit `bab7df78f79dd1c5ff1ca7dc97b27fd4cf812705` und Rhino-Commit
`5c4b820a6d83bf645db6e8087c17228a458bef37` sind jeweils auf `origin/main` bestätigt.

Seit **12:48 Uhr Europe/Zurich** läuft genau eine persönliche ADE-Instanz,
PID **53592**, aus `test-results/operator-integration-20260913-124809-01333ede-verified`.
Der vorherige Hauptprozess 35068 wurde geschlossen; keine Aufgaben waren aktiv.
Hermes Agent, OpenClaw und GrokBuild tragen jetzt **Agent-Systeme** als Obergruppe.
Alle anderen Konfigurationsfelder, sechs Agenten, fünf Projekte und die
Gerätekopplung blieben erhalten. Backup:
`test-results/operator-integration-backup-20260913-124809`.
Der private HTTPS-Zugang liefert Status 200; die ausgelieferten JS-/CSS-Dateien
stimmen per SHA-256 mit der geprüften Kopie überein. Der Mobile-Listener bleibt
auf `127.0.0.1:4317`. Beleg: `test-results/integration-restart.json`.
Dieser Abschluss ersetzt die folgenden historischen Zwischenstände.

## Entwicklung und Zwischenabnahmen (historisch)

Obergruppen sind als optionales `Category.navigationGroup` mit genau einer
zusätzlichen Navigationsebene implementiert. Namensgleiche Obergruppen werden
gemeinsam angezeigt, positioniert bei ihrer ersten Kategorie. Graph-Rollen,
Projekt-Defaults und Agent-Mitgliedschaften erhalten keine neue Vererbung.
Der mobile Katalog projiziert Kategorienzugehörigkeit und Gruppennamen nur nach
der bestehenden Ressourcenfilterung. Die dedizierte Verwaltungsoperation
`category-group` verlangt vollständige Katalogfreigabe, `catalog:write`,
Gerätebeweis und Idempotenz; die generische IPC-Remote-Allowlist bleibt unverändert.

23 fokussierte Prüfungen bestanden; TypeScript und Produktionsbuild bestanden.
Die reale Desktop-/Mobile-Bedienungsprüfung besteht mit 14 Checks (einschliesslich
zwei gemeinsamer Setup-Prüfungen). Noch keine persönliche
Konfiguration geändert, kein neuer ADE-Commit/Push oder ADE-Neustart erfolgt.
Die persönliche Einrichtung und der ADE-Abschluss sind noch offen. Logs im ignorierten Verzeichnis `test-results`:
`category-navigation-focused.log`, `navigation-typecheck.log`,
`navigation-build.log`, `category-navigation-electron.log`.

RhinoLayoutTools: In der separaten Arbeitskopie
`C:/Users/Adi.Muff/repos/.ade-worktrees/rhinolayouttools-fastener-integration`
auf Branch `ade/fastener-palette-integration` ist die Palette fertig portiert.
Rhino 8 und Rhino 9 WIP bestehen jeweils 13 echte Paletten-/Platzierungsprüfungen
und 110 vorhandene Fastener-Prüfungen. Alle 14 CI-Befehlsgruppen bestanden.
Die eigenen Rhino-Testinstanzen sind beendet. Die Portierung ist als
`5c4b820a6d83bf645db6e8087c17228a458bef37` in `RhinoLayoutTools/main`
per Fast-forward integriert und nach `origin/main` gepusht. Lokaler und
entfernter HEAD sind identisch, der Hauptworkspace ist sauber. Der alte
Quell-Workspace samt lokalen Agent-Anweisungen ist unverändert.

## Implementierter Übernahme-Service

Die Verträge in `src/shared/remote.ts` (`Integration*`) und
`src/shared/integrationRequests.ts` sind über Desktop-IPC und dedizierte mobile
Routes verdrahtet. `IntegrationService`, `IntegrationAnalysis`, `IntegrationGit`,
`IntegrationRecords` und `IntegrationChecks` implementieren Sicherung,
Drei-Wege-Merge, persistente Berichte, feste Testrezepte und geprüfte Übernahme.
Die gemeinsame `IntegrationReview`-Oberfläche ist aus Desktop-/Mobile-Git-Abgleich
erreichbar. 13 reale Electron-/HTTPS-Browser-Checks bestehen einschliesslich
Textvergleich, Arbeitskopie öffnen, verlorener Antwort, Reload, gleichen
Idempotenzschlüsseln, echten Projekttests, Smartphone-Breite und Übernahme.
Die fokussierte Git-/API-Suite besteht mit 53 Checks einschliesslich
Wiederanlauf-Negativkontrollen und verwalteten Workspace-Leases.
Typprüfung und Build bestehen; 229 Sicherheitschecks bestanden. Die Draftsuite
enthält jetzt 46 Checks einschliesslich der dauerhaften Run-Löschbestätigung.
[Bedienung und vollständiger Vertrag](WORKSPACE_INTEGRATION.md).

Die vollständige ADE-Abnahme vor der letzten Mobile-Löschergänzung bestand:
47 fokussierte Suiten mit 2.304 Checks und sämtliche realen Electron-/Browser-
Abläufe (`integration-pre-deletion-verify.log`). Die finale Übernahmeprüfung
enthält zusätzlich zwei Guards gegen unbeabsichtigtes Absenden des umgebenden
Graph-Run-Formulars. Die neue Löschsuite besteht mit 23 Checks; die reale
Mobile-Electron-Suite besteht mit 36 Checks, davon sieben zum Löschen und zur
Wiederherstellung bei Antwortverlust (`run-deletion-focused.log`,
`run-deletion-mobile.log`). Der abschliessende vollständige Lauf inklusive
Löschung schreibt nach `integration-final-verify.log`.

Ein Zwischenlauf wurde bei der zweiten mobilen Gruppenzuweisung angehalten:
die Verwaltungsanfrage war unbestätigt und die Oberfläche bot ihre Wiederholung
an (`integration-unconfirmed-navigation-verify.log`). Der Browser-Treiber wartet
jetzt vor dem nächsten Speichern auf die HTTP-Bestätigung und meldet bei einem
Fehler Status/Code sowie begrenzte Fixture-Diagnosen. Der vollständige
Terminal-/Obergruppen-/Übernahmelauf besteht danach mit 190 Checks
(`terminal-navigation-diagnostic.log`). Daraus wird keine unbewiesene Ursache
des vorherigen Antwortverlusts abgeleitet; die abschliessende Gesamtabnahme
wird mit diesem Treiber wiederholt.

Umgesetzter Service-Vertrag:

- Quelle aus bestehenden nativen Agent-/Projekt-Workspaces des gewählten Repos;
  Ziel ist der aktuell ausgecheckte Branch des Hauptrepositories. Vergleich
  gegenüber gemeinsamer Git-Basis, getrennte Kennzeichnung lokaler Änderungen.
- Vorschau enthält höchstens 200 Dateien; pro Datei begrenzte, linkfreie Lektüre.
  Bereits identische Dateien, direkte Änderungen und beidseitig veränderte Dateien
  getrennt kennzeichnen. ADE-Rollen-/Memory-Dateien standardmässig abwählen und
  erklären. Keine semantische KI-Bewertung behaupten.
- Bestätigung prüft Vorschauinhaber, Quell-/Zielidentität, Datei-Fingerprints,
  Belegung und Gerätefreigabe erneut. Ausgewählte Quell-Dateiversionen werden
  über einen eigenen temporären Git-Index gesichert; Quell-Index und Quell-Dateien
  bleiben unverändert. Ein ADE-Snapshot-Commit auf gemeinsamer Basis enthält nur
  die ausgewählte Änderung und wird durch eine interne Referenz gehalten.
- Neue Arbeitskopie auf dem Zielstand unter einem generierten Integration-Branch
  anlegen; dort mit Drei-Wege-Merge vorbereiten. Konflikte verbleiben in dieser
  Arbeitskopie. Als `ProjectWorkspace` registrieren, damit vorhandene Datei-,
  Konflikt- und Terminalansichten zur Anpassung nutzbar sind.
- Bounded persistente Review-Datensätze im ADE-Profil; keine Hostpfade auf dem
  Wire. Bericht/Dateien/Tests müssen nach Reload und Host-Neustart wieder auffindbar
  sein; unterbrochene Vorbereitungen/Prüfungen ausdrücklich ausweisen.
- Projektprüfungen aus festen, erkannten Rezepten starten (z. B. `pnpm verify`
  bzw. die vorhandenen Python-Prüfungen); keine frei übermittelten Shell-Befehle.
  Ergebnis an den geprüften Dateistand binden. Fehlende Projektprüfungen oder
  zusätzlich nötige Rhino-Liveprüfungen ausdrücklich anzeigen.
- Übernahme benötigt erfolgreiches Prüfergebnis, konfliktfreien unveränderten
  Review-Stand, weiterhin passende Quell-/Zielbasis und explizite Bestätigung.
  Erst dann Integrations-Commit und Fast-forward des sauberen Hauptworkspaces.
  Nichts automatisch zurücksetzen; abgebrochene Übernahmen bleiben prüfbar.
- Dedizierte Desktop-IPC-Channels klassifizieren; mobile Routes nur über
  `AdeApplicationService`, mit aktueller vollständiger Ressourcenauswahl,
  `repositories:write`/entsprechender Test-Startfreigabe, Gerätebeweis, Idempotenz
  und Audit. Generische Remote-IPC-Allowlist bleibt unverändert.

Die vollständige Gesamtabnahme ist bestanden; die bestehende visuelle Suite
besteht mit 22 Checks. Commit/Push, persönlicher Neustart und Kontrolle der
privaten Auslieferung sind im Abschluss oben bestätigt.
RhinoLayoutTools ist bereits auf `main` integriert und gepusht.
