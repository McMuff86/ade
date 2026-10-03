# Goal 34.6 — Architekturentscheid: unabhängiger ADE-Host

**Status:** Am 3. Oktober 2026 vom Benutzer angenommen, einschliesslich der
Empfehlungen in Abschnitt 6. Übernommen in [ARCHITECTURE](ARCHITECTURE.md)
(„Decision: independent ADE host“) und [SPEC](SPEC.md) („Unabhängiger
ADE-Host“). Die bisherigen Abschnitte (siehe Abschnitt 7) tragen dort einen
Zielhinweis und beschreiben bis zur Umsetzung weiterhin das ausgelieferte
Verhalten. **Nicht umgesetzt.** **Extern geprüft am 3. Oktober 2026; H0
freigegeben** (Review durch die Orchestrator-Session, Abschnitt 10; R1–R8
angenommen und eingearbeitet, R9 abgelehnt). **Spike H0 abgeschlossen am
3. Oktober** ([Protokoll](research/host/H0_SPIKE_2026-10-03.md)); **H1 abgeschlossen am 3. Oktober** (Composition Root
getrennt, siehe Etappentabelle); **H2a implementiert** (Tresor-Kern und
Migrationsempfänger, noch ohne produktive Verdrahtung), H2b–H2d offen:
[H2-Schritte und Nachweise](HOST_SECRETS_H2.md). Bezug: [Goal 34.6](AGENT_SESSION_PRODUCT_GOALS.md#goal-346--arbeit-läuft-in-einem-unabhängigen-ade-host).

Grundlage sind drei Untersuchungen vom 3. Oktober: eine Bestandsaufnahme der
Electron-Abhängigkeiten in `src/main`, eine Quellanalyse von herdr 0.8.2
(Release-Commit `9eb52145`, lokal installiert) und ein Vergleich mit VS Code
(ptyHost/Server), tmux, zellij, wezterm, Zed, JetBrains Gateway, Docker Desktop,
Tailscale und Syncthing. Unbelegte Punkte sind als *ungeprüft* markiert.

## 1. Ziel und Versprechen

Heute besitzt der Electron-Main-Prozess alles: PTYs, Adapter, Orchestrierung,
Journal, Host-API und Tailscale-Freigabe. „ADE beenden“ beendet deshalb jede
laufende Sitzung (`PtyManager.disposeAll`, `src/main/pty/PtyManager.ts:520`).

**Ziel:** Ein langlebiger ADE-Host pro Benutzer und Profil besitzt PTYs, Adapter,
Orchestrierung, Journal, Secrets und die Host-API. Desktop und Tablet sind Clients.

**Was ADE danach ehrlich versprechen kann:**

| Ereignis | Agent-/Shell-Prozess | Run-/Journalzustand | Wiederaufnahme |
|---|---|---|---|
| Renderer-Reload | läuft weiter (schon heute) | erhalten | Replay-Puffer |
| Desktop schliessen, abstürzen, neu starten | **läuft weiter (neu)** | erhalten | Anhängen + Replay |
| Tablet getrennt | läuft weiter | erhalten | Anhängen |
| ADE-Betreuung (Goal 26/33) bei geschlossenem Desktop | läuft im Host weiter | erhalten | Anhängen; Rückfragen über Desktop oder Tablet |
| Host-Absturz oder Host-Update | beendet | erhalten (Journal) | nur natives Resume, ausdrücklich |
| Abmelden | beendet (ohne Linger) | erhalten | nur natives Resume |
| Neustart, Stromausfall | beendet | erhalten | nur natives Resume |

Prozesskontinuität über einen Host-Absturz, ein Abmelden oder einen Neustart hinweg
wird nicht behauptet. Betrieb vor der Benutzeranmeldung bleibt ein eigener Vertrag.

## 2. Ausgangslage im Code

Die Bestandsaufnahme ist günstiger als erwartet:

- Nur 8 Dateien in `src/main` importieren `electron` zur Laufzeit.
  `AdeApplicationService`, `OrchestrationService`, `HostApiServer`,
  `MobileAccessController`, `RemoteTerminalService`, `WebPushService`,
  `CoordinatorConversation`, `OrganizerService` und `HostOperationService` hängen
  auch transitiv nicht an Electron. `PtyManager` und `RunCoordinator` hängen nur
  über `notifications.ts` daran; dort wird ohne Electron nichts angezeigt.
- **node-pty 1.1 (N-API)** lädt mit derselben `pty.node` unter Node 26.8.2 und
  startet einen Prozess (gemessen unter Linux; Windows nicht gemessen).
- Die Kopplung entsteht in der Composition Root `src/main/ipc.ts:217-704`, die
  Verdrahtung und IPC-Registrierung mischt.

**Echte Blocker:**

| Blocker | Stelle | Art |
|---|---|---|
| `safeStorage` (Chromium OSCrypt) | `ipc.ts:458-461` (Geräte- und Push-Store), `settings/HarnessCredentialService.ts:81` | hart: drei verschlüsselte Stores |
| Profilbesitz über `app.requestSingleInstanceLock` und `second-instance`-Steuerung (`--ade-quit`, `--ade-activate-quit`) | `index.ts:89-111` | hart |
| Client-Identität über `event.sender.id` | Diktat, Antwortsprache, Bundle-Import, Mikrofonfreigaben in `ipc.ts` | mittel |
| `nativeImage` in Host-Diensten (Profilfoto, Terminalbilder, Organizer-Bildprüfung) | `ipc.ts:394, 541, 613` | mittel |
| `powerSaveBlocker`, `shell.trashItem`, Login-Items, `app.relaunch`, Absturzerfassung | `ipc.ts`, `loginStartup.ts`, `logging/crashCapture.ts` | klein, teils schon hinter Ports |
| Aktivierung liest Chromium-`SingletonLock` und durchsucht `/proc`-Nachfahren des Electron-Prozesses | `scripts/helpers/linuxActivation.ts:21-55` | mittel |

**Umfang der IPC-Fläche:** 151 Invoke-Kanäle (`ipcPolicy.ts`). Davon sind
9 `shared`, also auch remote verfügbar, und 12 Ereignisströme.

**Stores:** Alles liegt unter `userData/ade/`. `config.json` enthält den ganzen
Journalzustand und wird atomar geschrieben (Temp-Datei, fsync, rename). Zusätzlich
schützen ihn eine `O_EXCL`-Sperrdatei mit Boot-ID und ein Fingerabdruck der Datei
(`config/store.ts:837-990`).

## 3. Vergleich mit herdr und anderen Systemen

herdr ist das nächste Vorbild: Ein headless Server pro Sitzung besitzt alle PTYs,
TUI-Clients hängen sich über Unix-Sockets an.

| Thema | herdr 0.8.2 | ADE-Entscheid |
|---|---|---|
| Start | erster Client startet `herdr server` mit `setsid`; keine systemd-Unit | systemd-User-Dienst; der Desktop startet nur den Dienst (E3) |
| Einzelinstanz | Verbindungsprobe auf den Socket, danach Unlink und Bind; kein `flock`, also anfällig für Wettläufe | `flock` vom Betriebssystem plus Epoch-Fencing (E4) |
| Socket und Rechte | `~/.config/herdr/*.sock`, `chmod 0600` erst nach `bind`, keine Peer-Prüfung, kein Token | `$XDG_RUNTIME_DIR`, Verzeichnis 0700, Peer-UID-Prüfung (E5) |
| Rechte innerhalb des Kontos | jeder Prozess in einem Pane erhält über `HERDR_SOCKET_PATH` Vollzugriff auf alle Panes | Agenten erhalten **keinen** Host-Socket; nur begrenzte Fähigkeiten pro Aufgabe (E5) |
| Protokoll | JSON-Zeilen-API mit Schema plus bincode-TUI-Protokoll; Version muss **exakt** passen | HTTP/JSON mit `hello{major,minor}`; Toleranz N-1 (E9) |
| Update | `update --handoff`: PTY-fds per `SCM_RIGHTS` an den neuen Server, Manifest und Commit-Handshake mit Rollback; nur Unix, Exit-Codes gehen verloren, Token erratbar | v1: leeren, dann neu starten. Übergabe nach herdr-Vorbild nur als spätere Option mit Nachweis (E9) |
| Persistenz | `session.json` ohne fsync, entprellt; ein Absturz beendet alle Panes | bestehendes fsync-Journal mit `RunArchive` bleibt |
| Agent-Zustand | Bildschirmanalyse mit Regeldateien je Agent; Hooks wurden zurückgebaut, weil sie Übergänge verpassten | native Adapter- und App-Server-Ereignisse zuerst; Bildschirmanalyse nur als Rückfall |
| Resume | nur über Sitzungs-IDs, die die Integration gemeldet hat (`claude --resume`, `codex resume`); standardmässig automatisch | gleiche Quelle der IDs, aber **nie automatisch** (E10) |
| Mehrere Clients | lesende Beobachter plus genau ein schreibender Client mit Übernahme (`--takeover`) | übernehmen für Desktop und Tablet (E6) |
| Windows | ConPTY und Named Pipe mit DACL nur für SYSTEM und Besitzer; Server-Start über WMI, um Kill-on-Close-Jobs zu entgehen | Aufgabenplanung bei Anmeldung, Pipe-DACL nur für die Benutzer-SID (E3, E5) |

**Weitere Muster:**

- **VS Code:** Der lokale ptyHost ist ein `utilityProcess`. Er überlebt
  Fenster-Reloads, aber nicht das Beenden der App. Seine „Revive“-Funktion startet
  Prozesse neu und setzt sie nicht fort.
- **VS Code Server:** Verbindungstoken als Datei, Reconnect-Frist von 3 Stunden.
- **Tailscale:** LocalAPI als HTTP über einen 0600-Socket mit `SO_PEERCRED` bzw.
  über eine Named Pipe. Das ist die nächste Vorlage für ADE.
- **Syncthing:** API-Schlüssel in einer Datei als einzige Sicherung. Dieses Muster
  vermeiden wir.
- **zellij:** trennt eine „live“ Sitzung von einer „wiederherstellbaren“. Das
  entspricht der Unterscheidung zwischen Anhängen und nativem Resume.

## 4. Entscheide

### E1 — Ein Host pro Benutzer und Profil; Desktop und Tablet sind Clients

Der Host besitzt `PtyManager`, `CodexAppServerProcess`, Orchestrierung,
`RunCoordinator`, alle Stores, Journal und Retention, `HostLifecycle` und
Recovery, Secrets, Host-API, Tailscale Serve, die Auslieferung der Mobile-PWA und
Web Push. `AdeApplicationService` wird **einmal im Host** instanziiert. Lokale und
entfernte Adapter rufen nur diese Fassade auf.

Der Desktop behält Fenster, Tray, Dialoge, Zwischenablage, `ade-photo://`,
Mikrofonfreigaben und das Anzeigen von Desktop-Benachrichtigungen.

Die Bindung „Desktop ist autoritativ“ (`ARCHITECTURE.md:1628`) wird ersetzt durch
**„Host ist autoritativ; Desktop und Tablet sind Clients“**. Die Bindung „Mobile
ist eine Steuerung, keine Ausführungsebene“ bleibt.

**Langlebige Betreuung als Konsument (R8):** Die ADE-eigene Betreuung
(Goal 26/33: `SupervisionService`, `CoordinatorConversation`, Organizer) muss
den Desktop überleben und läuft deshalb im Host. Ihre Zeitgeber, Folgeaufträge
und offenen Rückfragen hängen nicht an einem offenen Fenster. Externe
Aufsichts-Sitzungen (etwa eine Orchestrator-Session ausserhalb von ADE) erhalten
**nicht** den Prinzipal `desktop-local`. Ihr Zugang wäre ein eigener, begrenzter
Prinzipal mit Audit und ist ein gesonderter Vertrag ([Goal 35](SUPERVISOR_ACCESS_GOALS.md)); Anforderungen dazu
sammelt [STANDING_SUPERVISOR_2026-10-03](research/agent-orchestration/STANDING_SUPERVISOR_2026-10-03.md)
(vom Orchestrator verfasst).

### E2 — Laufzeit: Electron-Binary im Node-Modus, Host-Code ohne Electron

Der Host ist ein eigener Einstiegspunkt (`out/host/index.js`). Er wird mit
demselben Electron-Binary und `ELECTRON_RUN_AS_NODE=1` gestartet:

- Es wird keine zweite Laufzeit ausgeliefert.
- Er nutzt dieselbe node-pty-Build-Ausgabe.
- `CoordinatorCodexPolicy.ts:122` nutzt diesen Modus bereits.

Host-Code darf `electron` weder direkt noch transitiv importieren. Eine
Import-Graph-Prüfung in `pnpm verify` schlägt sonst fehl. Damit bleibt ein
späterer Wechsel auf ein eigenes Node-Binary günstig.

*Verworfen:*
- `utilityProcess`: ist ein Kind von Main und überlebt das Beenden der App nicht.
- Fensterloses Electron-Main: schleppt Chromium mit und konkurriert um die
  Profilsperre.
- Neuschreiben in Rust oder Go: kein Nutzen gegenüber der vorhandenen,
  geprüften TypeScript-Domäne.

*Bekannte Folge:* Ist die RunAsNode-Fuse aktiv, kann Code „als ADE“ Node ausführen.
Unter macOS betrifft das Keychain-ACLs; dort wird das vor einem macOS-Ziel neu
entschieden.

### E3 — Supervision durch das Betriebssystem

**Linux:** Eine systemd-User-Unit `ade-host.service` (für ein Entwicklungsprofil
eine Instanz-Unit `ade-host@<profil>.service`):

- `Restart=on-failure`
- `TimeoutStopSec` ausreichend für geordnetes Beenden
- **`KillMode=control-group`** (Standard): Stirbt der Host, sterben seine Agenten
  mit. Unbeaufsichtigte Agenten, die weiter in Worktrees schreiben, wären
  schlimmer als ein ehrlich gemeldeter Abbruch.

Der Desktop startet den Host mit `systemctl --user start` und nie als eigenes
Kind. Sonst läge der Host im Scope der App (heute
`app-com.adimuff.ade-<pid>.scope`) und würde mit ihm abgeräumt. Ohne systemd wird
mit `setsid` plus Doppel-Fork gestartet. Socket-Aktivierung ist für v1 optional.

**Windows:** Ein Hintergrundprozess in der angemeldeten Sitzung, gestartet über
die Aufgabenplanung „bei Anmeldung, nur wenn angemeldet“ mit
Neustart-bei-Fehler. Zusätzlich startet der Desktop ihn bei Bedarf über diese
Aufgabe. Der Host löst sich aus Kill-on-Close-Jobs des Aufrufers. Jede Sitzung
läuft in einem eigenen Job-Objekt mit `KILL_ON_JOB_CLOSE`.

*Verworfen:* ein Windows-Dienst. Er läuft in Session 0, ConPTY bräuchte
Benutzer-Tokens, DPAPI-Profile und WSL laufen pro Benutzer.

**macOS:** später als LaunchAgent (`SMAppService`).

**Linger** (`loginctl enable-linger`) ist standardmässig aus; Begründung in E8.

### E4 — Genau ein schreibender Profilbesitzer

- Der Host hält `flock(LOCK_EX|LOCK_NB)` auf `<profil>/ade/host.lock`
  (unter Windows `LockFileEx`). Das Betriebssystem gibt die Sperre beim Tod des
  Prozesses frei, eine veraltete Sperre gibt es also nicht.
- Die Datei enthält nur zur Diagnose `{pid, bootId, start, build, protocol,
  socket, epoch}`.
- Der Socket wird erst **nach** der Sperre gebunden.
- Jeder Hoststart erhöht eine monotone **Epoch**. Journal- und Lebenszyklus-Einträge
  tragen sie, ein Schreiben mit älterer Epoch wird abgelehnt.
- Die vorhandene `O_EXCL`-Sperre mit Fingerabdruck im `ConfigStore` bleibt als
  zweite Verteidigungslinie.
- Der Desktop öffnet Stores nie schreibend. Die Electron-Single-Instance-Sperre
  bleibt, schützt aber nur noch das UI (ein Desktopfenster pro Profil).
- `HostLifecycle` wechselt in den Host: Ein Absturz oder Neustart des Desktops ist
  kein Ende des Profilbesitzers mehr.
- **Selbstheilung nach SIGKILL (R6):** Die `flock`-Sperre fällt mit dem Prozess;
  die `O_EXCL`-Sperre im `ConfigStore` erkennt den toten Besitzer über Boot-ID
  und Prozessstart (`staleOwner`, `config/store.ts:894`). Nach einem SIGKILL
  startet der von systemd neu gestartete Host ohne manuellen Eingriff. Beide
  Mechanismen müssen das gemeinsam nachweisen (Negativkontrolle H3).

**Ablauf beim Desktopstart:**

1. Sperrinfo lesen.
2. Verbinden und `hello` senden.
3. Fehlt der Host, ihn über den Dienstmanager starten.
4. Mit Backoff auf Bereitschaft warten.
5. Nach einer Zeitgrenze einen sichtbaren Fehler zeigen, nie stillschweigend
   selbst schreiben.

### E5 — Lokaler Transport und Authentifizierung

- **Linux:** `$XDG_RUNTIME_DIR/ade/<profil-hash>.sock`, Verzeichnis 0700 und
  Socket 0600 (Verzeichnisrechte schliessen das Fenster zwischen `bind` und
  `chmod`). Der Kernel erzwingt damit die UID bereits: `$XDG_RUNTIME_DIR` und
  das 0700-Verzeichnis sind nur für den Benutzer durchsuchbar. Eine
  Peer-UID-Prüfung über `SO_PEERCRED` ist deshalb **optional** und kein
  Bestandteil von H0/H3 (R4). Der Host prüft beim Start Besitzer und Rechte des
  Verzeichnisses und verweigert den Start bei Abweichung.
- **Windows:** Named Pipe `\\.\pipe\ade-host-<hash(SID+profil)>` mit expliziter
  DACL nur für die Benutzer-SID, über einen nativen Helfer, weil libuv keine DACL
  setzt. Das ist der einzige native Transport-Helfer; er gehört zu H7.
- **Zweiter Faktor auf beiden Plattformen:** ein zufälliges Token pro Hoststart in
  einer Datei, die nur der Benutzer lesen kann. Das Token allein reicht nie (kein
  Syncthing-Muster).
- **Protokoll:** HTTP/1.1 über Socket bzw. Pipe für Befehle. Ereignisse und
  PTY-Bytes laufen über einen Strom pro Anhang (Upgrade), mit `seq` und
  begrenztem Backpressure. Das passt zum vorhandenen 256-KB-Replay-Ring.
- **Prinzipale:**
  - `desktop-local`: volles Vertrauen, entspricht dem heutigen Renderer über IPC.
  - Entfernte Geräte: unverändert, mit Signatur, Idempotenz und Audit.
  - Pro Verbindung vergibt der Host eine `clientId`. Sie ersetzt
    `event.sender.id` als Besitzer von Diktat-Jobs, Bundle-Auswahlen und
    Antwortsprache.
- **Besser als herdr:** Agent-PTYs erhalten **keinen** Host-Socket und kein Token
  in ihrer Umgebung. Muss eine Aufgabe zurückmelden (Werkzeug-Rückkanal), bekommt
  sie eine auf ihre Aufgabe begrenzte Fähigkeit. Diese ist widerrufbar und
  protokolliert.

### E6 — Desktop: Main wird ein dünner, richtliniengebundener Proxy

Der Weg ist Renderer → Preload → Electron-Main → lokaler Socket → Host. Der
Renderer hält nie den Socket.

- **Main** prüft weiter Absender und Richtlinie (`ipcPolicy.ts`) und leitet einen
  validierten Kanal mit Nutzlast generisch an den Host weiter.
- **Der Host** prüft dieselbe `CHANNEL_POLICY` erneut, gegen den Prinzipal
  `desktop-local`.
- Damit müssen die 142 nur lokal verfügbaren Kanäle **nicht** einzeln in
  HTTP-Routen übersetzt werden. Das war der grösste geschätzte Posten
  (3–6 Wochen).
- `REMOTE_COMMAND_CHANNELS` und die Host-API für Geräte bleiben unverändert eng.
- Ereignisse fliessen vom Host über den Ereignisstrom zu Main und von dort
  weiterhin nur über `rendererWindows.ts`.
- Die Regeln für `OrchestrationView` gelten unverändert: Prompts und
  Artefaktinhalte bleiben im Host.
- Der lokale Prinzipal erhält weiterhin Pfade. Die Pfadschwärzung gilt für den
  Draht zu Geräten, nicht für den lokalen Socket.
- **Mehrere Clients an einem PTY:** beliebig viele lesende Beobachter, genau ein
  schreibender Client mit ausdrücklicher Übernahme (herdr-Muster). Die Übernahme
  wird im UI angezeigt.

### E7 — Tablet und Host-API wandern in den Host

`HostApiServer`, `MobileAccessController`, `TailscaleService`, Web Push und die
Auslieferung der PWA laufen im Host. Damit stimmen Tablet- und Host-Version immer
überein, und das Tablet bleibt verbunden, wenn der Desktop schliesst. Unverändert
bleiben:

- Listener nur auf Loopback
- standardmässig aus
- Tailscale als Ingress
- Gerätekopplung, Signaturen, Idempotenz, Audit
- `redactForWire`

Die Geräteverwaltung bleibt eine reine Desktop-Aktion (lokaler Prinzipal).

### E8 — Secrets gehören dem Host, über den Schlüsselbund des Betriebssystems

**Tresor:** Genau ein Wrapping-Key liegt im OS-Schlüsselbund. Unter Linux ist das
der Secret Service über D-Bus (Kandidat `@napi-rs/keyring` ohne Kernel-Keyring-
Rückfall), unter Windows DPAPI `CryptProtectData`. Die Secrets selbst liegen mit
AES-GCM verschlüsselt im Host-Store. Es gibt nie einen Klartext-Rückfall.

*Verworfen:*
- Chromium-OSCrypt im Host nachbauen: koppelt ADE an Chromium-Interna.
- Der Desktop reicht Secrets im Speicher weiter: Dann könnte der Host nach einem
  Neustart nicht arbeiten, bevor der Desktop offen ist.

**Zusätzlicher Grund:** Laut Recherche ist synchrones `safeStorage` ab Electron 45
veraltet und wird in 46 entfernt (electron/electron#53662, *Datum ungeprüft*).
ADE nutzt es synchron und müsste ohnehin umbauen.

**Migration, einmalig:**

1. Der Desktop entschlüsselt mit `safeStorage` (Electron 43).
2. Er übergibt die Werte über den authentifizierten lokalen Kanal.
3. Der Host verschlüsselt sie neu und bestätigt jeden Eintrag.
4. Erst danach werden die alten Daten entfernt.
5. Schlägt etwas fehl, bleiben die alten Daten; Rollback auf den alten Build bleibt
   möglich.

Betroffen sind `harness-credentials.json`, `remote/devices.json` und
`remote/push.json`.

**Zustand `secrets: locked`:** Vor der grafischen Anmeldung ist der Schlüsselbund
gesperrt. Der Host meldet dann einen sichtbaren Zustand an Desktop und Tablet,
blockiert Starts, die Zugangsdaten brauchen, und versucht es erneut, sobald die
Sammlung entsperrt ist. Deshalb ist Linger standardmässig aus.

**Zustand `secrets: unavailable` (R5):** Gibt es keinen Secret Service (kein
Dienst auf dem Session-Bus, keine Sammlung oder ein nicht unterstütztes
Backend), meldet der Host diesen eigenen Zustand mit Diagnose, also welche
Prüfung fehlschlug. Das ist keine stille Degradierung und nie ein
Klartext-Rückfall. Arbeit ohne Zugangsdaten bleibt möglich; Starts mit
Zugangsdaten sind blockiert, bis der Benutzer den Schlüsselbund einrichtet.

**Stärke des Tresors:** Der Tresor ist genau so stark wie der OS-Schlüsselbund.
Auf diesem Rechner liegt `Default_keyring` unverschlüsselt vor (Autologin ohne
Passwort, Spike H0, Experiment 1). Das betrifft schon heute den
`safeStorage`-Schlüssel der Desktop-App. ADE erkennt einen unverschlüsselten
bzw. passwortlosen Schlüsselbund und zeigt das als Diagnose an. Das ist kein
Blocker, und ADE behauptet dann keine Verschlüsselung, die der Schlüsselbund
nicht bietet. Ob ein Schlüsselbund-Passwort gesetzt wird, entscheidet der
Benutzer; ADE ändert die Konfiguration nicht.

**Benutzerentscheid vom 3. Oktober 2026, 11:06: Schlüsselbund ohne Passwort
beibehalten.** Begründung:
- `/` und `/home` liegen auf `/dev/mapper/root` (btrfs) über `nvme2n1p2`
  (crypto_LUKS); `lsblk` hat das am 3. Oktober bestätigt. Die beim Booten
  eingegebene Passphrase gilt LUKS; der Desktop meldet sich danach per
  SDDM-Autologin an.
- Im Ruhezustand schützt LUKS den Schlüsselbund. Im laufenden Betrieb ist ein
  entsperrter Schlüsselbund für Prozesse des Benutzers ohnehin lesbar, ein
  Passwort brächte also kaum zusätzlichen Schutz.
- Die Diagnose „passwortloser Schlüsselbund“ bleibt wie beschlossen.

Zusätzlich aus H0: Ein fehlender
Eintrag in einer **gesperrten** Sammlung liest sich als `null`. Der Host prüft
deshalb `Locked`, bevor er einen fehlenden Wrapping-Key als Erststart deutet
(Negativkontrolle in H2).

**Befund auf diesem Rechner (3. Oktober, nur gelesen):**
- SDDM-Autologin (`/etc/sddm.conf.d/autologin.conf`) mit `pam_permit`. Es gibt
  also kein Anmeldepasswort, das den Schlüsselbund entsperren könnte;
  `pam_gnome_keyring` startet den Daemon (`auto_start`).
- `gnome-keyring-daemon` läuft mit `--components=pkcs11,secrets`. Beide
  Sammlungen (`session`, `Default_keyring`) melden `Locked=false`.
- Der Daemon startete 10 s vor `default.target` der Benutzersitzung.
- Die heutige Desktop-App nutzt `gnome_libsecret` erfolgreich. Der Fall „PAM
  entsperrt nicht“ tritt hier praktisch nicht auf, weil der Schlüsselbund ohne
  Passwort entsperrt ist. Das ist bestehender Zustand, keine neue Schwäche.
- Weiterhin *ungeprüft*: ob eine systemd-User-Unit beim Booten **vor** dem
  Daemon bzw. vor dem Entsperren startet (Wettlauf), und wie sich ein
  Schlüsselbund mit Passwort ohne Autologin verhält. Das ist das **erste
  Experiment in H0**.

### E9 — Versionen, Updates, Aktivierung

- **Versionsabgleich:** `hello{protocolMajor, protocolMinor, capabilities,
  build}`. Der Host akzeptiert gleiche Major-Version und Minor bis N-1. Ein zu
  neuer Client erhält einen typisierten Fehler „Host veraltet“, der Desktop bietet
  „Host neu starten, sobald untätig“ an.
- **Update in v1: leeren, dann neu starten.** Die Prüfung `restartBlockers()` aus
  `ipc.ts:474` wandert in den Host und wird über den lokalen Kanal abgefragt. Sie
  ersetzt die Suche in `/proc` und das Lesen des Chromium-`SingletonLock` in
  `linuxActivation.ts`.
- **`pnpm activate`** bleibt der einzige Weg zur persönlichen Instanz. Gate und
  Profil-Backup bleiben. Host und Desktop werden **gemeinsam** über
  `out/` / `out.prev` getauscht und zurückgerollt.
- **Keine gemischten Builds (R1):** Heute beendet die Aktivierung den Besitzer,
  bevor sie `out/` per `rename` tauscht (`linuxActivation.ts:136-145`). Mit dem
  Host reicht das nicht als einzige Sicherung: Der Host liefert `out/mobile`
  aus und könnte Module nachladen, und ein Desktop kann schon in der neuen
  Version laufen, während der alte Host noch arbeitet. Deshalb:
  - Der Host läuft aus einem **buildspezifischen Verzeichnis**
    (`builds/<buildId>/`, auf das `out` nur verweist). Ein Tausch ändert nie
    Dateien unter einem laufenden Host.
  - Der Host lädt seine Module beim Start vollständig. Vor jedem späteren
    Laden einer Datei aus dem Build prüft er seine Build-ID und meldet
    andernfalls „veraltet“.
  - Negativkontrolle H3: Build tauschen, während der Host läuft. Der Host
    arbeitet fehlerfrei weiter oder meldet „veraltet“, aber nie gemischt.
- **Journal-Migrationen** gehen nur vorwärts. Vorher wird ein Archiv geschrieben.
  Ein älterer Host lehnt ein neueres Schema ab, statt es zu überschreiben.
- **Live-Übergabe ohne PTY-Verlust** (herdr-artig per `SCM_RIGHTS`, oder ein
  kleiner Halteprozess pro PTY) ist **nicht** Teil von v1:
  - Unter Windows ist sie mit ConPTY praktisch unmöglich.
  - node-pty kann einen fremden fd nicht übernehmen (*ungeprüft*).
  - Exit-Codes gehen ohne Subreaper verloren.
  - Sie kann eine spätere Linux-Option sein. Voraussetzungen: zufälliges Token,
    Commit-Handshake mit vollständigem Rollback, Subreaper und ausführbare
    Negativkontrollen.

### E10 — Recovery: natives Resume nur ausdrücklich

Beim Start einer Sitzung speichert der Host die vom Agenten selbst gemeldete
native ID zusammen mit cwd bzw. Worktree, `CODEX_HOME` und Profil:

- Codex: Thread-ID aus dem App-Server, heute schon für Gespräche
  (`ConversationService.ts:226`).
- Claude: `--session-id` beim Start vergeben.

Nach einem Host-Ende bietet die Übersicht die vorhandene Ursache aus 34.3 und
„Gespräch fortsetzen (neuer Prozess)“ an. ADE setzt nie automatisch fort und
wiederholt keine Eingaben. Für Aufgaben im Bypass-Modus gibt es nur einen
Neustart auf ausdrückliche Benutzeraktion. Der Grundsatz „nichts wiederholt“ aus
34.3 bleibt bestehen.

### E11 — Electron-Ersatz im Host

| Heute | Im Host |
|---|---|
| `nativeImage` (Foto skalieren, PNG prüfen und umwandeln) | `@napi-rs/image` (Wahl aus H0), ausgeführt in einem **kurzlebigen Kindprozess** mit Grössen- und Zeitlimit, nicht im langlebigen Host: RSS-Plateau von rund 470–500 MB nach wiederholter Verarbeitung, Isolation des nativen Decoders. Ausgeschlossen: `sharp` (Segfault unter dem Electron-Binary) und `jimp` (V8-Abbruch bei einem Bomben-Header) |
| `Notification` | Host sendet ein Ereignis, der Desktop zeigt es an; Push unverändert vom Host |
| `powerSaveBlocker` (schon hinter einem Port) | `systemd-inhibit` bzw. `SetThreadExecutionState` |
| `shell.trashItem` | bleibt Desktop-Aktion bzw. Papierkorb über `gio trash` / Shell-API (*im Spike klären*) |
| Login-Item | wird zur Dienst- bzw. Aufgabenregistrierung |
| `app.relaunch` (Host-Neustart von remote) | Neustart über den Dienstmanager |
| Absturzerfassung | Node-Handler `uncaughtException` und `unhandledRejection` plus Journal des Dienstmanagers |

### E12 — Schliessen und Beenden sind verschiedene Aktionen

| Aktion | Wirkung |
|---|---|
| **Fenster schliessen** | Nur der Desktop schliesst oder geht in den Tray. Host und Arbeit laufen weiter. |
| **Desktop beenden** | Beendet das UI. Laufende Arbeit wird angezeigt, der Host läuft weiter. |
| **Host und Arbeit beenden** | Erfordert eine Bestätigung mit der Liste laufender Sitzungen. Beendet geordnet und schreibt das saubere Ende. |

Die Lebenszyklus-Klassifikation aus 34.3 bezieht sich dann auf den Host.

## 5. Was wir gegenüber herdr besser machen

1. Eine Sperre vom Betriebssystem plus Epoch statt einer Verbindungsprobe.
2. Ein Socket in `$XDG_RUNTIME_DIR` mit 0700-Verzeichnis, dessen Rechte der Host
   beim Start prüft (Peer-Prüfung unter Linux optional).
3. Agent-Prozesse erhalten keine Steuerung über andere Sitzungen.
4. Versionstoleranz N-1 statt exakter Übereinstimmung.
5. Ein fsync-Journal mit Archiv statt eines entprellten Schnappschusses.
6. Resume nur auf ausdrückliche Aktion.
7. Ein Dienstmanager statt `setsid` im Scope des Terminals.
8. Die Übergabe kommt erst mit Subreaper und zufälligem Token, wenn überhaupt.

Übernommen werden:

- die Tabelle „was überlebt was“
- Resume nur über selbst gemeldete IDs
- lesende Beobachter plus genau ein schreibender Client
- ein selbstbeschreibendes JSON-Schema des lokalen Protokolls
- Integrations-Hooks, die ausserhalb von ADE still und offen scheitern

## 6. Benutzerentscheide

Am 3. Oktober 2026 wurden alle fünf Empfehlungen angenommen. Die Alternativen
bleiben zur Nachvollziehbarkeit stehen:

1. **Host-Lebensdauer.** *Empfehlung:* Der Host läuft, solange du angemeldet bist,
   auch ohne offenes Fenster. So bleibt das Tablet erreichbar. Alternative: Der
   Host beendet sich nach N Minuten ohne Client und ohne Arbeit.
2. **Linger / vor der Anmeldung.** *Empfehlung:* aus. Später als eigenes Opt-in
   mit Anzeige `secrets: locked`.
3. **Live-Übergabe bei Updates.** *Empfehlung:* v1 ohne, also leeren und dann neu
   starten. Eine Linux-Übergabe ist ein späteres Ziel mit eigenem Nachweis.
4. **Reihenfolge.** *Empfehlung:* zuerst vollständig unter Linux bis H6, danach
   Windows (H7).
5. **Desktop-Proxy oder direkter Socket im Renderer.** *Empfehlung:* Proxy über
   Main (E6). Das erhält Sandbox, Context Isolation und die geprüfte IPC-Richtlinie.

Technische Fragen, die der Spike H0 beantwortet (Reihenfolge nach dem Review):

1. **Zuerst (R5):** Secret-Service-Zugriff aus einer systemd-User-Unit beim
   Booten: Wettlauf mit dem Start des Keyring-Daemons und dem Entsperren,
   Zustände `locked` und `unavailable` gemessen.
2. Ob node-pty unter `ELECTRON_RUN_AS_NODE` mit dem gepackten asar-unpacked-Modul
   lädt.
3. Wahl der Bildbibliothek.
4. Latenz-Basis (R3): heutige Zeit vom Tastendruck bis zum Echo auf dem
   Linux-Desktop als p95-Wert, damit H4 einen Vergleich hat.

Nicht mehr in H0: `SO_PEERCRED` (unter Linux optional, R4); die Pipe-DACL gehört
zu H7. Alle vier Fragen sind am 3. Oktober beantwortet ([Protokoll](research/host/H0_SPIKE_2026-10-03.md)).

## 7. Folgen für bestehende Verträge

Am 3. Oktober mit einem Zielhinweis versehen; ersetzt werden sie mit der
jeweiligen Umsetzungsetappe:

- `ARCHITECTURE.md:1628` (Desktop autoritativ) → E1.
- `ARCHITECTURE.md:1576-1579` (PTYs im Electron-Main) → E1/E2.
- `ARCHITECTURE.md:2692` und `:3339` (Electron-Sperre als einziger
  Profilbesitzer) → E4.
- `ARCHITECTURE.md:1912` (Beenden stoppt alle PTYs) → E12.
- „Electron IPC contract“: Main als Proxy, Prinzipal `desktop-local`, zweite
  Richtlinienprüfung im Host → E5/E6.
- `docs/HOME_UPDATE.md` und Aktivierung: Host und Desktop gemeinsam → E9.

Unverändert bleiben die Regeln aus `AGENTS.md` zu Host-API, `REMOTE_COMMAND_CHANNELS`,
`redactForWire`, `OrchestrationView`, Retention und `WSLENV`.

## 8. Umsetzung in Etappen

Jede Etappe endet mit fokussierten Tests, `pnpm verify` und, wo sinnvoll,
persönlicher Aktivierung über `pnpm activate`. Die Aufwände sind grobe Schätzungen.

| Etappe | Inhalt | Nachweis / Negativkontrolle | Aufwand |
|---|---|---|---|
| **H0 Spike** (abgeschlossen 3. Oktober, [Protokoll](research/host/H0_SPIKE_2026-10-03.md)) | **Zuerst** Secret Service aus der User-Unit beim Booten (R5); danach Host-Einstieg unter `ELECTRON_RUN_AS_NODE` mit node-pty, Bildbibliothek, Latenz-Basis p95 (R3) | Wegwerf-Messprotokoll; keine Produktbehauptung; Ergebnis zu `locked`/`unavailable` dokumentiert | 2–3 Tage |
| **H1 Composition Root trennen** (abgeschlossen 3. Oktober: `host/composeHost.ts`, Ports, Handler-Tabelle; Grenzprüfung 213 Module; Commits `db4723c`…`6ac84b5`) | `ipc.ts` aufteilen in `hostComposer` (ohne Electron) und Desktop-Adapter; Ports für Bild, Power, Benachrichtigung; `clientId` statt `sender.id`; noch im selben Prozess. **Während H1 gehört `src/main/ipc.ts` exklusiv dieser Etappe** (kurzer Freeze für parallele IPC-Arbeit, R7) | Import-Graph-Prüfung „Host ohne Electron“ schlägt mit absichtlichem Import fehl; bestehende Suiten grün | ~1 Woche |
| **H2 Secrets-Tresor** (H2a Kern implementiert; H2b–H2d offen, [Schritte](HOST_SECRETS_H2.md)) | Wrapping-Key im Schlüsselbund, AES-GCM-Store, Migration mit Bestätigung, Zustände `secrets: locked`/`unavailable`, Diagnose bei unverschlüsseltem Schlüsselbund | Migration bricht in der Mitte ab → alte Daten intakt; gesperrter Schlüsselbund → Start mit Zugangsdaten blockiert; **fehlender Wrapping-Key bei gesperrter Sammlung → kein neuer Schlüssel, keine erneute Migration** | 1–2 Wochen |
| **H3 Host-Prozess** | `out/host` aus buildspezifischem Verzeichnis, `flock` + Epoch, lokaler Socket mit Token, generischer Kanal-Tunnel, Ereignisstrom, Desktop als Proxy, systemd-Unit | Doppelstart → zweiter Host beendet sich; falsche Verzeichnisrechte bzw. fehlendes Token → abgelehnt; Schreiben mit alter Epoch → abgelehnt; **Build tauschen bei laufendem Host → arbeitet weiter oder meldet „veraltet“, nie gemischt (R1)**; **SIGKILL des Hosts → systemd startet neu, Host startet ohne manuellen Eingriff (R6)** | 2–3 Wochen |
| **H4 PTY-Strom** | Anhängen und Replay über den Socket, Beobachter plus genau ein Schreiber | **Desktop beenden und neu starten bei laufender Codex-Aufgabe: dieselbe Sitzung, Ausgabe fortlaufend** (Kernabnahme 34.6); **p95 Tastendruck → Echo höchstens H0-Basis + 5 ms (R3; Basis 24,2 ms bei 120 Hz, also Grenze 29,2 ms auf dem Linux-Referenzrechner)**; beschleunigter Dauertest in `pnpm verify` (wiederholtes Anhängen/Trennen, RSS und Ringgrössen begrenzt, R2) | 1–2 Wochen |
| **H5 Tablet und Aktivierung im Host** | Host-API, Tailscale, Push, PWA im Host; `pnpm activate` über die Leerlaufabfrage des Hosts; gemeinsamer Rollback | Tablet bleibt beim Schliessen des Desktops verbunden; Versionskonflikt → typisierter Fehler; Rollback auf `out.prev`; **24-h-Dauertest mit Desktop- und Tablet-Clients, wiederholtem Anhängen/Trennen und fester RSS-Obergrenze als Abnahme ausserhalb von `pnpm verify` (R2)** | ~1 Woche |
| **H6 Recovery** | Native IDs beim Start, „Gespräch fortsetzen (neuer Prozess)“, Lebenszyklus auf den Host bezogen | SIGKILL des Hosts → Ursache korrekt, kein automatisches Resume; Resume mit falschem cwd → abgelehnt | ~1 Woche |
| **H7 Windows** | Aufgabenplanung, Named Pipe mit DACL, Job-Objekte, ConPTY-Aufräumen, WSL-Prozessgruppen | dieselben Abnahmen nativ unter Windows | 2–3 Wochen |

Die Abnahme gemäss 34.6 bleibt unverändert: Unter Linux und Windows laufen eine
CLI und eine verwaltete Aufgabe weiter, während der Desktop schliesst und sich
neu anmeldet; das Tablet bleibt verbunden. Host-Absturz, Versionskonflikt,
Doppelstart und Rollback brauchen ausführbare Negativkontrollen.

## 9. Quellen

- **herdr 0.8.2:** <https://github.com/herdrdev/herdr>. Relevante Dateien:
  - `src/server/autodetect.rs`, `src/ipc.rs:81-168`
  - `src/server/handoff.rs`, `src/server/headless.rs:1229-1435`
  - `src/persist/io.rs`, `src/protocol/wire.rs:1001-1021`
  - `src/integration/claude_settings.rs`
- **VS Code:** ptyHost in `src/vs/platform/terminal/` mit `LocalReconnectConstants`;
  Terminal Advanced (Process revive), <https://code.visualstudio.com/docs/terminal/advanced>
- **systemd:** File Descriptor Store, <https://systemd.io/FILE_DESCRIPTOR_STORE/>;
  `systemd.kill(5)`
- **Electron:** `utilityProcess`, <https://www.electronjs.org/docs/latest/api/utility-process>;
  safeStorage-Umbau in electron/electron#53662
- **Tailscale:** LocalAPI über Unix-Socket bzw. Named Pipe
  (`\\.\pipe\tailscale\tailscaled`)
- **Docker Desktop:** Backend-Sockets und -Pipes,
  <https://docs.docker.com/desktop/troubleshoot-and-support/faqs/general/>
- **Session-0-Isolation:**
  <https://www.firedaemon.com/post/microsoft-windows-interactive-services-and-session-0-isolation>
- **Claude Code Sessions:** <https://code.claude.com/docs/en/sessions>

## 10. Externer Review (3. Oktober 2026)

Geprüft durch die Orchestrator-Session „ade-orchestrator“ im Auftrag des
Benutzers, auf Grundlage dieses Plans und von Code-Stichproben (kein Prototyp).
Gesamturteil: Entscheid tragfähig, keine Blocker für H0. Jeder Punkt wurde vor
der Annahme gegen Code bzw. Systemzustand geprüft.

| Nr. | Schwere | Befund | Entscheidung | Begründung / Einarbeitung |
|---|---|---|---|---|
| R1 | hoch | `out/` wird per `rename` getauscht; ein laufender alter Host könnte Dateien aus dem neuen Build laden | **angenommen** | Heute kein Fehler: Die Aktivierung beendet den Besitzer vor dem Tausch (`linuxActivation.ts:136-145`), und `out/main/index.js` ist ein einzelnes Bundle. Mit dem Host wird das Risiko aber real, weil er `out/mobile` ausliefert und Desktop und Host unterschiedlich lange laufen. E9: buildspezifisches Verzeichnis, vollständiges Laden beim Start, Build-ID-Prüfung; Negativkontrolle H3. |
| R2 | hoch | Leaks waren durch tägliche Desktop-Neustarts verdeckt | **angenommen, präzisiert** | Ein 24-h-Lauf passt nicht in `pnpm verify`. Deshalb zweistufig: beschleunigter Dauertest mit begrenztem RSS und begrenzten Ringgrössen in `pnpm verify` (H4) und ein 24-h-Dauertest als Abnahme ausserhalb von verify (H5). |
| R3 | mittel | Zusätzlicher Hop Renderer → Main → Socket → Host | **angenommen, präzisiert** | `TERMINAL_LATENCY_RESULTS.md` misst vor allem den Tablet-Pfad; für den lokalen Linux-Desktop fehlt eine p95-Basis. Diese wird in H0 gemessen. Kriterium in H4: p95 höchstens Basis + 5 ms (ein lokaler Socket-Hop liegt erwartbar im Sub-Millisekunden-Bereich, *ungeprüft*). |
| R4 | mittel | `SO_PEERCRED` bringt unter Linux wenig gegenüber dem 0700-Verzeichnis | **angenommen** | Zutreffend: Der Kernel prüft die Verzeichnisrechte beim `connect`, und gegen root schützt auch `SO_PEERCRED` nicht. E5: unter Linux optional, stattdessen Prüfung von Besitzer und Rechten beim Start; native Helfer nur für die Windows-DACL (H7). H0 wird kleiner. |
| R5 | hoch | Wenn PAM den Schlüsselbund nicht entsperrt, wirkt 34.6 wie ein Rückschritt | **angenommen** | Befund dieses Rechners in E8 dokumentiert: Autologin, beide Sammlungen entsperrt. Offen bleibt der Wettlauf beim Booten. Er ist das erste H0-Experiment. Neuer Zustand `secrets: unavailable` mit Diagnose, ohne stille Degradierung und ohne Klartext. |
| R6 | niedrig | Zwei Sperrmechanismen; Selbstheilung nach SIGKILL nachweisen | **angenommen** | E4 ergänzt; Negativkontrolle H3: SIGKILL → systemd-Neustart → Start ohne manuellen Eingriff. |
| R7 | mittel | Aufteilen von `ipc.ts:217-704` kollidiert mit paralleler IPC-Arbeit | **angenommen** | H1 erhält exklusiven Besitz von `src/main/ipc.ts` (kurzer Freeze). Ob H1 parallel zu H0 beginnt, entscheidet der Benutzer beim Start. |
| R8 | mittel | Fehlender Konsument: langlebige Betreuung braucht den Host | **angenommen, präzisiert** | E1 und Tabelle in Abschnitt 1 ergänzt: Die ADE-eigene Betreuung (Goal 26/33) läuft im Host. Externe Aufsichts-Sessions erhalten bewusst **nicht** `desktop-local`; ein begrenzter Prinzipal für sie ist ein gesonderter Vertrag. |
| R9 | niedrig | SPEC sei englisch, der neue Abschnitt deutsch | **abgelehnt** | Die Prämisse trifft nicht zu: SPEC ist bereits zweisprachig. Die neueren Produktabschnitte oben sind deutsch (etwa „Persönliche Tasks und Notes“, „Zentraler ADE-Agent“), die älteren Grundabschnitte englisch. Eine Übersetzung würde die bestehende Konvention brechen. Stattdessen benennt `docs/README.md` sie jetzt ausdrücklich: ARCHITECTURE englisch, neue SPEC-Produktabschnitte sowie Plan-, Entscheid- und Betriebsnotizen deutsch. |
