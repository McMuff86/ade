# ADE — aktuelle Übergabe

Stand: 2026-09-09. Diese Datei beschreibt den aktuellen Auftrag und Betriebsstand.
Die vollständige bisherige Übergabe ist im [Archiv](archived/HANDOFF_2026-09-09.md)
erhalten. Deren wiederholte „Nächster Schritt“-Abschnitte sind historische Notizen.

## Aktueller Auftrag

Der Nutzer hat den [projektzentrierten Ablauf als Goal](PROJECT_WORKFLOW_GOALS.md)
beauftragt: Projekte entdecken, ohne verpflichtendes Profil einen Branch und eine
CLI wählen, anschliessend Git-Aktionen ausführen. CLI- und Shell-Zustand müssen
getrennt angezeigt werden. Nach jedem abgeschlossenen Task folgt ein Commit;
gepusht wird erst am Schluss. Der frühere Research-/Guide-Auftrag ist abgeschlossen.

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
native Windows. T2 setzt mit Projektordner-Erkennung und unabhängigen Workspace-
Identitäten fort. Zusätzliche WSL-Abnahme ist wegen eines Backend-Timeouts offen;
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
