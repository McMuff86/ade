> Archiviert am 2026-10-04. Historischer Nachweis; damalige nächste Schritte sind keine aktuellen Aufträge.
> Aktueller Einstieg: [Status](../STATUS.md), [Roadmap](../ROADMAP.md), [Handoff](../HANDOFF.md).
> Der Inhalt bleibt unverändert erhalten; relative Links wurden an den Archivort angepasst.

# Tablet-Arbeit und ADE-Stabilisierung — 25. September 2026

## Ursache und gesicherte Arbeit

Das sichtbare, aber nicht mehr übernehmbare Terminal wurde durch den vollen
Remote-Aktionsspeicher blockiert: `remote/commands.json` enthielt genau 500
Belege. Bis 22:48 CEST gelangen Übernahmen, ab 22:52 wurden neue Befehle mit
`unavailable` abgelehnt. Laufende Prozesse und Dateien existierten weiterhin auf
dem PC. Tastatureingabe/Heartbeats haben ein eigenes Protokoll; nach Ablauf der
30-Sekunden-Eingabeleihe brauchte die erneute Übernahme einen neuen Beleg.

Die häufigen Sandbox-Abfragen hatten eine zweite Ursache: Beide Projektstarts
liefen als Codex **ohne Agent-Profil**. Damit galten CLI-Defaults (`on-request`,
`workspace-write`) statt des vorhandenen Codex-Profils mit Bypass, `gpt-6-astra`
und Reasoning `high`. Der Rhino-Checkout war von Beginn an auf `master` bei
`65169a2`, identisch mit dem damals abgefragten `origin/master`. Das entsprach
Adis Absicht; kein Branchwechsel oder Reset war erforderlich.

Vor Mutationen wurde der Arbeitsstand samt Patches/Hashmanifest und lokaler
ADE-Evidenz gesichert:
`C:\Users\Adi.Muff\ADE-Backups\Recovery-Tablet-20260925-2026-09-25T21-19-54-524Z`.
Die Sicherung umfasst die zehn Knuckles- und elf Rhino-Quelldateien, keine
generierten Builds. Konversationen bleiben ausserhalb der Git-Repositories.

| Repository | Branch / Sicherungscommit | Tatsächlicher Stand |
| --- | --- | --- |
| Knuckles Pi | `main` / `f65f3feb5b4d54ba587532ea967751742b6de6af` | JUCE/C++-Audioprototyp mit zwei festen Spuren, Tempo, Start/Stopp, WAV-Export; Kontext, AGENTS und Einstieg dokumentiert. Lua/Editor/Samples/Projektformat fehlen noch. |
| rhino-compute-platform | `master` / `f125f20d85ad97759653a759f6a8765a180f5419` | P2-Dokumentcache/API und Viewer-Helfer als WIP gesichert; Cachemiss-Header im Fehlerhandler repariert. Client-Anbindung/P2-Abschluss und P7 fehlen noch. |

Beide Commits wurden von getrennten Subagenten erstellt und vom Hauptagenten
anhand von Commit-Diffs, Handoffs und sauberem Git-Status kontrolliert.
Knuckles: Release-Build, Audio-Kerntest 1/1 und unabhängige WAV-Prüfung bestanden.
Rhino: 396 API-/Cache-Checks (32 nicht ausgewählt), 227 Viewer-Tests und TypeScript
bestanden. Kein neuer Audiohardware-/Rhino-/physischer Tablet-Test.
Keine Pushes oder Rhino-Deployments: Knuckles hat weiterhin keinen Git-Remote;
Rhino ist lokal einen Commit vor `origin/master`.

## ADE-Änderungen

- Remote-Aktionsbelege: 10.000 Einträge / 8 MiB statt 500 / 1 MiB. Alte Schlüssel
  bleiben gültig; kein Löschen, das bereits ausgeführte Aktionen wiederholen könnte.
- Projektstarts auf Desktop/Tablet verwenden das konfigurierte passende
  Standardprofil, sonst das eindeutige passende Profil. Bypass, Modell und
  Reasoning werden übernommen und das Profil wird angezeigt. Mehrdeutige Profile
  brauchen eine Auswahl. Ein freies Terminal bleibt profilfrei.
- Fehler bei der Eingabeübernahme sind auch mit eingeklappten Bedienelementen
  sichtbar. Ein bereits laufender CLI-Prozess bekommt nicht nachträglich andere
  Sandbox-Argumente; das neue Verhalten gilt beim neuen Profilstart.
- Gesprächsvorschlag → Projekt mit committed PROJECT.md/AGENTS.md → genau ein
  bestätigter Erstauftrag. Ein Vorschlag ohne Arbeitsauftrag legt weiterhin nur
  das Projekt an. Bestehende Direct/Observe-Projekte können beim Bestätigen des
  Auftrags auf Koordinieren wechseln; ihr Checkout/Branch bleibt erhalten.
- Das gespeicherte Profil gilt auch für den verwalteten Erstauftrag. Dieser
  arbeitet in einem separaten Workspace. Ergebnisse und Rückfragen erscheinen
  auf derselben Karte; ein verlorener Antwortbeleg oder Reload startet nicht neu.
- Früherer Kontext ist über die Verlaufswerkzeuge verfügbar. Nach Änderung des
  Projektumfangs setzt „Mit diesem Kontext weiterreden“ einen neuen nativen
  Gesprächskontext mit Verweis auf den bisherigen Verlauf auf.

Der um 22:10 CEST an den Knuckles-Agenten übergebene ADE-Auftrag war angekommen.
Er hatte unter anderem Kontextverknüpfung, GitHub-Prüfung und Regressionstests
ergänzt. Diese Änderungen waren noch nicht im laufenden Build von 21:34.
Sie wurden erhalten und zusammen mit den hier beschriebenen Korrekturen integriert.

## Validierung und Betrieb

Fokussierte Prüfungen bestanden:

| Prüfung | Ergebnis |
| --- | --- |
| `test-session-launch.ts` | 47/47 |
| `test-remote-administration.ts` | 39/39, inklusive 501. Beleg und altem Replay nach Neustart |
| `test-remote-conversation.ts` | 49/49 |
| `test-conversation-service.ts` | 58/58, inklusive Fortsetzungsberechtigung ohne Freigabe des alten Threads |
| `test-coordinator-actions.ts` | 57/57 |
| `test-conversation-projects.ts` | 47/47, inklusive Teilfehlern und unveröffentlichten privaten Prompts |
| Electron/Playwright `--project-profile-only` | 12/12, native Fixture-Argumente, Tastatur, Übernahmefehler und Retry |
| Electron/Playwright `--projects-only` | 22/22, Anlage/Start, Antwortverlust, Fragen/Ergebnis, Reload, 390/800 px |
| Isolierter Build | Drei TypeScript-Projekte und Desktop-/Mobile-Produktionsbuild bestanden |

Die Browser-Gegenprobe fand zwei tatsächliche Lücken: Kontextfortsetzung nach
Reload verlor die Profilauswahl; Fragen eines bereits gestarteten Auftrags waren
nach der eigenen Scope-Änderung gesperrt. Beide korrigiert und positiv nachgeprüft.
Weitere anfängliche Testfehler waren ein zu enger Button-Selektor, Windows-
Zeilenenden und die falsche Annahme `managed:true`: Es ist ausdrücklich ein
SingleTask (`phase:manual`, `managed:false`) über den verwalteten Launcher.
Kein bezahlter Modellaufruf; native Protokollpartner waren lokale Fixtures.
Screenshot-Evidenz: `test-results/main-agent-planning/conversation-project-start-390.png`
und `test-results/remote/project-collapsed-takeover-error.png`.

ADE-Codecommit: `d24bd2b` auf `main`, bei Aktivierung sauberer Arbeitsbaum.
Aktiviert am **25.09.2026, 23:51 CEST** über
`pnpm activate -Label TabletRecovery -SkipGate -DeferVerification -Force`.
Die Aktivierung führte erneut alle drei Typprüfungen und beide isolierten Builds
erfolgreich aus. Der vollständige Gate-/Hintergrundlauf wurde bewusst aufgeschoben.

- Neuer Prozess **64576**, Source **`3af05ee33f39748e1815`**; `app ready`
  um 21:51:11 UTC und Listener **127.0.0.1:4317** im selben Prozess bestätigt.
- Alter ADE-Prozess 41220 und die beiden vorherigen Codex-Prozesse 86148/75068
  sind beendet. Die Quellarbeit bleibt in den oben genannten Commits erhalten.
- Profilsicherung:
  `C:\Users\Adi.Muff\ADE-Backups\Activate-TabletRecovery-20260925-235103`.
  Vorheriger Build in `out.prev`; Rückfall über `pnpm activate -Rollback`.
- Die ursprünglichen **500** Aktionsbelege wurden beim Neustart bytegenau
  erhalten (Hashvergleich mit Backup). Die erhöhte Kapazität benötigt keinen
  Reset oder Verlust alter Wiederholungsschlüssel.
- Aktivierungsbeleg: `test-results/activations.jsonl`, Label `TabletRecovery`,
  `head:d24bd2b`, `dirtyFiles:0`, `verificationDeferred:true`.
Der vollständige aktuelle `pnpm verify` und der persönliche Tablet-Test sind
weiterhin offen; kein unbelegtes Versprechen vollständiger Produktabnahme.

Grenzen: 10.000 Remote-Belege sind endlich. Der getrennte Gesprächsaktionsspeicher
bleibt auf 256 Aktionen / 1.024 Belege / 4 MiB begrenzt. Sichere Aufbewahrung mit
Schlüsselepochen ist ein eigener Folgeauftrag; Belege werden niemals still entfernt.
Private GitHub-Anlage wird mit simulierten API-Antworten geprüft, nicht durch
Erzeugen eines zusätzlichen echten GitHub-Repositories. Andere Agentanbieter und
automatische Folgeaufträge sind kein Teil des kombinierten Codex-Auftrags.

## Einstieg in der nächsten Session

1. Tablet-Seite nach der ADE-Aktivierung neu laden. Im Projektstart auf den
   sichtbaren Profilnamen mit „Bypass“ achten; Rhino weiter auf `master` öffnen.
2. Knuckles: `AGENTS.md`, `PROJECT.md`, `docs/HANDOFF.md`, dann `docs/PLAN.md` lesen.
   Als Nächstes manuellen Hör-/Oberflächentest und danach Lua-Meilenstein B angehen.
3. Rhino: `AGENTS.md`, den obersten Abschnitt in `CONTEXT-HANDOFF.md` und
   `docs/WORKBENCH-GOAL-P9-P2-P7.md` lesen. Zuerst den vorhandenen Dokumenthelfer
   in `workbench-client.ts` einbinden und P2 abnehmen, erst danach P7 beginnen.
4. ADE: diese Datei und `docs/CONVERSATION_PROJECT_CREATION.md` lesen. Ein neues
   Projektgespräch öffnen oder alten Kontext fortsetzen, ein Projekt samt
   Erstauftrag vorschlagen lassen, Dateien/Profil ansehen und den Startbutton
   bestätigen. Belegte Ergebnisse auf der Auftragskarte prüfen.
5. Verwaltete Aufträge sind separate Workspaces. Ihre Ergebnisse erst prüfen und
   über ADE integrieren; nicht aus einer laufenden CLI auf einen Commit im
   ursprünglichen Checkout schliessen. Die beiden oben genannten Recovery-Commits
   sichern dagegen ausdrücklich die bereits vorhandene direkte Tablet-Arbeit.
