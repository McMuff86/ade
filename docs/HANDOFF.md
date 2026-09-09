# ADE — aktuelle Übergabe

## Aktuelle Priorität: Run-Ergebnis auf dem Tablet (2026-09-10)

Der Nutzer hat während T3b zuerst Graph-Aktivität, Ergebnis-/Bildzugriff und einen
Neustart verlangt. Diese Änderung ist separat geprüft: 31 native Grenztests,
12 echte Electron/Chromium-Checks mit deterministischer CLI in einer echten PTY,
drei TypeScript-Projekte und Produktionsbuild. Aktuelle Logs/Screenshots stehen
in STATUS und im Guide. Keine allgemeine Provider-/WSL-Freigabe daraus ableiten.

T3a ist mit `201ab29` abgeschlossen. Unfertiges T3b wurde vorher mit
`T3b in progress before requested graph activity patch` gestasht. Nach dem separaten
Ergebnis-Commit den genauen Stash anwenden, Konflikte mit den neuen Run-Verträgen
auflösen und erst nach geprüfter Wiederherstellung entfernen. T3b–T6 sowie der
abschliessende Push bleiben offen. Die folgenden älteren Betriebsnotizen beschreiben
frühere Checkpoints; der neue Neustart wird unten separat protokolliert.

Der angefragte Main-Chef/Codex-Native-Run `0531376b-559a-49f7-8d98-02d14573b109`
endete am 10.09.2026 um 00:06:17 mit Exit 0. Seine Dateien liegen im ursprünglichen
Agent-Worktree unter `workspace-demo/`: imagegen-test.png, test.xlsx, test.md.
Die alte unstrukturierte CLI hat keine Abschlussantwort in ADE gespeichert. Die
passende lokale Codex-Sitzung wurde anhand Task/Session/Workspace identifiziert;
beim genehmigten Neustart darf ausschließlich deren Abschlussantwort für genau
Task `9c816cef-783d-403c-ba1b-a9354e0506b1` als `recovered-cli` übernommen werden.
Die Antwort weist ehrlich darauf hin, dass der explizite gpt-image-2-API-Aufruf
an insufficient_quota scheiterte und das integrierte Bildwerkzeug seine genaue
Modellversion nicht nannte. Keine nachträgliche Bestätigung des verlangten Modells.

Stand: 2026-09-09. Diese Datei beschreibt den aktuellen Auftrag und Betriebsstand.
Die vollständige bisherige Übergabe ist im [Archiv](archived/HANDOFF_2026-09-09.md)
erhalten. Deren wiederholte „Nächster Schritt“-Abschnitte sind historische Notizen.

## Aktueller Auftrag

Der Nutzer hat den [projektzentrierten Ablauf als Goal](PROJECT_WORKFLOW_GOALS.md)
beauftragt: Projekte entdecken, ohne verpflichtendes Profil einen Branch und eine
CLI wählen, anschliessend Git-Aktionen ausführen. CLI- und Shell-Zustand müssen
getrennt angezeigt werden. Nach jedem abgeschlossenen Task folgt ein Commit;
gepusht wird erst am Schluss. Der frühere Research-/Guide-Auftrag ist abgeschlossen.

T0/T1/T2a/T2b sind umgesetzt. Die neue Projektübersicht öffnet vorhandene native
Checkouts unabhängig vom Agent-Katalog und zeigt den tatsächlichen Branch.
Das Tablet benötigt `workspace:read` und die neue explizite Freigabe
`projects:write`; alte Geräte erhalten sie nicht automatisch. Nächster Task T3:
Branches und profilfreie CLI-Sitzungen in diesem Workspace. Der frühere Einstieg
ist unter „Agent-Arbeitskopie“ weiterhin erreichbar. Einzelne Task-Nachweise stehen
im Goal-Dokument; die abschliessende Gesamtverifikation und der Push folgen T6.
Bis zum unten genannten ausdrücklichen Zwischen-Neustart blieb die persönliche
ADE-Instanz während aller Tests erhalten.

Aktuelle Steuerung: Der Nutzer verlangt nun ausdrücklich Zwischencommit und
Neustart zum Testen von T2b auf dem Tablet. T3a ist begonnen (Branch-Datentypen und
interne Worktree-Übernahme), aber noch keine Branch-Operation freigegeben. Der
Neustart wurde nach Prüfung laufender Prozesse und einem Build durchgeführt; der
abschliessende Push bleibt ausstehend.

Zwischenstand `03175c4` läuft seit **9. September, 23:35:47 Europe/Zurich** in
ADE PID **26028**, aus der festen Build-Kopie
`test-results/operator-release-03175c4`. Diese Instanz liest ihre Assets aus dieser
Kopie; weitere Entwicklungs-Builds ändern den Tablet-Teststand nicht. Der frühere
ADE-Prozess 64500 hatte keine aktive CLI und keine aktiven Runs/Leases mehr, nur
eine Shell der beendeten Claude-Sitzung; diese wurde beim angeforderten Neustart
beendet. Die Konfiguration wurde vorher neben der Originaldatei gesichert.

Private HTTPS liefert HTTP 200 mit `/assets/index-ByRvwC5J.js`, passend zum
Build; der Listener auf 127.0.0.1:4317 gehört PID 26028. Tailscale-Serve-Routen
sind unverändert. Das bestehende Gerät „Samsung Galaxy S10 Ultra“ ist weiterhin
gekoppelt; die neue Freigabe `projects:write` wurde nicht automatisch hinzugefügt.
Der Nutzer wurde auf den Haken „Projekt-Workspaces ohne Agent-Profil öffnen“ in
Settings → Verbundene Geräte hingewiesen. Neustart-/Build-/Routennachweise:
`test-results/project-checkpoint-*`. T3a/T3b und die Gesamtverifikation bleiben offen.

Entwicklungsstand danach: T3a ist intern mit 40 echten Git-Prüfungen und drei
TypeScript-Projekten grün abgeschlossen. Die API-/UI-Verbindung und profilfreien
Terminals folgen T3b. Auf erneuten Wunsch wurde die weiterhin laufende Instanz
26028 sichtbar wiederhergestellt; ihr privater HTTPS-Einstieg antwortet HTTP 200.
Es wurde keine zweite Betreiberinstanz gestartet und der Build bleibt `03175c4`.

- Nutzeranleitung: [USER_GUIDE.md](USER_GUIDE.md).
- Priorisierte Befunde mit Abnahmekriterien: [Produktreview](research/ADE_PRODUCT_REVIEW_2026-09-09.md).
- Dokumentationsentscheidungen: [DOCUMENTATION_AUDIT.md](DOCUMENTATION_AUDIT.md).
- Einstieg in alle Dokumente: [README.md](README.md).

## Produkt- und Betreiberstand

Die Tastaturaktivierung aus `02330e1` wurde gebaut und am 9. September um 18:45
auf dem privaten Mobile-Listener aktiviert. Dabei blieben die vorhandene
ADE-Instanz und ihre Codex-Sitzung erhalten. Der nachfolgende Dokumentationscommit
war `8433e7d`. Details: [Keyboard activation results](TERMINAL_KEYBOARD_ACTIVATION_RESULTS.md).

Der Nutzer meldet danach eine verbesserte Darstellung/Bedienung. Eine vollständige
physische Matrix für Samsung-Tastatur, DeX, Hochformat, externe Tastatur und
Verbindungswechsel ist weiterhin offen. Das frühere reine „noch nicht am Gerät
bestätigt“ ist damit als pauschale Aussage überholt; eine vollständige Freigabe
aller Gerätefälle wäre ebenfalls nicht belegt.

Für diese Guide-Aufnahmen wird eine getrennte temporäre ADE-Instanz gestartet:
eigener Profilordner, lokales Demo-Git-Repo, separate Loopback-Ports und lokale
CLI-Fixtures. Die echte Tailscale-Konfiguration wird nicht verändert. Der reale
Betreiber-Host benötigt für reine Dokumentationsänderungen keinen Neustart.

## Validierung und Aufnahme

Der abschliessende `pnpm verify` dieses Dokumentationsslice ist auf nativem
Windows grün: **2.148 Checks**, alle drei TypeScript-Projekte und Produktionsbuild.
Zusätzlich wurden Capture-Driver, 14 Bilder und 187 lokale Dokumentverweise geprüft.
Der frühere fokussierte Keyboard-/Assistant-Lauf umfasst **50** Checks; seine
Negativ-/Positivkontrollen bleiben im zugehörigen Ergebnisdokument erhalten.

Neue Aufnahmen reproduzieren:

```powershell
pnpm build
pnpm exec tsx scripts/capture-user-guide.ts
```

Die 14 PNGs und [capture.json](media/user-guide/capture.json) liegen unter
`docs/media/user-guide`. Browser-/Git-/PTY-Abläufe sind echt; Modelle und Tailscale
sind in der Fixture ersetzt. Die Softwaretastatur wird durch VisualViewport-
Geometrie simuliert. Keine echten Anbieterantworten oder physische Gerätemessung
aus diesen Bildern ableiten.

## Aktuelle Fortsetzung

T0 dokumentiert den Auftrag; T1 liefert wahrheitsgetreue CLI-/Shell-Zustände für
native Windows. T2a liefert Projektordner-Erkennung und unabhängige Workspace-
Identitäten als Main-Service; T2b bindet nun UI/API daran an. Zusätzliche
WSL-Abnahme ist wegen eines Backend-Timeouts offen;
Details, grüne Windows-Läufe und Betreibergrenzen stehen im aktiven Goal.
Reihenfolge und Abnahme stehen im [aktiven Goal](PROJECT_WORKFLOW_GOALS.md).
Die bisherige Verifikation unten/oben betrifft die Ausgangsbasis, nicht bereits
den neuen Umbau. Offene Engineering-Tracks bleiben in [ROADMAP.md](ROADMAP.md).

## Weiterhin geltende Grenzen

Architektur-, IPC-, Wire- und Workspace-Verträge bleiben in
[ARCHITECTURE.md](ARCHITECTURE.md) und [STATUS.md](STATUS.md) verbindlich.
Windows UI mit WSL-Backend ist nicht native Linux-/WSLg-Ausführung.
Automatisierte Fixtures ersetzen keine echte Provider-/Tablet-Abnahme.

Die Goal-6-Messungen auf `2D_rpg_jumpnrun` bleiben historische Evidenz. Weitere
reale Produktmessungen bevorzugen isolierte ADE-Worktrees von RhinoClaw; der
gewöhnliche Checkout, `main`, die installierte Skill und die laufende Rhino-
Installation bleiben ohne gesonderten Auftrag unberührt. Automatisierte Tests
verwenden synthetische lokale Repositories.


## Ergebnis-Build gestartet — 2026-09-10, 00:41:57 Europe/Zurich

- Produktänderung committed als `e07e00b`; feste Build-Kopie unter
  `test-results/operator-release-e07e00b`, ADE PID 67208. Das Hauptfenster ist
  sichtbar, Listener ausschliesslich `127.0.0.1:4317`. Tablet-Adresse HTTP 200,
  neues Asset `index-DI8OuzYK.js`. Tailscale-Serve-Konfiguration bytegleich.
- Vor dem Stopp von PID 26028 waren keine laufenden/queued Tasks oder aktiven
  Runs vorhanden. Nur die geprüfte alte ADE-Instanz wurde beendet.
- Operator-Config gesichert als
  `%APPDATA%/ade/ade/config.json.before-run-inspection-e07e00b`. Ausschliesslich
  die passende Abschlussantwort (2.092 Zeichen, Quelle `recovered-cli`) wurde
  dem oben genannten beendeten Task hinzugefügt; alle anderen Config-Felder
  wurden vor dem Schreiben auf Unverändertheit geprüft.
- Neuer RunInspection-Service gegen den tatsächlichen Original-Workspace geprüft:
  PNG 2.261.193 Bytes, XLSX 5.626 Bytes, Markdown 1.611 Bytes lesbar. Ergebnis:
  `test-results/run-inspection-operator-probe.log`. Kein Modell erneut gestartet.
- Auf dem Tablet Chrome neu laden, Work-Run/Graph-Agent öffnen und **Ergebnis**
  oder **Dateien** wählen. Physischer Samsung-Test bleibt beim Nutzer.
- T3b-Stash bleibt vollständig erhalten; T3b–T6 und der gemeinsame Push offen.
