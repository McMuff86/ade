# Vorschlag nach dem Tablet-Shell-Fix

Stand 18. September 2026. Priorisierung aus Adis Tablet-Rückmeldung und dem aktuellen
Codex-Lieferstand. Adi hat inzwischen ausdrücklich beauftragt, nach geprüftem
Build und laufender ADE-Instanz mit den nächsten Schritten weiterzumachen.
Erster Stabilisierungsblock: Verbindungsabbrüche, Wiederaufnahme und klare
Sitzungszustände, anschliessend Workspace-Orientierung. Die Abnahme und Aktivierung
des Shell-/Git-Builds ist abgeschlossen: persönlich aktiviert am 18. September
um 00:17 CEST. Der anschliessende Stabilisierungsblock und die Workspace-Info
sind vollständig geprüft und seit 01:54 CEST persönlich aktiviert:
[Ergebnisse](TABLET_RECOVERY_RESULTS.md). Der danach hinzugekommene Sprachauftrag
ist ebenfalls vollständig geprüft und seit **03:25 CEST** aktiviert, einschliesslich
zweier zusätzlicher Korrekturen für Terminalaktionen bei gleichzeitigem Heartbeat:
[Eleven v3 und Adi](ELEVEN_V3_RESULTS.md).

## 1. Dringend: den tatsächlichen Tablet-Alltag abnehmen

Den vorhandenen Chromium-Test um einen dokumentierten Durchlauf auf dem Samsung
ergänzen: tippen ohne Enter, Umlaute, Wortkorrektur, lange Befehle, Cursorbewegung,
Einfügen, Hoch-/Querformat, Tastatur schliessen/öffnen und Shell beenden/neu öffnen.
Danach Bildschirm sperren, Browser wechseln und Verbindung kurz unterbrechen.
Erfolg: sichtbare Eingabe am Cursor, eindeutiger Eingabebesitz nach Wiederkehr,
keine verlorenen Entwürfe oder automatisch doppelt gesendeten Befehle.
Die neuen automatisierten Nachweise ersetzen diese Geräteprüfung nicht.
Beim zusätzlich beauftragten Eleven-v3-Wechsel gehört eine kurze Hörabnahme
dazu: Sarah soll Adi mit kurzem A aussprechen; Begrüssung und Vorlesen prüfen,
anschliessend Abbruch und erneute bewusste Wiedergabe. Die Aussprachevorgabe ist
technisch prüfbar, ihre gewünschte Betonung muss Adi selbst bestätigen.

## 2. Wichtig: einen vollständigen Codex-Auftrag im Alltag durchspielen

Der zusammenhängende automatisierte Nachweis ist jetzt ergänzt: **16/0** mit
echtem Codex, signiertem Chromium-Browser, Produktionsqueue/Workspace-Zuteilung,
verlorener Bestätigung, Offline-Wiederkehr, Rückfrage/Dateiergebnis und echtem
Neustart nach Abschluss. Dabei wurde eine Änderung von `AGENTS.md` beim Start
gefunden und behoben; Profil/Memory werden direkt als Kontext übergeben.
Die Gesamtabnahme dieser Korrektur ist bestanden; sie ist seit **04:15 CEST**
aktiviert, Source `5cf7ef2ca9b2b4a1ad54`.
[Nachweise](TABLET_CODEX_NATIVE_RESULTS.md). Offen bleibt der folgende physische
Bediennachweis auf Adis Samsung.

Im bestehenden isolierten Testprojekt vom Tablet aus einen Auftrag vorschlagen,
bestätigen, eine native Rückfrage beantworten, Ergebnis und Git-Diff prüfen und
die Arbeit bewusst abschliessen. Anschliessend Reload/Verbindungswechsel und
kontrollierten ADE-Neustart durchspielen. Bestehende Queue-, Idempotenz- und
Resume-Verträge haben bereits Einzel- und Integrationsnachweise; das nächste
Ziel ist ein zusammenhängender physischer Bediennachweis mit tatsächlicher CLI.
Erfolg: genau ein Auftrag, korrektes Projekt, erhaltener Verlauf und ein klarer
Hinweis, ob Arbeit noch läuft, unterbrochen wurde oder fortgesetzt werden kann.

## Bereits im Folgeblock: Projekt- und Sitzungszustand klarer zeigen

Projekt, Branch und Workspace-Art sind über „Workspace-Info“ erreichbar. Der
vollständige Workspace-Stammordner lässt sich am PC aufklappen. Das aktuelle
Shell-Verzeichnis wird noch nicht gesondert verfolgt; relative Unterordner sind
ein späterer Ausbau. Die heutige Maskierung schützt die Host-Grenze und darf nicht
für einen Darstellungsumschalter aufgehoben werden. Ebenso „Ansicht schliessen“
und „Prozess beenden“ durchgehend gleich benennen. Der neue Shell-Abschluss und
die letzten fünf Commits sind die ersten Verbesserungen dafür.

## 3. Nächste Entwicklung: Updates und Wiederanlauf vereinfachen

Den derzeit manuellen Ablauf aus geprüftem Release, Profilsicherung, regulärem
Beenden, Start und Bestätigung des tatsächlich ausgelieferten Tablet-Bundles
als verständlichen Update-Ablauf anbieten. Vorhandene Build-Identität und
Versionshinweise weiterverwenden. Erfolg: PC und Tablet zeigen denselben Stand,
Kopplung bleibt erhalten, Rückkehr zum letzten funktionierenden Build ist klar.

Weitere Anbieter, mehr Autonomie, Unteragenten und zusätzliche Sprachfunktionen
folgen gemäss Roadmap nach dem stabilen Codex-Tablet-Ablauf. Der explizit beauftragte
v3-Wechsel wird bereits separat geliefert. Die weiteren Ausbaustufen erhöhen die Zahl der
gleichzeitig zu prüfenden Varianten, bevor die häufigste Bedienung abgenommen ist.
