# Nutzung sichtbar machen: Kontolimits, Tokens des Tages, Tokens je Projekt und Sitzung

Stand 23. September 2026. Anlass: Adi wollte auf dem Tablet und am PC sehen,
wie viel Tokens verbraucht sind und wie weit die Abo-Limits von Codex und
Claude ausgeschöpft sind, ohne in jeder CLI `/status` oder `/usage` zu tippen.
Verwandt: [USAGE_AND_COST_GOALS.md](USAGE_AND_COST_GOALS.md) (Ziele der
Nutzungserfassung), [USAGE_SOURCE_RESULTS.md](USAGE_SOURCE_RESULTS.md) (was die
CLIs lokal tatsächlich liefern), [ARCHITECTURE.md](ARCHITECTURE.md) („ADE host
API“ zur Route `/api/v1/usage/overview`).

## Was heute schon da ist

| Punkt | Inhalt | Stand |
| --- | --- | --- |
| 1 | Übersichtskachel „Nutzung“ auf PC und Tablet: engstes Kontofenster als Zahl, aufklappbares Panel mit Kontofenstern je Anbieter und Tokens des Tages aus nativen ADE-Sitzungen; Terminal-Statusleiste „Nutzung anzeigen · Codex ▾“ | umgesetzt, Commit `d19cfe1` |
| 2 | Claude-Kontolimits über die Anmeldung der Claude-CLI, nur mit Freigabe unter Einstellungen → Nutzung (Standard aus) | umgesetzt, gleicher Commit; Adi hat zugestimmt |
| 3 | Tokens je Projekt und je Sitzung in der Projektübersicht | **offen, unten ausgearbeitet** |

## Punkt 3: Tokens je Projekt und Sitzung

### Was der Nutzer sehen soll

- **Projekte-Raum (PC) und Projekte-Ansicht (Tablet):** auf jeder Projektkarte
  eine Zeile „Nutzung: 1,4M Tokens · 12 Sitzungen · 7 Tage“, mit Umschalter
  Heute / 7 Tage / 30 Tage. Tippen öffnet eine Aufschlüsselung nach Anbieter
  (Codex, Claude Code, Grok) und nach Sitzung.
- **Sitzung & Workspace im Terminal:** in der Sitzungsliste je Sitzung die
  Tokens dieser Sitzung (Eingabe, Ausgabe, Cache) und die Modelle, die darin
  liefen; für die offene Sitzung gibt es das heute schon im Nutzungsbereich der
  Statusleiste („Verbrauch dieser Sitzung“).
- **Aufschlüsselung (Panel oder Dialog):** Tabelle Sitzung · Agent · Anbieter ·
  Modell(e) · Start · Eingabe · Ausgabe · Cache gelesen · Cache geschrieben ·
  Kosten (nur wenn der Anbieter Kosten meldet oder ADE sie aus konfigurierten
  Preisen schätzt, mit Kennzeichnung „geschätzt“).
- Ehrlichkeit wie bisher: nur Sitzungen, die über ADE nativ gestartet wurden,
  werden gezählt. Fortgesetzte Fremd-Sitzungen, Forks und Unteragenten sind
  nicht vollständig erfasst; das steht als Hinweis dabei. Abo-Prozente sind
  Kontowerte, keine Projektwerte, und tauchen hier nicht auf.

### Woher die Zahlen kommen

Das Nutzungsjournal (`main/usage/UsageJournal.ts`) hält bereits alles, was
Punkt 3 braucht: jede native Sitzung (`UsageSession`) trägt `provider`,
`repositoryId`, `agentId`, `terminalSessionId`, Start- und Endzeit; jede
gemessene Anfrage (`UsageFact`) trägt Tokenzähler je Feld, Modell, Zeitpunkt
und, wo vorhanden, Kosten mit Herkunft (`provider-reported`,
`provider-estimate`, `configured-estimate`). Quellen je Anbieter:

- Codex: Rollout-Datei der Sitzung unter `CODEX_HOME/sessions` (Token-Snapshots).
- Claude Code: OpenTelemetry-Ereignisse `claude_code.api_request`, die ADE beim
  Start der Sitzung auf einen lokalen Empfänger lenkt.
- Grok: Sitzungsdatei unter `GROK_HOME`.

Neu wäre nur die Verdichtung: `NativeUsageService.projectConsumption(range)`
und `sessionConsumption(terminalSessionId)` nach dem Muster von
`providerConsumption` (Summen je Feld, `null` bleibt `null`, kein Erraten).
Zeitfenster zählen nach dem Zeitpunkt der Anfrage, nicht nach Sitzungsstart,
damit eine lange Sitzung über Mitternacht richtig verteilt wird.

### Schnittstellen

- Desktop: IPC `usage:projects` (Lesekanal, `read`, keine Prozessstarts) →
  `{ range, projects: [{ repositoryId, tokens, sessions, providers: [...] }], sessions: [...] }`.
- Tablet: `POST /api/v1/usage/projects` mit `{ range }`, Freigabe
  `workspace:read`, Ergebnis auf die Projekte beschränkt, die das Gerät sehen
  darf (`resourceAccess`), Namen über `redactForWire`. Kein neuer Scope nötig.
- Die Zahlen sind reine Summen; Prompts, Pfade oder Kontodaten sind im Journal
  nicht enthalten und können daher auch nicht auf den Wire gelangen.

### Grenzen, die im Dokument und in der Oberfläche stehen müssen

- Nur ADE-gestartete native Sitzungen. Was direkt in einem fremden Terminal
  läuft, fehlt.
- Cache-Tokens dominieren bei Claude oft die Summe; die Aufschlüsselung zeigt
  darum Eingabe, Ausgabe und Cache getrennt statt einer Gesamtzahl allein.
- Kosten nur mit Herkunftsangabe; ohne Preisangabe des Anbieters bleibt das
  Feld leer statt geschätzt.
- Das Journal ist begrenzt (50 000 Anfragen, 4096 Sitzungen, 32 MiB); ältere
  Zeitfenster können unvollständig sein und werden dann als „unvollständig“
  markiert.

### Umsetzung in drei Schritten

1. Verdichtung im Main-Prozess plus Einheitstests (`test-native-usage-service.ts`):
   Summen je Projekt und Sitzung, Zeitfenster über Mitternacht, `null`-Felder,
   Journalfehler → „unvollständig“.
2. Projekte-Raum am PC: Nutzungszeile auf der Karte, Umschalter, Aufschlüsselung
   als Panel; Playwright-Deckung im Projekt-Electron-Ablauf.
3. Tablet: Route, Freigabe- und Redaktionstests (`test-remote-*.ts`), Anzeige
   in der Projekte-Ansicht und in „Sitzung & Workspace“; Browser-Suite.

Aufwand grob: Schritt 1 ein halber Tag, Schritte 2 und 3 je ein halber bis ein
Tag inklusive Tests und Doku.

### Offene Entscheidungen

- Standard-Zeitfenster auf der Karte: 7 Tage (Vorschlag) oder Heute.
- Ob Kosten auf der Karte erscheinen oder erst in der Aufschlüsselung
  (Vorschlag: nur Aufschlüsselung, um die Karte ruhig zu halten).
- Ob die Aufschlüsselung je Sitzung auch das Ausführungs-Backend (nativ/WSL)
  zeigt.
