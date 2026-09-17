# Kontexthandoff: ADE-Agent, 17. September 2026

## Auftrag und bewusst gewählter Haltepunkt

Adi möchte ADE morgens ohne offenes Repo-Terminal fragen können, wo seine
Projekte stehen. Dauerhafte Abendübergaben sollen in den Überblick einfliessen.
Danach sollen getrennte Projektagenten parallel arbeiten: beispielsweise Codex
für eine Umsetzung, Grok zum Brainstormen und Claude zur Fortsetzung. ADE soll
Aufträge, Rückfragen und Ergebnisse vermitteln; direkte Projektarbeit bleibt
möglich. Der Graph soll die tatsächlichen Beziehungen zeigen. PC und Tablet
brauchen dieselbe einfache Navigation und einen globalen Sprachzugang.

Die vorbereiteten Goals wurden zur Implementierung freigegeben. Am 17. September
um 16:34 CEST bat Adi ausdrücklich um einen wiederaufnehmbaren Zwischenstand,
Commit und Push innerhalb von höchstens 30 Minuten sowie dieses Kontexthandoff.
Deshalb keine weitere Funktion beginnen. Haltepunkt ist der geprüfte globale
Text-/Diktatdialog auf der bereits implementierten Betreuungs- und Navigationsbasis.
Der gesamte Drei-Projekte-Pilot ist **nicht abgeschlossen**.
Nach diesem Commit/Push die Arbeit pausieren und erst auf Adis nächste Anweisung
wieder aufnehmen; die offenen Goals sind kein Auftrag, diese Pause zu überspringen.

## Im Code vorhanden

- **Arbeit wechseln** auf Desktop und Tablet: Projekt-/Sitzungssuche, bestehende
  Prozesse öffnen, exakte Workspace-/Branch-/Sitzungsbindung erneut prüfen;
  kein Doppelstart und keine implizite Übernahme der Terminaleingabe.
- **ADE-Betreuung**: gespeichertes Hauptprofil, bis 64 Projekte mit den Modi
  direkt/beobachten/koordinieren, explizite Sitzungs-/Run-Verbindungen im Graph.
  Die Modi sind bisher Planungsmetadaten, noch keine autonome Steuerung.
- **Für nächste Session merken** und **Morgenüberblick laden**: dauerhafte
  Projektübergaben, nächster Schritt, belegte Arbeitsstände und offene Fragen.
- **ADE-Betreuung → Mit ADE sprechen**: globaler gespeicherter Codex-Dialog,
  eigene ADE-/native Identitäten, exakter Resume, weitere Nachrichten im selben
  Prozess, native Fragen und Unterbrechung. Schliessen der Ansicht lässt eine
  Modellantwort weiterlaufen; Beenden schliesst die eigene Modellverbindung.
- Fünf lesende ADE-Werkzeuge liefern Projekte, Status, Anweisungen und vollständige
  Übergaben. Der zentrale Prozess läuft ausserhalb der Projektordner und mit
  geprüfter read-only-Konfiguration. Er kann noch keine Projektarbeit starten.
- Derselbe Dialog im gekoppelten Browser: signierte Anfragen ausschliesslich über
  `AdeApplicationService`, vollständige Projektfreigabe und aktuelle Geräterechte.
  Private Eingabetexte bleiben auf dem Host. Antworten werden vollständig
  redigiert und in Unicode-sicheren Seiten geladen. Native IDs bleiben in Main.
- Lokale Gesprächsentwürfe und Create-/Send-Quittungen überstehen Reload/Schliessen.
  Unbestätigte Vorgänge behalten ihren Key; bestätigte Ablehnung erlaubt Korrektur.
- **Nachricht diktieren** ohne PTY: tatsächlicher Mikrofon-/AudioWorklet-Weg über
  die vorhandenen `DictationJobs`, eigener Gesprächs-/Gerätebesitzer. Vorschau
  ausdrücklich übernehmen und senden. Wechsel stoppt das Mikrofon; Teiltext
  bleibt als unvollständig beim Ursprung. Keine automatische Wiederholung einer
  möglicherweise bereits kostenpflichtigen Aufnahme. Audio bleibt flüchtig.

## Prüfstand dieses Zwischenstands

Fokussierte positive Nachweise unter nativem Windows:

| Prüfung | Ergebnis | Aussagegrenze |
|---|---:|---|
| Unit-Gesamtlauf im Checkpoint | 87 Suiten / 3.580 Prüfungen | Alle fokussierten Suiten bestehen ihre gemessenen Windows-Mindestzahlen |
| Conversation service | 52/0 | Persistenz, Identität, Wiederholung, Fragen, Aufnahmebindung und Fehlerfälle |
| Conversation drafts | 22/0 | Zielbindung, verlorene Quittungen, Entwürfe, Gerätewechsel |
| Conversation recording | 28/0 | Aufnahmelebenszyklus, Teiltext, späte Antworten, Speicherfehler und Überlänge |
| Remote conversation | 48/0 | Tatsächlicher Service/Ledger, signierte HTTP-Routen, Rechte, Paging und Sprache |
| Conversation Electron/Browser | 44/0 | Tatsächliches Electron/Preload/Main, PCM-Aufnahme und gekoppelter Chromium-Browser; Modell-/Sprachanbieter sind deterministische Peers |
| Bestehendes Remote-Diktat | 47/0 | Terminalweg nach gemeinsamer interner Anbindung unverändert geprüft |
| Security | 284/0 | IPC- und Hostgrenzen einschliesslich neuem desktop-only Aufnahmeziel |
| Navigation/Betreuung Electron | 51/0 | Drei Repos, vier PTYs, zehn Wechselzyklen, Graph, Übergaben, Fokus und schmale Layouts |
| Voller Remote-Terminaldriver | 208/0 | Positive Wiederholung nach Fixture-/Auswahlkorrekturen |
| Workspace-CLI/Terminal-Kopieren | 12/1 | Im Gesamtlauf und in der isolierten Wiederholung leerer Clipboard-Text trotz sichtbarer Auswahl; offen |
| Verbleibende Driver einzeln | Alle bestanden | Projekt-Git 22/0, Terminal-Latenz 6/0, Projektveröffentlichung 12/0, Einrichtung 38/0, visuelle Vergleiche 22/0 |

`pnpm verify` endete mit **Exit 1** in `--workspace-cli-only`. Drei TypeScript-
Projekte, 87 Unit-Suiten/3.580 Prüfungen, Build und die davor liegenden Bedien-
driver bestanden; darunter Dialog 44/0, Navigation 51/0, voller Terminaldriver
208/0 und Run-Inspektion 27/0. Die isolierte Wiederholung bestätigt denselben
Fehler: Erwartet `ADE_HISTORY_12`, gelesen `""`; Oberfläche meldet „Auswahl kopiert“,
Suchwert stimmt, zwei Selection-Rechtecke sind vorhanden. Keine Testabschwächung
und keine ungeprüfte Clipboard-Codeänderung. Ursache noch nicht bestimmt.

Logs: `test-results/main-agent-planning/verify-checkpoint.log` und
`checkpoint-workspace-cli.log`, jeweils mit `-exit.json`. Die verbleibenden
Driver bestanden anschliessend einzeln unter `checkpoint-project-git`,
`checkpoint-terminal-latency`, `checkpoint-project-publish`, `checkpoint-setup`
und `checkpoint-visual`, jeweils mit Exit 0. Abschluss dieser Prüfungen 16:57 CEST.
Diese lokalen Prüfartefakte sind absichtlich nicht in Git. Kein vollständig
grüner Gesamtlauf und keine abgeschlossene Repository-Gesamtabnahme behaupten.

Frühere separate native Proben: Codex-Kontext/Resume 4/0, eingeschränkter
Codex-Koordinator samt ADE-Werkzeug 5/0, Konfigurations-/Threadprüfung 3/0 und
Produktions-Gesprächsanbindung 4/0. Native Codex-Version 0.154.0, beobachtetes
Modell `gpt-5.6-sol` mit `high`. Claude CLI 2.1.274: isoliertes Print/Resume 3/0,
beobachtet `claude-opus-5[1m]`; das ist noch kein persistenter ADE-Claude-Adapter.
Grok ist hier nicht im Windows-PATH vorhanden. Kein Nachweis auf dem physischen
Samsung-Tablet, kein gemischter nativer Drei-Agenten-Pilot. Goal 6 bleibt Codex-only.

## Nächster Einstieg nach der Pause

1. `AGENTS.md`, dieses Handoff, `MAIN_AGENT_IMPLEMENTATION.md`,
   `MAIN_AGENT_GOALS.md`, `MAIN_AGENT_NEXT.md` und die ersten Abschnitte von
   `ARCHITECTURE.md` lesen. Bereits geprüfte Vorarbeiten nicht neu entwerfen.
   Zuerst die offene Zwischenablage-Abnahme untersuchen: tatsächliche xterm-
   Auswahl, Main-Schreibwert und OS-Zurücklesen getrennt nachweisen; Ursache
   nicht ohne Nachweis als Timing oder Umgebungsfehler einstufen. Danach
   `pnpm verify` vollständig wiederholen.
2. Nächster Lieferabschnitt: **steuernde ADE-Domänenwerkzeuge**. Zuerst explizite
   Übergaben aus dem Gespräch speichern; dann getrennte Projektaufträge und deren
   Resultate/Rückfragen anbinden. Kein generischer Shell-/PTY-/Filesystem-Zugriff
   für den zentralen Koordinator und keine Aufweichung der Remote-IPC-Allowlist.
   Neue Werkzeugrechte müssen den gebundenen Werkzeugvertrag ändern; vorhandene
   read-only-Gespräche nicht stillschweigend zu steuernden Kontexten aufwerten.
3. Für Aufgaben `RunCoordinator.submitSingleTask` verwenden. Einen dauerhaften
   Dispatch-Beleg mit Elternbeziehung und stabilem Command-Key **vor** dem Launch
   reservieren. Ein Fehler beim späteren Graph-Link darf weder Doppelstart noch
   unsichtbare Kindarbeit verursachen. Rechte/Modus am tatsächlichen Launch prüfen.
4. Danach ereignisgesteuerte Betreuung, direkte Übergabe zwischen Benutzer und
   Hauptagent, Claude-/Grok-Adapter und beobachtete Unteragentenbeziehungen ergänzen.
   Brainstorming und Vormerkungen allein erteilen keinen Implementierungsauftrag.
5. Sprachausgabe, Aktivierung per Zuruf, natürliche Unterbrechung sowie eigene
   Modellverbrauchszuordnung des zentralen Gesprächs bleiben offen. Die neue
   Diktatnutzung wird dem tatsächlichen Profil zugeordnet, keinem erfundenen PTY.
6. Den gemischten nativen Pilot und das physische Tablet separat abnehmen.

Wichtige Dateien: `src/main/conversation/` und `src/main/supervision/`,
`src/main/pty/CodexAppServerProcess.ts`, `CodexDynamicTools.ts`,
`CoordinatorCodexPolicy.ts`, `src/main/application/AdeApplicationService.ts`,
`src/renderer/conversation/`, `src/mobile/conversationPort.ts` und die zugehörigen
`scripts/test-conversation-*`, `test-remote-conversation.ts` und Navigationsdriver.

## Git, Heimrechner und Betrieb

Ausgangspunkt dieser Arbeit: `465b639` auf `main`; Remote
`https://github.com/McMuff86/ade.git`. Commit und Push sind ausdrücklich autorisiert.
Kein persönlicher Release wurde durch diese Entwicklungsarbeit aktiviert.

Zu Hause bleiben Projekte, Profile, Kopplung und Projektdateien lokal erhalten.
Das leere Profil dieses Rechners wird nicht durch Git übertragen. Für denselben
Quellcode-Start `git pull --ff-only`, `pnpm install --frozen-lockfile`, `pnpm build`
und ADE im bisherigen Benutzerprofil neu starten. Zeigt die Verknüpfung auf eine
separate Installation, benötigt diese einen eigenen aktualisierten Build.
Ausführliche Anleitung: [HOME_UPDATE.md](HOME_UPDATE.md).
