# ADE-Agent: nächste technische Anbindung

17. September 2026. Arbeitsnotizen zur laufenden Implementierung, kein neuer
Supportnachweis. [Stand und Tests](MAIN_AGENT_IMPLEMENTATION.md) sind führend.

## Aktueller Einstieg nach Wiederaufnahme

Adi priorisiert zuerst den Codex-Tablet-Ablauf. Die vorher als nächster Schritt
beschriebenen steuernden Werkzeuge sind jetzt als **Vorschlag → ausdrückliche
Bestätigung** implementiert. `CoordinatorActionStore` speichert Elternbeleg und
stabilen Dispatch-Key vor Seiteneffekt, `submitSingleTask` speichert Kind-IDs vor
Queue-Zulassung. Ergebnisse und native Rückfragen erreichen denselben Dialog;
Graph und Wiederholung verwenden die dauerhafte Beziehung. Fachtests **46/0**,
Remote **22/0**, Gesprächsbedienung **55/0**, echter Codex-Ablauf **11/0**.
Nächster Abschluss: finale Gesamtabnahme, persönlicher Testbuild und physischer
Tablet-Test gemäss [Lieferplan](TABLET_CODEX_GOAL.md). Danach Claude/Grok,
ereignisgesteuerte weitere Arbeit, tatsächliche Unteragenten und Sprachausgabe.

Die native Prüfung auf diesem PC fand zwei globale MCP-Einträge: Die CLI führt
`mcp_servers={}` mit ihnen zusammen. Policy v2 inventarisiert daher Namen und
deaktiviert sie pro Koordinatorprozess; `config/read` verlangt jedes `enabled=false`.
Dies ist nativ **3/0** und fokussiert **35/0** geprüft. Keine Änderung der globalen
Codex-Konfiguration. Die nachstehenden Erstproben sind historischer Kontext.

## Bereits geprüfte Grundlagen

- Codex 0.154.0: weitere Turns im selben Prozess, exakter Resume nach Neustart,
  native Thread-/Turn-Identität, Abbruch und dynamischer ADE-Werkzeug-Rückkanal.
- Claude Code 2.1.274: isolierter `--print`-Aufruf und neuer Prozess mit eigener
  exakter `--resume`-UUID behalten Kontext. `--safe-mode --restricted --tools ""`
  plus leere strikte MCP-Konfiguration bestätigt eine leere Werkzeugliste.
  `--resume` allein bindet Claude nicht an ein Projekt: aktuelle CLI sucht IDs
  auch in anderen Projekten. ADE muss die gespeicherte Workspace-Bindung prüfen.
- Betreuungsplan, Graph, Projektwechsel und Übergaben sind auf PC/Tablet
  angebunden. Die drei Modi sind noch Metadaten, keine autonome Ausführung.

## Zentraler Dialog

Update: Store, Service, gemeinsamer PC-/Tablet-Dialog und fünf lesende Domänenwerkzeuge
sind implementiert. Service **52/0**, Werkzeuge **15/0**, Entwürfe **22/0**,
Remote **48/0**, Text-/Diktatdialog Electron/Browser **44/0** mit Peer.
Gesprächsdiktat ist jetzt terminalunabhängig angebunden; Recorder **28/0**,
Bedienabnahme **44/0**. Sprachausgabe/Aktivierung und steuernde Werkzeuge folgen.
Native Produktionsprobe **4/0** bestätigt Übergabe-Werkzeug und exakten Resume.
Die folgenden Verträge sind dafür umgesetzt; steuernde Werkzeuge und
Sprache werden getrennt weitergeführt.

Ein dauerhaftes ADE-Gespräch braucht eigene IDs, Verlauf und Prozesszustand,
getrennt von PTY, nativem Thread und Coding-Run. Main speichert die Bindung an
Profil, Werkzeugversion und Projektrechte. Bei geänderten Rechten darf ein alter
Gesprächskontext mit inzwischen unzulässigem Projektinhalt nicht einfach weiter
an ein Modell oder ein Gerät geliefert werden. Alte Historie bleibt getrennt.
Benutzernachrichten und Modelldetail gehören in explizite Detailabfragen;
Zusammenfassungen tragen nur Digests/Längen und belegte Zustände.

Der gelieferte Dialog verbindet diesen Vertrag mit dem globalen Gespräch für
Stand und Ideen. Projektaufträge und Vormerkungen aus dem Gespräch folgen. Eine bestätigte
Nachricht erhält vor dem Modellstart eine dauerhafte ADE-ID samt Idempotenzbeleg.
Native Thread-/Turn-IDs bleiben in Main. Nach Hostabbruch bleibt ein begonnener
Schritt unbestätigt; kein automatisches erneutes Senden und kein Resume mit
geänderten Profil-/Projektrechten. Fertige Antworten und native Fragen sind
getrennte Detaildaten. Ein Dialogwechsel oder Schliessen beendet keine Arbeit.
Prozessende, Schrittunterbrechung und neue Unterhaltung sind getrennte Aktionen.

Die Remote-Anbindung erreicht denselben Gesprächsservice ausschliesslich über
`AdeApplicationService`. Ein globaler Verlauf kann Inhalte aller zugeordneten
Projekte enthalten; der gelieferte Dialog ist deshalb auf Geräte mit vollständiger
Freigabe beschränkt. Eigene, stabil gebundene Gespräche pro freigegebenem Teilumfang
wären ein späterer Ausbau. Nach jedem asynchronen Schritt Rechte erneut prüfen.
Konfigurationsänderungen brauchen einen neuen geprüften Modellkontext.

Der zentrale Agent arbeitet in einem ADE-eigenen Ordner ausserhalb der Projekte.
Der existierende `CodexDynamicTools`-Vertrag ist der Rückkanal; er ersetzt keine
domänenspezifische Autorisierung. Projektauftrag, Resultatabfrage, Rückfrageantwort,
Übergabe und Stoppen erhalten getrennte validierte Aktionen. Ein weiterer
Gesprächsschritt ist kein neuer Coding-Run. Quittungen und Ergebniszustände kommen
aus ADE/CLI-Ereignissen, nicht aus Modellbehauptungen.
Für spätere Task-Werkzeuge bleibt `RunCoordinator.submitSingleTask` der Launchweg.
Vor dessen Aufruf muss ein dauerhafter Auftrag die Elternzuordnung und den
stabilen Command-Key reservieren. Wiederherstellung verknüpft ein bereits
erzeugtes Kind erneut; ein Fehler beim nachträglichen Graph-Link darf weder
einen Doppelstart noch einen unsichtbaren Auftrag verursachen. Gesprächsscope
und aktueller Modus werden direkt vor dem Auftrag geprüft. Eine Vormerkung oder
ein Brainstorming liefert für sich noch keinen Implementierungsauftrag.

## Codex-Startkonfiguration: erste native Konfigurationsprobe

Ein rein lesender `config/read`-Probeprozess mit folgenden festen Startoverrides
meldet die aufgeführten Features tatsächlich `false`, `mcp_servers` leer,
`web_search` als `disabled` und `agents.enabled` als `false`:

```text
features.shell_tool=false
features.unified_exec=false
features.shell_snapshot=false
features.apps=false
features.hooks=false
features.plugins=false
features.remote_plugin=false
features.multi_agent=false
features.image_generation=false
features.view_image=false
features.skill_search=false
features.skill_mcp_dependency_install=false
agents.enabled=false
tools.view_image=false
web_search=disabled
mcp_servers={}
```

Die Start-/Prüfkomponente liegt inzwischen in
`src/main/pty/CoordinatorCodexPolicy.ts` und ist im expliziten Koordinatormodus
an den Gesprächsprozess angeschlossen. Sie deaktiviert zusätzlich Browser/Computer-
Werkzeuge, Code Mode, Memory, Tool Suggestions und Remote Control. Der separate
`features.code_mode_host=true` bleibt erforderlich: Codex 0.154 vermittelt auch
dynamische ADE-Werkzeuge über diesen Host. Bei einem Ausführungswrapper muss
der Aufrufer das Werkzeugergebnis über dessen Textausgabe weiterreichen. Native
Initialisierung muss Version 0.154.0 bestätigen; wirksame Konfiguration und
Threadantwort müssen read-only ohne Netzwerk bestätigen. Fokussiert **33/0**,
native Konfigurations-/Threadprobe **3/0** ohne Modellturn. Die Suite ist im
zentralen Runner. Native Koordinator-Gesprächsprobe **5/0** bestätigt Kontext,
Resume und ADE-Werkzeug; ein angeforderter nativer Schreibzugriff ist mangels
Werkzeug nicht möglich, danach besteht der positive ADE-Aufruf weiterhin.

Erste lokale Probe: `test-results/main-agent-planning/probe-codex-config.cjs`
(ignorierter Prüfartefakt). Unter PowerShell muss `mcp_servers={}` als literales Argument
quotiert sein; unquotierte Klammern scheitern vor Initialisierung. Diese Probe
belegt effektive Konfiguration; die weiteren Proben ergänzen den Werkzeugweg,
noch keine produktive Koordination. Feste Startparameter und Prüfungen erfolgen
vor dem ersten Turn, read-only unabhängig vom Coding-Profil. Task-mode-Verträge
erben diese Einschränkungen nicht. Die Versionsbindung verweigert ungeprüfte
CLI-Upgrades; unerwartete native Werkzeugereignisse beenden die Verbindung,
sind aber keine Zusicherung, eine schon ausgeführte Aktion zurückzurollen.

## Danach

### Weitere native Adapter: Nachlesen am 17. September

Lokales `claude --help` bestätigt `--input-format stream-json`, explizite Session-ID,
Resume und `--replay-user-messages`. Die aktuelle CLI kann den Systemprompt pro
Unterhaltung einfrieren (`--system-prompt-snapshot on`); ein geändertes ADE-Profil
darf deshalb nicht durch neue Startargumente als aktualisierter Kontext gelten.
Der vorhandene Bindungsdigest und ein neues Gespräch bei Profiländerung bleiben
auch für Claude nötig. Die [offizielle Headless-Referenz](https://code.claude.com/docs/en/headless)
beschreibt Fähigkeiten im Init-Ereignis und `parent_tool_use_id` für beobachtete
Unteragentenbeziehungen. Ein künftiger Graph muss diese IDs korrelieren und darf
keine privaten Thinking-Blöcke übernehmen. Diese Recherche ist kein Adaptertest.

Groks [offizielle Headless-/ACP-Referenz](https://docs.x.ai/build/cli/headless-scripting)
beschreibt `grok agent stdio`, JSON-RPC, explizite Sessions und `session/update`
für Antworttext. Sie verwendet bei Headless-Ausgabe `streaming-json` (abweichend
von Claude). Das Beispiel bewirbt Dateisystem-/Terminalfähigkeiten des Clients;
ADE darf diese erst bei vorhandener eigener Autorisierungsgrenze bestätigen.
Das Beispiel und eine fehlende Client-Fähigkeit belegen keine Einschränkung aller
nativen Grok-Werkzeuge. Native Installation, exakter Resume, Abbruch und sichere
Werkzeuggrenze sind hier weiterhin separat offen.

Der signierte Tablet-Zugang ist inzwischen implementiert: neue Wire-DTOs und
Routen ausschliesslich über `AdeApplicationService`, vollständige Ressourcenfreigabe,
`read`/`workspace:read`, für Befehle zusätzlich `runs:write` und dauerhafte Belege.
Benutzereingaben bleiben Digest/Länge, vollständige Antworten werden vor der
Seitenteilung redigiert. Der gemeinsame Dialog verwendet einen Geräte-Port mit
flüchtigem, bei Rechtefehlern gelöschtem Detailcache. Verlorene Quittungen bei
Create und Send werden im gekoppelten Browser über Reload mit demselben Key
geprüft; die Desktopprobe verzögert die Quittung sogar während Escape/Reload.
Bestätigte Abweisung, unbestätigte Zustellung und akzeptierter Modellfehler
bleiben unterschiedliche Zustände. Entwürfe behalten ihr Gerät/Gespräch und
werden beim Vergessen des Geräts entfernt. Kein pauschaler Remote-Zugriff auf
den 8-MiB-Gesprächsspeicher. Das eigene Aufnahmeziel ist ebenfalls angebunden.
Die erste bestätigte Codex-Aktionsanbindung ist inzwischen oben dokumentiert.

Für Sprache verwenden die Gesprächs-Tickets inzwischen `DictationJobs` mit
eigener main-eigener Autorisierung statt einer PTY. Gespräch, Profil/Scope,
Geräte-/Fensterbesitzer und aktueller Zustand werden vor Audio/Ergebnis erneut geprüft.
Audio bleibt flüchtig, Kostenversuche und Transcript-Zustände bleiben wie beim
bisherigen Dienst begrenzt und quittiert. Die vorhandenen Recorder und
`usePromptComposer` bleiben im Terminal. Der eigene Gesprächsrecorder übernimmt
12k-Diktattext ausdrücklich in die aktuelle 64k-Nachricht; bei Überlänge bleiben
beide Texte erhalten. Navigation stoppt Audio, die Teilvorschau bleibt gebunden.
Modellverbrauch des neuen Gesprächs wird bisher nicht in die PTY-Verbrauchserfassung
eingespeist; dafür braucht es eine eigene ehrliche Zuordnung statt erfundener Nullen.

Desktop-/Tablet-Dialog mit derselben geprüften Main-Schnittstelle; eigene
Sprachaufnahme ohne Terminalvoraussetzung. Zweite Modellunterhaltung bleibt beim
jeweiligen Projekt, während mehrere getrennte Aufgaben über den bestehenden
Coordinator laufen. Ereignisse müssen zustandsbezogen wecken, Rückfragen exakt
adressieren und Stoppen von Betreuung und Arbeit auseinanderhalten. Grok und
physisches Tablet bleiben separat nachzuweisen. Goal 6 bleibt Codex-only.
