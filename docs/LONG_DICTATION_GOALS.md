# Goal 32 — Fünf Minuten Live-Diktat abschliessen

Auftrag vom 16. September 2026: gespeicherte Tablet-Arbeit fertigstellen,
Startfristfehler beheben, vollständig prüfen, committen, bauen und persönlich
aktivieren. Ein Arbeits-Goal begleitet alle Schritte bis zum Neustart.

## Goal 32.1 — Aufnahmezeit und Abschluss

Implementiert: gemeinsamer 300-Sekunden-Vertrag für Desktop und Tablet,
4.800.000 Samples, 9.600.000 PCM-Bytes, maximal 1.172 Audiopakete. Bestätigte
Abschnitte bleiben erhalten; Stop wartet auf alle ausstehenden Bestätigungen.
Verbrauch und Journal erhalten die gemessene Dauer. Batch bleibt bei 60 Sekunden.

Mikrofonfreigabe und Worklet-Modul werden vor dem Provideraufbau vorbereitet.
Erst nach dessen Bereitschaft wird der Audiograph verbunden. Abbruch gibt auch
spät gelieferte Mikrofonspuren frei. Eine veraltete Startantwort kann eine neu
gestartete Aufnahme nicht abbrechen. Ohne Audio endet die Providerverbindung
nach 30 Sekunden. Das erste gültige Paket startet die feste 305-Sekunden-Frist;
weitere Pakete können sie nicht verlängern. Das Ticket berücksichtigt Aufbau,
Startfenster, Aufnahme und Abschluss. Keine zusätzlichen IPC-/Remote-Kanäle.

## Goal 32.2 — Nachweise

- Live-Vertrag: **79 Checks bestanden**, einschliesslich 20 Sekunden verzögertem
  Audio-Start und anschliessend genau 300 Sekunden Audio, 15 bestätigten
  Abschnitten, Leerlaufabbruch und nicht verlängerbarer Frist.
- Remote-Diktat **47**, Sprachverbrauch **36**, Verbrauchsjournal **35** und
  Aufnahmetickets **21 Checks** bestanden. Drei TypeScript-Projekte und alle
  **72 Fachsuiten / 3.115 Checks** sind positiv; Produktionsbuild bestanden.
- Die ursprüngliche negative Auditprobe lieferte nach derselben Verzögerung
  nur 285 Sekunden Audio. Sie bleibt unter
  `test-results/dictation-limit-audit-start-delay.json` erhalten.
- Browserregression: **64 Checks bestanden** mit echter Electron-/Chromium-
  Mikrofonpipeline, simuliertem Mikrofon und Provider. Verzögerte Freigabe auf
  Desktop und Tablet, Abbruch vor Provideröffnung, **65,472** beziehungsweise
  **61,08 Sekunden** gemessenes PCM, bestätigte Entwürfe und positive
  Schlusskontrolle nach Verbindungsverlust und Abbruch.
- Die neue Browser-Fixture benötigte zuerst eine Korrektur ihrer serialisierten
  Callback-Funktion (`__name` ausserhalb des Testprozesses nicht verfügbar).
  Danach fiel eine sofortige Fokusprüfung beim Sitzungswechsel auf; sie wartet
  jetzt auf den tatsächlich gesetzten Fokus nach dem nächsten Bildaufbau.
  Die positive vollständige Wiederholung enthält alle ursprünglichen Prüfungen.
- Vollständiges `pnpm verify` bestanden; endgültige Zahlen und Quellenabgrenzung unten.

Die erste Gesamtprüfung bestand alle Fachsuiten und Diktat-Flows, scheiterte
danach im allgemeinen Remote-Terminal-Test beim Bestätigen von „Sitzung beenden“.
Eine laufende Hintergrundanfrage konnte den Transport sperren, obwohl die
Bestätigung anklickbar blieb; der Dialog schloss ohne Befehl. Die Bestätigung
wartet jetzt sichtbar, mit derselben Sperre wie die übrigen Terminalaktionen und
einer synchronen Prüfung vor dem Schliessen. Ein gezielt angehaltener Heartbeat
prüft diesen Ablauf: Der alte Build scheitert ausschliesslich an der vorgesehenen
Negativkontrolle (**58 bestanden / 1 fehlgeschlagen**); beide normalen
Schliessabläufe schliessen im Test danach ab. Mit der Korrektur besteht derselbe
Test mit **59 Checks / 0 Fehlern**, einschliesslich beider Schliessabläufe.
Logs: `test-results/terminal-close-heartbeat-{negative,positive}.log`.
Die Gesamtprüfung wird mit dem korrigierten Build wiederholt.

Die zweite Gesamtprüfung bestand auch den allgemeinen Remote-Terminal-Ablauf
mit **208 Checks**, scheiterte danach aber an der Kopierprüfung im Desktop-
Workspace. Die verwendete xterm-Version kann beim erneuten Auswählen desselben
Suchtreffers ein Löschereignis ohne abschliessendes Auswahlereignis melden.
Dadurch blieb „Kopieren“ trotz vorhandenem Treffer deaktiviert. ADE gleicht den
Buttonzustand jetzt nach jeder Suche ausdrücklich mit der tatsächlichen Auswahl
ab. Der Test wählt vor dem Kopieren erneut aus und behandelt ein zwischenzeitliches
Resize mit einer begrenzten Wiederholung der gesamten Auswahl-/Kopieraktion;
der exakte Zwischenablageinhalt bleibt Pflicht. Eine Fehleraufnahme sichert
Auswahl, Suchtext und Buttonzustand. Die gezielte positive Abnahme besteht mit
**73 Checks / 0 Fehlern** (`test-results/workspace-copy-positive.log`).
Die bisher nicht erreichten Schlussabschnitte sind vorab ebenfalls positiv:
Projekt-Git, Terminal-Latenz, Projektveröffentlichung, Einrichtung und visuelle
Regression (`test-results/long-dictation-tail-*.log`). Der dritte vollständige
Prüflauf wurde auf den neuen ASAP-Wunsch des Operators vorzeitig beendet,
um den tatsächlichen Computer-Live-Test zuerst fertigzustellen. Keine positive
Gesamtabnahme daraus ableiten. Sie wird über den erweiterten Stand wiederholt.

Physisches Tablet, echte kostenpflichtige ElevenLabs-Daueraufnahme und andere
native Betriebssysteme werden durch diese Automatisierung nicht abgenommen.

## Goal 32.3 — Aktivierung

Auf ausdrücklichen ASAP-Wunsch: zuerst gezielt geprüfte Vorschau mit Goal 33.0
aktivieren und den Operator live testen lassen; Gesamtabnahme anschliessend.
Codecommit, Build aus diesem Commit, unveränderter
Releaseordner, isolierter Start, gesicherte persönliche Konfiguration, sauberer
ADE-Neustart und Nachweis der geladenen Desktop-/Tablet-Artefakte. Der bisherige
Release bleibt als Rückfall verfügbar. **Vorschau aktiviert am 16. September
2026 um 11:46 CEST**, zusammen mit dem Computer-Test in Codecommit **07e8ae4**,
Source-ID **e55be38907bc873ec7ba**. Isolierter Start und persönliche Aktivierung
bestanden; aktuelles Tablet-Bundle über HTTPS bytegleich bestätigt. 6 Profile,
4 Projekte und 1 Gerät erhalten. Vollständige Gesamtabnahme läuft noch.
Der Computer-Hotfix **06cd6ea** ersetzt diese Vorschau seit **11:57 CEST**,
Source-ID **d2260ccf00b102a2e736**; persönlicher und isolierter Start erneut
bestanden. Die Gesamtprüfung wurde wegen der physischen Tablet-Rückmeldung
unterbrochen und danach erfolgreich abgeschlossen; Einzelheiten unten.

Der anschliessende UX-Vorschlag steht separat in
[Goal 33 — Sprachdialog](VOICE_COMPANION_PROPOSAL.md).

## Endabnahme — 16. September 2026, 12:27 CEST

`pnpm verify` vollständig mit **Exit 0** abgeschlossen:
alle drei TypeScript-Projekte, **72 Fachsuiten / 3’123 Checks**, Produktionsbuild
und sämtliche vorgesehenen Electron-, Browser- und visuellen Prüfungen.
Besonders relevant: Diktat **64/0**, Computer **18/0**, allgemeines Remote-Terminal
**208/0**, Workspace-CLI **73/0**, finale visuelle Prüfung **22/0**.
Gemessenes PCM: Desktop **63,352 s**, Tablet **61,08 s**. Die vollen 300 Sekunden
und die verzögerte Startfrist sind zusätzlich durch die 79 Live-Vertragschecks
mit kontrollierter Uhr abgedeckt.

Während dieses Laufs änderte eine zweite Sitzung die Begrüssung und TTS-
Stimmparameter. Die anfänglichen Fachsuiten enthalten noch 46 Sprachchecks;
Build und Computer-UI bereits die parallele Abstimmung. Deshalb wurden danach
alle drei TypeScript-Projekte und die erweiterten **55 Sprachverträge** erneut
positiv geprüft. Der geprüfte gemeinsame Build hat Source-ID
**9d2ad0abc6c9b97a1d29**. Der separat aktivierte Hotfix **06cd6ea** hat Source-ID
**d2260ccf00b102a2e736** und bestand vor Aktivierung seine eigenen **16/0**
Computer-Checks sowie den isolierten Start. Die neuere Stimmabstimmung gehört
zur anderen Sitzung und wurde in diesem Auftrag nicht aktiviert.

Nachweise: `test-results/long-dictation-verify-final.log`,
`test-results/long-dictation-verify-exit.json`,
`test-results/long-dictation-verified-source.json`,
`test-results/goal32-current-{typecheck,speech}.log` und
`test-results/goal32-final-audio.json`. Der separate Lauf der anderen Sitzung
(`computer-voice-verify.log`) scheiterte an einer unmittelbaren Fokusprüfung;
er wird nicht als positive Gesamtabnahme verwendet. Derselbe Diktatablauf
bestand im hier genannten vollständigen Lauf mit 64/0.

Der physische Tablet-Test lieferte den dokumentierten Fehlerbericht zum ersten
Computer-Build. Eine ausdrückliche Hörbestätigung des Operators nach dem Hotfix
liegt in diesem Thread noch nicht vor. Fixtures verwenden simuliertes Mikrofon
und Provider; keine zusätzliche Plattform- oder Klangzusage daraus ableiten.
