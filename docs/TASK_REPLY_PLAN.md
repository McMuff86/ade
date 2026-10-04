# Auf einen beendeten Auftrag antworten

Stand: 4. Oktober 2026. Beauftragt und umgesetzt am selben Tag nach dem
Tablet-Befund „Auftrag endet mit Rückfrage“ ([ROADMAP](ROADMAP.md)). Technischer
Vertrag: [ARCHITECTURE](ARCHITECTURE.md), „`RunCoordinator.replySingleTask`“;
Bedienung: [User-Guide](USER_GUIDE.md), „Auf einen beendeten Auftrag antworten“.

## Entscheidungen des Benutzers

| Frage | Entscheid |
|---|---|
| Wo erscheint die Antwort? | Als weitere Aufgabe im selben Run |
| Welche Agenten? | Claude Code und Codex |
| Wie lange ist Antworten möglich? | Solange der Arbeitsordner unverändert zugeordnet ist |

## Umgesetzt

- Antwortfeld im Bericht am PC und unter **Ergebnis** am Tablet; sichtbar nur,
  wenn der Host eine Fortsetzung für möglich hält (`reply.available`).
- Befehl `runTask:reply` (Desktop-IPC) und `POST /api/v1/runs/:runId/reply`
  (Tablet) mit `runs:write`, Gerätesignatur, Pflicht-Idempotenzschlüssel und Audit.
- Claude Code läuft bei Einzelaufträgen unter einer von ADE vergebenen
  Sitzungs-ID und wird mit `--resume` fortgesetzt. Codex meldet seine Thread-ID
  selbst; die Antwort nutzt `codex exec … resume` beziehungsweise bei erlaubten
  Rückfragen `thread/resume` im App-Server.
- Fail-closed: laufende oder offene Arbeit im Run, nicht letzter Auftrag,
  geänderter Agent oder eigener Startbefehl, fehlende Unterhaltungs-ID,
  geänderter Arbeitsordner (beim Start geprüft; die Aufgabe scheitert sichtbar).

## Nachweise (Linux)

| Nachweis | Ergebnis |
|---|---|
| Vertragssuite `task-reply` | 37/0: ID-Vergabe, Ablehnungen, Idempotenz, Privatsphäre, Startbefehle, Negativkontrollen |
| `security` | 297/0, Kanal validiert und in der Remote-Allowlist |
| Tablet-Browser (`remote-workspace-browser`) | 30/0: Feld erscheint nach Auftragsende, Tastatur, genau ein Start, selbe Unterhaltung, selber Run |
| Desktop-Electron (`mobile-electron`, `linux-agent-tablet`) | 46/0 und 61/0: Antwort im Bericht setzt über den echten Startpfad den aufgezeichneten Codex-Thread im App-Server fort; Fokus bleibt im Dialog |

## Grenzen und offen

- Nur Einzelaufträge („Agent beauftragen“), keine Mehr-Agenten-Runs.
- Aufträge von vor dieser Funktion und Agents mit eigenem Startbefehl sind nicht fortsetzbar.
- Die Startbefehle `claude -p --session-id/--resume` und `codex exec … resume`
  sind als Befehlszeilen geprüft und gegen die installierten CLIs mit einer
  unbekannten ID auf ihre Argumentform getestet. Ein echter Lauf mit Modell
  steht aus: **Abnahme durch den Benutzer am Tablet.**
- Die Übersicht bietet weiterhin „Arbeit prüfen“; eine eigene Aktion
  „Antworten“ direkt in der Übersicht ist nicht gebaut.
- Windows: Vertragssuiten laufen in CI; die Oberfläche ist nur unter Linux gemessen.
