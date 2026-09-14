**ADE-Neuordnung: aktivierter Stand und nächster Produktschritt**

Stand: 15. September 2026. Der Operator hat die Grundregel akzeptiert:
Bestehende Arbeit direkt fortsetzen; neue parallele Aufgabe in eigenem Branch
und Worktree; Agent-Profile optional. Nach ausdrücklicher Bestätigung wurden die
alten ADE-Arbeitskopien gesichert, bereinigt und die neue persönliche Konfiguration
aktiviert. Produktcode wurde dabei nicht geändert.

**Die vier Projekte als täglicher Einstieg**

| Anzeige in ADE | Originalordner |
|---|---|
| ADE | `C:\Users\Adi.Muff\repos\ai_agent_code_workspace` |
| RhinoLayoutTools | `C:\Users\Adi.Muff\repos\RhinoLayoutTools` |
| RhinoClaw | `C:\Users\Adi.Muff\repos\RhinoClaw` |
| RhinoSheetMetal | `C:\Users\Adi.Muff\repos\RhinoSheetMetal` |

Diese Ordner sind die weiterhin in Cursor nutzbaren Originalcheckouts. Sie dürfen
bei der Bereinigung niemals gelöscht oder verschoben werden. Das gilt auch für
andere normale Originalprojekte unter `repos`, die aus ADE entladen werden.
ADE öffnet für „Bestehende Arbeit fortsetzen“ genau den gewählten Originalcheckout.

**Aktive Profilordnung**

Drei optionale, projektunabhängige Profile: Codex, Claude Code und Grok.
Die bisherigen projektspezifischen Coding-Identitäten sind aus der aktiven
Auswahl genommen; ihre Einstellungen und Erinnerungen bleiben im Backup.
Die neutralen Profile übernehmen keine projektspezifischen Anweisungen oder
Erinnerungen. Vorhandene Modellwerte sind übernommen, neue Profile
verwenden die normale Berechtigungsstufe. Das ist noch keine neue Modellabnahme.

Hermes General und Sentinel bleiben als persönliche WSL-Assistenten erhalten,
einschliesslich ihrer eigenen Arbeitsorte. Beide Dashboard-Aktionen öffnen den
externen Browser. Die TUI-Startbefehle sind:

| Assistent | Backend / Arbeitsort | Startbefehl |
|---|---|---|
| Sentinel | `wsl:Ubuntu`, `/home/mcmuff/clawd` | `openclaw tui --session agent:main:tui` |
| Hermes General | `wsl:Ubuntu`, `/home/mcmuff/hermes-general-work` | `general --tui` |

Sentinels Browserziel bleibt auf ausdrücklichen Wunsch
`http://127.0.0.1:18789/chat/main`; die TUI benutzt die separat gewünschte Sitzung
`agent:main:tui`. Das sind zwei unterschiedliche Sitzungsziele. Hermes behält
`https://numbercruncher.tailfc0b86.ts.net:9443/login`.

**Durchgeführte Bereinigung**

- Genau die vier genannten Repositories und ihre bestehenden Original-Workspaces.
- ADE als Anzeigename für `ai_agent_code_workspace`.
- Alle vier Projekte in „Meine ADE Projekte“.
- Sechs alte Agent-/Repository-Bindings und zwei Workspace-Sonderzuweisungen entfernt.
- Damit auch das ungültige Main-Chef-Binding und die unterschiedlichen Startziele
  des mobilen Overrides aus der aktiven Ordnung entfernt.
- 2D_rpg_jumpnrun und Codex Native aus dem ADE-Katalog entladen; ihre Originalordner
  bleiben erhalten.
- Keine Runs zum Löschen: zum Prüftermin sind Runs, Tasks und Leases leer.
- Historische Sitzungsdaten bleiben erhalten; sie sind keine neuen aktiven Bindings.

Die Konfiguration wurde mit `validateCompleteConfig` und `normalizeConfig`
geprüft und bei gestoppter persönlicher App über `ConfigStore.save` atomar
aktiviert. Erneutes Laden bestätigte den exakten Roundtrip ohne Migration.
Der Importpfad `replace` ist hier ungeeignet, da er Änderungen an
Projekt-Workspaces und Zuweisungen absichtlich ausschliesst.

**Sicherung und Entfernung alter Arbeitskopien**

Sicherungsordner:
`C:\Users\Adi.Muff\ADE-Backups\Neuordnung-20260914-234214`.

Vorhanden sind die bisherige Konfiguration, Agent-Verzeichnisse, Bilder,
Integrationsdaten, Geräte-/Remote-Daten und die vorhandenen verschlüsselten
Credentials samt Local State. Das erhält die bisherigen Daten für einen
Rückweg auf diesem PC; es ist kein portables entschlüsseltes Credential-Backup.
`config.proposed.json` und `proposal.json` bewahren den ursprünglichen Entwurf.
`config.activated.json` enthält zusätzlich den zuletzt gewünschten Sentinel-
Startbefehl. `activation.json` dokumentiert die Aktivierung.

Alle sechs gespeicherten ADE-Binding-Verzeichnisse wurden vor der Entfernung
vollständig gesichert: 19.222 reguläre Dateien, jeweils mit SHA-256 geprüft.
1.040 Dateisystemverknüpfungen wurden ohne Traversieren ihrer Ziele als
Link-Manifeste erfasst. Diese Manifeste gehören zu einer Wiederherstellung;
die kopierten Verzeichnisse allein rekonstruieren keine Junctions.

Gesichert sind insbesondere die zwei lokalen LayoutTool-Designer-Änderungen,
dessen eigener Commit und die zwei Codex-Native-Änderungen. Für den eigenen
LayoutTools-Commit wurde zusätzlich ein verifiziertes inkrementelles Git-Bundle
erstellt; es setzt die erhaltene Historie des Originalrepositorys voraus.
Sämtliche alten Branch-Referenzen bleiben als weiterer Rückweg bestehen.

Fünf registrierte Worktrees wurden mit Git entfernt. Beim alten 2D-RPG-Worktree
entfernte Git die Registrierung, liess aber Dateien zurück; diese wurden mit
einer nativen Verschiebung auf demselben Laufwerk zusätzlich archiviert.
Der bereits unregistrierte Main-Chef-Ordner wurde ebenso vollständig ins Backup
verschoben. Die sechs alten ADE-Pfade existieren nicht mehr. Andere Test-
Worktrees ausserhalb dieser konkreten Entfernungsliste wurden nicht angefasst.

`worktrees-backup.json`, die einzelnen Datei-/Link-Manifeste, `cleanup.json` und
`folder-archives.json` dokumentieren die Schritte. Der Vergleich aller sechs
ursprünglichen Repositorys vor und nach der Bereinigung bestätigte unveränderte
HEADs, Branch-Referenzen, Git-Status, Diffs und unversionierte Dateien. Die danach
ergänzte ADE-Dokumentation ist die einzige beabsichtigte Änderung an Originaldateien
in dieser Neuordnung.

Die bekannte Entfernungsliste besteht ausschliesslich aus den sechs gespeicherten
ADE-Binding-Pfaden unter `%APPDATA%/ade/ade/worktrees` und
`C:\Users\Adi.Muff\repos\.ade-worktrees`. Niemals pauschal alle Git-Worktrees
oder Unterordner unter `repos` entfernen. Vor jeder Entfernung den kanonischen
Pfad gegen diese begrenzte Liste und gegen sämtliche Originalcheckouts prüfen.

Bei einer späteren Wiederherstellung zuerst ADE beenden, Konfiguration und
Dateiinhalte auswählen und Git-Worktrees mit ihren Metadaten wiederherstellen.
Eine gespeicherte `.git`-Zeigerdatei allein registriert keinen entfernten Worktree.

**Ausführbare Prüfung**

Der am 14. September gebaute Windows-Build wurde mit einem separaten Prüfprofil
und den echten WSL-Startbefehlen bedient. Beide Starts aus Overview erfolgreich:
Hermes meldet „ready“; Sentinel verbindet sich mit dem Gateway und zeigt
`agent:main:tui`. Es wurde kein Arbeitsauftrag eingegeben. Die Testterminals
wurden danach geschlossen; die bestehenden WSL-Dienste blieben aktiv.

Beide Dashboard-Adressen antworten mit HTTP 200: „OpenClaw Control“ bzw.
„Sign in — Hermes Agent“. Die Dashboard-Schaltflächen wurden betätigt und
öffnen den externen Browser. Ein authentifizierter Chat im Browser und eine
neue Modellantwort waren nicht Gegenstand dieser Erreichbarkeitsprüfung.
Nachweise: `test-results/reorganization-ui/verification.json`, Screenshots
und `test-results/reorganization-ui.log`. Der erste Prüfdriver wurde nach
einem zu frühen Auslesen der neu gestarteten Sitzung korrigiert; die abschliessende
positive Prüfung lief vollständig durch.

Zusätzlich wurden alle vier Projektkarten im persönlichen Profil geöffnet:
„Projekt-Workspace öffnen“ führt jeweils zum Originalordner auf `main` und
zeigt „Ohne Agent-Profil“. Nachweis:
`test-results/reorganization-personal/verification.json`. Der Windows-Build
ist regulär mit dem persönlichen Profil in Overview neu geöffnet, PID 37308
um 00:09 Uhr. `test-results/reorganization-personal-start.json` hält den Start
fest. Alle vier Projekte sind damit tatsächlich über die Oberfläche erreichbar.

**Der gewünschte Bedienablauf**

1. Projekt wählen, Originalordner und aktuellen Branch sehen.
2. Bestehende Arbeit fortsetzen oder neue parallele Aufgabe in einer zusätzlichen
   Arbeitskopie ab einer ausdrücklich angezeigten Basis beginnen.
3. Codex, Claude Code oder Grok wählen; ein gespeichertes Profil ist optional.
4. Prompt tippen oder diktieren; den Text als Entwurf sehen und an genau diese
   Sitzung senden.
5. Andere Projekte bearbeiten und über eine gemeinsame Arbeitsliste in die
   bestehende Sitzung zurückkehren.
6. Änderungen prüfen, testen, committen und lokal übernehmen oder über Push/PR
   veröffentlichen. Der Zielbranch ist vor der Übernahme sichtbar.

Heute beginnt dieser Ablauf über eine der vier Projektkarten in Overview und
anschliessend „Projekt-Workspace öffnen“, oder
über „Projekte → Meine ADE Projekte“. „Alle“ zeigt weiterhin die gefundenen
Ordner im gesamten Projekt-Stamm; das ist keine Liste aktiver ADE-Projekte.
Die Agent-Schaltfläche „Terminal öffnen“ in Overview startet dagegen das eigene
Profil-Home. Für Codearbeit deshalb zuerst die Projektkarte öffnen und dort
Codex, Claude Code, Grok oder ein optionales Profil auswählen.

Die Beschriftung „Noch kein Agent-Workspace“ auf den Projektkarten zählt weiterhin
alte Agent-Bindings. Bei der neuen Ordnung ist diese Anzeige erwartbar; der
Original-Projektworkspace lässt sich trotzdem öffnen. Eine verständlichere
Beschriftung und die gemeinsame Liste laufender CLI-Arbeiten sind noch Produktarbeit.

Ein Profilwechsel startet eine neue CLI-Sitzung. Er wechselt weder den Workspace
noch überträgt er automatisch den Gesprächskontext des anderen Anbieters.
Eine laufende CLI und eine nur noch offene Shell brauchen unterschiedliche
Anzeigen. Sprachtext darf bei einer beendeten CLI nicht versehentlich als
PowerShell-Befehl abgeschickt werden.

**Sprachfunktion: vorhandene Grundlage und fehlende Umsetzung**

Die aktuelle `SpeechService`-Implementierung lädt Stimmen, speichert die Auswahl
und erzeugt einen festen Text-to-Speech-Testsatz. Die Projekt-Stimme ist eine
Sprachausgabe-Einstellung. Es existieren aktuell keine Mikrofonaufnahme,
Speech-to-Text-Anbindung und kein Desktop-Promptentwurf mit Übergabe an eine CLI.

ElevenLabs stellt einen separaten Speech-to-Text-Endpunkt für Audio-Transkription
bereit. Dessen Integration ist eine neue Funktion und wurde in dieser Vorbereitung
nicht implementiert oder mit dem persönlichen Konto getestet.
[ElevenLabs Create transcript](https://elevenlabs.io/docs/api-reference/speech-to-text/convert),
[Speech-to-Text-Quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-to-text).

Für die erste Umsetzung: Aufnahme starten/stoppen → Transkription → editierbarer
Entwurf → „An Codex/Claude/Grok in Projekt X senden“. Der Entwurf bleibt an die
bei der Aufnahme ausgewählte Session/Workspace gebunden. Ein Projektwechsel,
eine beendete CLI oder ein verlorener Eingabe-Lease darf ihn nicht in ein anderes
Terminal umleiten. Ein Fehler erhält den Text und erlaubt einen bewussten neuen
Versuch; ein unbekannter Versandzustand darf keinen doppelten Auftrag erzeugen.

Mikrofonfreigabe muss gezielt für diese Benutzeraktion ergänzt werden; die App
verweigert derzeit pauschal Renderer-Berechtigungen. Main hält den Service-Key,
prüft Audio-/Textgrenzen und sendet redigierte Fehler. Der bereits vorhandene
Terminal-Eingabevertrag und die Desktop-/Tablet-Eingabe-Leases bleiben verbindlich.
Textausgabe wird per Terminaleingabe übergeben, nicht als frei zusammengesetzter
Shell-Befehl. Erste Abnahme am nativen Windows-Desktop, Mobile gesondert.

**Umsetzungsreihenfolge und Abnahme**

1. Erledigt: Konfiguration aktivieren und alte Arbeitskopien nach geprüfter
   Sicherung bereinigen; Originalordner, HEADs und lokale Änderungen nachprüfen.
2. Projekt-/Sitzungsnavigation vereinheitlichen: vier bevorzugte Projekte,
   konkrete Startorte und gemeinsame Liste aktiver interaktiver Arbeiten.
3. Textentwurf und anschliessend ElevenLabs-Diktat mit gezielter CLI-Übergabe ergänzen.
4. UI-Flows und Fehlerfälle ausführbar prüfen; bei Produktänderungen vollständiges
   `pnpm verify`, danach neuen Build bereitstellen und den persönlichen Ablauf
   mit den vier Projekten durchgehen. Echte Modell-/Sprachtests gesondert benennen.

Diese Neuordnung änderte die persönliche ADE-Konfiguration und entfernte die
sechs bezeichneten alten ADE-Arbeitskopien nach geprüfter Sicherung. Sie änderte
keinen Produktcode und führte keinen Commit, Push, Merge oder Branchwechsel
in einem Originalprojekt aus. Eine neue vollständige `pnpm verify`-Abnahme
wurde für diese Konfigurations-/Dokumentationsarbeit nicht durchgeführt.
