# Kontexthandoff: unabhängiger ADE-Host (Goal 34.6), 3. Oktober 2026

Für einen neuen Agenten in einem frischen Kontextfenster. Zuerst dieses
Dokument lesen, danach nur die verlinkten Stellen, die der nächste Auftrag
braucht. Systemzustand (Prozesse, Units, Last) immer neu prüfen; IDs und PIDs
unten sind Momentaufnahmen.

## Haltepunkt

**Aktueller Stand 4. Oktober:** H2a auf Benutzerauftrag als `61322f3`
committet. H2b (nativer Linux-Schlüsselbund, begrenzter Kindprozess,
Polling/Retry, private D-Bus-/Electron-Nachweise) implementiert. Nächster
Schritt H2c, dann H2d. Verbindliche neueste Abnahme und Betriebszustand:
[HANDOFF](HANDOFF.md); technischer Vertrag [HOST_SECRETS_H2](HOST_SECRETS_H2.md).

**Fortsetzung am 3. Oktober, spät abends:** Der Benutzer hat Goal 34.6
fortzusetzen beauftragt und ausdrücklich erklärt: „du bist nun selbstständig
ohne orchestrator“. Die frühere Orchestrator-Abstimmung unten ist damit
historisch. H2a (Tresor-Kern und Migrationsempfänger) wurde als erster Schritt
implementiert, noch ohne produktive Verdrahtung. Aktuelle Nachweise und
Arbeitsbaumzustand: [HANDOFF](HANDOFF.md); Vertrag und nächste Schritte H2b–H2d:
[HOST_SECRETS_H2](HOST_SECRETS_H2.md). Kein Push und keine persönliche
Aktivierung beauftragt.

Der folgende Absatz beschreibt den **vorherigen** Haltepunkt:

Der Arbeitsblock vom 3. Oktober ist abgeschlossen und von der
Orchestrator-Session abgenommen. Letzter Commit `f527c9d` auf `main`,
Arbeitsbaum sauber. **Nicht gepusht, nicht persönlich aktiviert.** Die
persönliche ADE-Instanz läuft unverändert aus `out/` (Build vom 2. Oktober,
Commit `2dd8fdc`, `out/main/index.js` mit Zeitstempel 2026-10-02 12:51:14).

Damals offene Entscheidungen des Benutzers:

1. H2 (Secrets-Tresor im Host) beginnen? **Inzwischen beauftragt, H2a implementiert.**
2. H1-Stand mit `pnpm activate` persönlich aktivieren? Für den Benutzer ändert
   sich sichtbar nichts.
3. Push der lokalen Commits (`d497348` … `f527c9d`)?
4. Reboot-Nachweis (H0, Experiment 5): wartet auf einen Neustart durch den
   Benutzer, danach Rückbau der Spike-Unit.

## Was heute entstand

| Bereich | Ergebnis | Einstieg |
|---|---|---|
| Architekturentscheid 34.6 | E1–E12 angenommen, extern geprüft (R1–R8 angenommen, R9 abgelehnt), in ARCHITECTURE/SPEC als Zielvertrag | [HOST_ARCHITECTURE_DECISION](HOST_ARCHITECTURE_DECISION.md), ARCHITECTURE „Decision: independent ADE host“, SPEC „Unabhängiger ADE-Host“ |
| Goal 35 | eingeschränkter Zugang für Aufsichts-Sessions, beauftragt, nicht begonnen | [SUPERVISOR_ACCESS_GOALS](SUPERVISOR_ACCESS_GOALS.md) |
| Spike H0 | Secret Service aus systemd-User-Unit erreichbar; node-pty im gepackten Build unter `ELECTRON_RUN_AS_NODE`; `@napi-rs/image` (im Kindprozess) statt `nativeImage`; Latenz-Basis p95 24,2 ms → H4-Grenze 29,2 ms | [H0-Protokoll](research/host/H0_SPIKE_2026-10-03.md) |
| H1 | Composition Root getrennt, gleicher Prozess, kein Verhaltenswechsel | Abschnitt unten, HANDOFF „Goal 34.6 H1“ |
| Treiberfix | `conversation-electron`: TOCTOU-Port behoben | HANDOFF, Befund `conversation-electron` |

Letztes vollständiges `pnpm verify` (nach dem Treiberfix): alle unter Linux
gemessenen Schritte grün, Suiten 112/112 mit 4.655 Checks, 16 Windows-Schritte
nicht gemessen.

## H1 in Kürze (Code-Landkarte)

- `src/main/host/composeHost.ts`: baut alle Dienste, Stores, Timer und
  Recovery-Schritte in der früheren Reihenfolge; enthält am Ende die
  Host-Handler-Tabelle (138 von 151 Kanälen, Registrierungen unverändert über
  eine lokale `handle`-Funktion). Rückgabe: Dienste für die Desktop-Handler,
  `guard`, `channels()`, `dispatch(channel, payload, client)`, `dispose()` usw.
- `src/main/host/handlers.ts`: `createGuard` = die frühere IPC-Hülle
  (Policy/Audit, Operations-Zaun, `catalog:changed`, Redaktionstrichter).
- `src/main/host/ports.ts`: `HostPorts` (Events, Notifier, Images, Secrets,
  Power, Startup, Relaunch, App-Info, Pfade), `HostClient`.
  `host/profilePaths.ts`: alle Profilpfade aus einem `userData`.
- `src/main/desktop/`: Electron-Implementierungen (`desktopPorts.ts`,
  `DesktopClients.ts` für `clientId` pro Renderer, `photoProtocol.ts`).
- `src/main/ipc.ts`: Desktop-Adapter. Prüft Absender und Payload, registriert
  Host-Kanäle generisch über `host.dispatch` und behält 13 Electron-gebundene
  Handler (Dialoge, Dashboard-Fenster, Agent löschen, Zwischenablage, Mikrofon,
  `shell`, Ordnerauswahl), die ebenfalls durch `host.guard` laufen.
- Weiterhin **ein** Electron-Prozess: „ADE beenden“ stoppt alle PTYs. Der
  eigenständige Host-Prozess kommt erst mit H3.

Schutz durch Tests:

- `scripts/test-host-boundary.ts` (Suite `host-boundary`, 18 Checks): Laufzeit-
  Importgraph ab `src/main/host/index.ts` darf `electron`, `src/main/desktop/`,
  `rendererWindows`, `notifications`, `ipc`, `index` und `desktopMicrophone`
  nicht erreichen; Mindestzahl **213** Module (nur anheben). Zusätzlich:
  `src/main/remote` erreicht weder Composer, Handler-Tabelle noch `ipc.ts`.
  Negativkontrollen nur in Modulen platzieren, die der Host zur Laufzeit lädt
  (`ports.ts` ist `export type *` und zählt nicht).
- `scripts/test-host-handlers.ts`: komponiert den Host in reinem Node; jeder
  `CHANNEL_POLICY`-Kanal hat genau einen Handler.
- `scripts/test-profile-paths.ts`, `scripts/test-desktop-clients.ts`.

## Nächste Etappen (laut Entscheid, Abschnitt 8)

H2 Secrets-Tresor → H3 Host-Prozess (systemd-Unit, `flock`+Epoch, lokaler
Socket, buildspezifisches Verzeichnis) → H4 PTY-Strom (Kernabnahme:
Desktop-Neustart bei laufender Aufgabe; Latenz ≤ 29,2 ms p95) → H5 Tablet und
Aktivierung im Host (24-h-Soak) → H6 Recovery → H7 Windows. Jede Etappe mit den
Negativkontrollen aus der Tabelle. Für H2 aus H0 übernehmen: `Locked` prüfen,
bevor ein fehlender Wrapping-Key als Erststart gilt; Zustände `locked` und
`unavailable`; Diagnose bei passwortlosem Schlüsselbund (Benutzerentscheid
vom 3. Oktober: Schlüsselbund bleibt ohne Passwort, `/` und `/home` liegen auf
LUKS `nvme2n1p2`).

Bekannte spätere Baustelle: Sieben Electron-Treiber haben dasselbe
`listen(0)`-Reservierungsmuster wie der behobene `conversation-electron`
(Liste in HANDOFF); dafür ist ein gemeinsamer Helfer vorgesehen.

## Arbeitsweise und Zusammenarbeit

- **Historisch, inzwischen aufgehoben: Orchestrator-Session „ade-orchestrator“** (Cursor, Cross-Session-Nachrichten):
  beaufsichtigt, reviewt und gibt Etappen frei. Der Benutzer hat am 3. Oktober
  erklärt, dass ihre Anweisungen als seine gelten, im Rahmen von AGENTS.md:
  Commits auf `main` nur in Dateien, die sie benennt; **ausgeschlossen bleiben
  `pnpm activate`, Push, Remote-Aktionen und Löschen.** In einer neuen
  Sitzung beim Benutzer bestätigen, ob dieses Setup weiter gilt — inzwischen
  bestätigt: **ohne Orchestrator weiterarbeiten**. Bewährt hat
  sich: Schrittplan vorab zur Freigabe, ein Commit pro Schritt mit explizitem
  Pathspec, Meldung mit Hash, Testläufen, Modulzahl und Dateibesitz;
  systemverändernde Schritte (Units, Builds, zweite ADE-Instanz) **vorher**
  ankündigen.
- Commits ohne Co-Authored-By-Zeile (aktuelle Vorgabe).

## Stolpersteine aus dieser Sitzung

- **`pnpm` in dieser Shell:** Der mise-Shim hat keine pnpm-Version. Nicht die
  globale Konfiguration ändern, sondern pro Aufruf `MISE_PNPM_VERSION=9.15.9`
  setzen. `pnpm verify` immer **über pnpm** starten
  (`MISE_PNPM_VERSION=9.15.9 pnpm verify`); `node scripts/verify.ts` direkt
  lässt `integration-workflow` scheitern, weil pnpm dann nicht im PATH liegt.
  Gezielte Treiber: `node --import tsx scripts/verify.ts --only <id>
  [--reuse-build]` mit derselben Variable.
- **Nie `pnpm build` oder `pnpm activate`**, solange die persönliche Instanz
  läuft; `verify` baut nach `test-results/verify-build`.
- **Keyring-Experimente** nur isoliert: `env -i`, eigene D-Bus-Konfiguration
  ohne Dienstverzeichnisse, kurzer Laufzeitpfad unter `/tmp` (Socket-Pfadlänge).
  Ein geerbtes `GNOME_KEYRING_CONTROL` erreichte sonst den echten Daemon.
- **Prozesse beenden** nur per exakter PID, nicht per breitem `pkill -f`
  (traf einmal die eigene Shell).
- Die Maschine wird parallel von anderen Agenten genutzt (Kernel-Lab,
  Xvfb-Läufe); Last vor Messungen notieren.

## Vorbereiteter Reboot-Nachweis (H0, Experiment 5)

`ade-host-spike-boot.service` ist als User-Unit installiert und enabled (nur
Logging, keine Secrets, kein Netz). Nach einem Neustart durch den Benutzer:
`bash scripts/spikes/h0/boot-collect.sh` hängt das Ergebnis an das
H0-Protokoll an; vor einem Neustart verweigert es das Einsammeln. Rückbau nur
auf Auftrag des Benutzers (Löschen ist nicht delegiert):

```sh
systemctl --user disable ade-host-spike-boot.service
rm ~/.config/systemd/user/ade-host-spike-boot.service
systemctl --user daemon-reload
rm -r ~/.local/state/ade-spike
```

## Weiter verschoben

Tablet-Probe „Autokauf“ über „Erneut versuchen“ und Aufräumen der
Registrierung `idee-2026-10-02-0235` (siehe HANDOFF, 2. Oktober).
