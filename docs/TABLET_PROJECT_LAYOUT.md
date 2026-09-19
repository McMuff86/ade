# Einklappbarer Projektbereich auf dem Tablet

19. September 2026: Der Projektkopf erhält „Projektbereich einklappen“ /
„Projektbereich einblenden“. Projektdetails, Bereichswahl und Branch-Verwaltung
geben ihren Platz an das bestehende Terminal ab. Projekttitel, Terminalstatus
und „Workspace-Info“ bleiben erreichbar; dessen Dialog gibt den Fokus an seinen
Auslöser zurück. Das Terminal wird durch das Einklappen nicht neu erzeugt.

Terminal/Git/Ergebnisse/Projekt-Einstellungen, Workspace-Aktualisierung und der
geschlossene Branch-Schalter teilen sich auf breiten Tablets eine Zeile. Auf
schmalen Geräten umbrechen sie; geöffnete Branch-Verwaltung nutzt die volle
Breite. Alle Schalter haben mindestens 44 Pixel Touch-Höhe.

Die lokale Darstellungspräferenz `ade-mobile-project-context-collapsed` bleibt
beim Neuladen erhalten. Fehlender Browser-Speicher verhindert keine Bedienung.
Eine noch unbestätigte Branch-Aktion übersteuert die Präferenz, damit ihre
Wiederaufnahme sichtbar bleibt. Fehler, Verbindungshinweise und Ladezustand
liegen ausserhalb des einklappbaren Bereichs. Enter/Leertaste schalten um,
`aria-expanded` und `aria-controls` beschreiben den Zustand; der Fokus bleibt
auf dem Schalter. Die bestehende Terminal-Vergrösserung und Bildschirmtastatur
blenden diesen Bereich weiterhin automatisch aus; im vergrösserten Terminal
führt „Workspace einblenden“ zur normalen Ansicht zurück.

Abnahme: `projectContextLayoutFlow` im bestehenden Driver
`scripts/test-remote-terminal-electron.ts --workspace-cli-only`, mit echter
Electron-Instanz, signiertem Browserzugriff und laufender Test-CLI. Prüft echte
Terminal-Höhenzunahme, Tastaturbedienung, Dialogfokus, Neuladen, breite/schmale
Tablets, Telefon, Branch-Verwaltung und fehlgeschlagenes Speichern. Screenshots
unter `test-results/remote/project-context-*.png`.

Die Änderung betrifft die Oberfläche. Geräteidentitäten, Schlüssel, Freigaben
und Tailscale-Adresse werden dadurch nicht geändert. Ein bestehendes Pairing
bleibt im selben Browser-/App-Speicher erhalten.

Der erste Gesamtlauf bestand alle 91 Kernsuiten / 3.780 Prüfungen, beide Builds
und unter anderem die reale Wiederverbindung nach Host-Neustart (12/0). Später
las `terminalHomeFlow` die Prozessliste unmittelbar nach dem Klick auf Start,
während noch die alte Terminalanzeige sichtbar war. Die bereits vorhandene
Wartebedingung auf die neue ausgewählte Sitzung wurde vor diese Abfrage gezogen;
der Test prüft weiterhin genau einen neuen Prozess und den Erhalt aller älteren.
Gezielte positive Kontrolle: 42/0. Der zweite Gesamtlauf fand dieselbe Lücke
beim Sitzungsende: Ein asynchrones Browser-Prädikat beendete die Wartefunktion
vor dem tatsächlichen ConPTY-Ende. Isolierte Nachstellung mit dem installierten
Playwright: `waitForFunction(async () => false)` liefert nach 24 ms bereits
`false`, statt bis zum Timeout zu warten. Die Abschlussprüfung wartet jetzt in
Node explizit auf jede IPC-Antwort und vergleicht denselben letzten Snapshot.
Keine Produktänderung für diese Testfehler.

Vollständiges `pnpm verify` am **19. September, 14:28 CEST**, Exit **0**:
alle drei TypeScript-Projekte, **91 Kernsuiten / 3.780 Prüfungen**, Desktop- und
Mobile-Build sowie alle **30 Electron-/Browser-Driver**. Terminal-Gesamtablauf
**208/0**, Projekt-/Layoutablauf **92/0**, Wiederverbindung nach echtem
Testinstanz-Neustart **12/0**. Native Windows-/Chromium-Abnahme.

Um **14:29 CEST** als `dist/tablet-layout-d92d312a262b7a36df9c` für den nächsten
Start vorbereitet. Die ADE-Startmenü-Verknüpfung zeigte auf diesen geprüften
gemeinsamen Build. Ihre bisherige Fassung liegt unter
`C:\Users\Adi.Muff\ADE-Backups\TabletLayout-20260919-142941`.

Für den weiterlaufenden Tablet-Zugriff blieb zunächst die bisherige Instanz **PID 47752**, Source
`9c76087fb515f3b8c16e`, weiter aktiv. Um 14:29 kein Host- oder Terminal-Neustart durchgeführt;
die Geräteablage mit **drei aktiven Kopplungen** ist bytegleich erhalten und
die private HTTPS-Adresse antwortet mit **200**. Automatischer PC-Standby war
bereits ausgeschaltet; die Energieeinstellungen wurden nicht geändert.

Um **21:31 CEST** nach Nutzermeldung des weiterhin alten Tablet-Builds aktiviert.
Diagnose: Die Instanz von 09:18 lieferte weiterhin `/assets/index-D9WTdYdh.js`;
`pnpm start` öffnete wegen der Profilsperre nur deren Fenster. Der vom Nutzer
erfolgreich um **21:22 CEST** erstellte Desktop-/Mobile-Build lag bereits vor,
mit derselben abgenommenen Source-ID **`d92d312a262b7a36df9c`**.

Keine aktiven Terminals oder verwalteten Aufgaben; alte Instanz regulär mit
**ADE und mobilen Zugriff beenden** geschlossen. Repository-Build im bisherigen
Profil gestartet, neue **PID 43796**. Private HTTPS-Antwort **200** und
ausgeliefertes `/assets/index-ByGfs_X1.js` per SHA-256 bytegleich mit dem neuen
Mobile-Build bestätigt. Alle **drei Kopplungen bytegleich**, Profile und Projekte
unverändert. Backup: `C:\Users\Adi.Muff\ADE-Backups\CurrentBuild-20260919-213134`.
Die Startmenü-Verknüpfung verwendet jetzt denselben Repository-Build wie
`pnpm start`, damit spätere lokale Builds auch dort gestartet werden.

Auf dem Tablet dieselbe Seite neu laden. Für spätere Updates erstellt
`pnpm build` Desktop und Mobile gemeinsam; eine bereits laufende ADE-Instanz
vor `pnpm start` vollständig im Tray beenden. Die Kopplung bleibt im bisherigen
Browser-/App-Speicher erhalten. Keine Produktcodeänderung bei dieser Aktivierung;
die vollständige Abnahme des identischen Quellstands gilt weiter.

Belege: `test-results/project-context-verify.log`,
`project-context-verify-exit.json`, `project-context-ready.json` und
`verification.json` im vorbereiteten Release sowie die aktuelle Aktivierung in
`test-results/current-build-activation.json`. Die beiden früheren Gesamtläufe
sind als `project-context-verify-first*` und `project-context-verify-second*`
erhalten. Der neue Host liefert die Oberfläche aus; die sichtbare Aktualisierung
auf dem physischen Tablet nach Neuladen ist noch vom Nutzer zu bestätigen.
