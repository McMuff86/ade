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
- Vollständiges `pnpm verify` und finale Zahlen: ausstehend.

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

Der anschliessende UX-Vorschlag steht separat in
[Goal 33 — Sprachdialog](VOICE_COMPANION_PROPOSAL.md).
