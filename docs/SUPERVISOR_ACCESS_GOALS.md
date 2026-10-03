# Goal 35 — Eingeschränkter Zugang für Aufsichts-Sessions

**Status:** Am 3. Oktober 2026 vom Benutzer als eigenes Goal beauftragt; nicht
begonnen. Hervorgegangen aus Review-Punkt R8 zu Goal 34.6
([Host-Entscheid](HOST_ARCHITECTURE_DECISION.md), E1 und Abschnitt 10).
Hintergrund und Beobachtungen aus dem manuellen Betrieb:
[Standing-Supervisor-Notiz](research/agent-orchestration/STANDING_SUPERVISOR_2026-10-03.md).

## Ziel

Eine Aufsichts-Session darf ADE-Sitzungen beobachten und ihnen Aufträge geben,
aber nur mit dem Recht, das der Benutzer ihr ausdrücklich erteilt hat. Das gilt
für eine ADE-eigene Betreuung ebenso wie für eine externe Session, etwa eine
Orchestrator-Session in Cursor. Heute tippt der Benutzer diese Vollmacht als
Text in jede CLI-Sitzung, und es bleibt kein Beleg. Goal 35 macht daraus einen
geprüften, widerrufbaren und protokollierten Vertrag.

**Abgrenzung:** Goal 35 regelt Zugang und Delegation. Beobachtungsstrom,
typisierte Befunde mit Folgeaufträgen, Dateibesitz als Daten und der stehende
Doku-Prüfer aus der Notiz sind **nicht** Teil davon. Sie bleiben Vorschläge für
spätere Goals und werden aus realen Fällen abgeleitet.

## Feste Grenzen

- Eine Aufsichts-Session erhält nie den Prinzipal `desktop-local` (Goal 34.6, E5).
- Eine Session ohne Vollmacht erhält Nachrichten nur als Eingabe; ADE leitet
  daraus keinerlei Recht ab.
- Push, Remote-Aktionen, Löschen und `pnpm activate` können nicht delegiert
  werden.
- Eine Vollmacht erweitert nie die Rechte der empfangenden Sitzung. Insbesondere
  wird `REMOTE_COMMAND_CHANNELS` nicht erweitert, und es gibt keinen Zugriff auf
  PTY-, Dateisystem-, Konfigurations-, Host- oder Shell-Kanäle über den
  Aufsichts-Prinzipal.
- Prompts, Nachrichteninhalte und Begründungen erscheinen in der Renderer-Ansicht
  und auf dem Gerätedraht nur als Digest bzw. begrenzte, geschwärzte Zusammenfassung.

## Teilziele

### 35.1 — Vollmacht als Journal-Vertrag

- [ ] Datensatz für die Vollmacht (`DelegationGrant`): Aufsicht, betroffene
  Sitzungen, erlaubte Pfade und Branches, ausgeschlossene Aktionen,
  `grantedAt`/`revokedAt`. Erteilen und Widerrufen sind Journal-Ereignisse und
  werden in `RunArchive` und `applyRetention` mitgeführt.
- [ ] Erteilen und Widerrufen nur durch den Benutzer, auf Desktop oder Tablet;
  jede Änderung ist auditiert.
- [ ] Die empfangende Sitzung erhält die Vollmacht über den verwalteten
  Aufgabenkontext, nicht über Dateien im geleasten Repository.

Hängt nicht vom Host ab und kann vor Goal 34.6 H3 umgesetzt werden.

### 35.2 — Begrenzter Aufsichts-Prinzipal

- [ ] Eigener Prinzipal-Typ mit eigener Kennung, Scope-Liste und Audit, getrennt
  von `desktop-local` und von gekoppelten Geräten.
- [ ] Anbindung über den lokalen Host-Transport aus Goal 34.6 (H3) mit eigenem,
  widerrufbarem Token. Ein Agent in einem ADE-PTY erhält dieses Token nie
  automatisch.
- [ ] Jeder Befehl wird gegen die Vollmacht geprüft; ein Befehl ausserhalb
  davon wird abgelehnt und protokolliert.

Hängt von Goal 34.6 H3 ab.

### 35.3 — Durchsetzung am Commit

- [ ] Ein aufgezeichneter Commit einer bevollmächtigten Sitzung wird gegen die
  erlaubten Pfade und Branches geprüft. Eine Verletzung wird sichtbar gemeldet
  und nie stillschweigend durchgelassen.

## Abnahme

- Eine Session ohne Vollmacht erhält Aufsichts-Nachrichten nur als Eingabe;
  ADE protokolliert kein Recht.
- Mit Vollmacht: Ein Commit ausserhalb der erlaubten Pfade wird gemeldet.
  Negativkontrolle: Derselbe Commit innerhalb der Pfade wird nicht gemeldet.
- Push, Löschen oder Aktivierung über den Aufsichts-Prinzipal werden auch mit
  Vollmacht abgelehnt.
- Nach dem Widerruf werden weitere Befehle abgelehnt, und die Sitzung erhält
  keine Vollmacht mehr im Aufgabenkontext.
- Die Aufsicht überlebt das Schliessen des Desktops erst mit Goal 34.6 H3/H4.
  Bis dahin ist das als nicht unterstützt dokumentiert.

## Reihenfolge

35.1 kann jederzeit beginnen. 35.2 folgt nach Goal 34.6 H3, 35.3 nach 35.2.
Die Notiz empfiehlt, das manuelle Muster vorher etwa zwei Wochen zu betreiben
und Vollmachten, Konflikte und Folgeaufträge zu zählen. Diese Zählung ist die
Grundlage für die genauen Felder.
