# Projekt aus Gesprächskontext — 25. September 2026

Adi hat Gespräch → Agentenvorschlag → Projektanlage inklusive AGENTS.md und
anschliessendem Arbeitsbeginn beauftragt. Der erste Testbuild um 21:34 unterstützte
nur die Anlage. Der Stabilisierungsschritt ergänzt den bestätigten Erstauftrag
und Direct/Observe → Koordinieren für vorhandene Projekte.
Aktueller Prüf-/Betriebsstand: [Tablet-Recovery](TABLET_RECOVERY_2026-09-25.md).

## Vertrag

- Projektgespräche mit `ade-project-actions-v3` erhalten `ade_prepare_project`.
  Der Vorschlag enthält Name (80 Zeichen), Kontext (8.000), AGENTS.md (16.000)
  und optional den Namen eines privaten GitHub-Repositories (100). `start:null`
  legt nur an; `start:{agentId,prompt}` (Prompt bis 32.000 Zeichen, nur in main)
  übergibt anschliessend einen ersten verwalteten Codex-Auftrag. Profil und
  Berechtigungsmodus werden in der Vorschau sichtbar, der Erstauftrag steht auch
  in PROJECT.md. Der Button heisst dann „Projekt anlegen und Arbeit starten“.
- Vorschläge bleiben im vorhandenen begrenzten ActionStore. Ein Modellaufruf
  erzeugt keine Projektdateien. Erst die Bestätigung der gespeicherten Action-ID
  führt den Vorschlag aus; Vorschau und Button sind auf PC/Tablet gemeinsam.
- ADE verwendet die vorhandene native Projekterstellung und den konfigurierten
  Projektstamm (sonst den bisherigen ADE-Projektordner). Vorhandene Projektnamen
  werden abgelehnt, vorhandene Dateien nie überschrieben. Neue PROJECT.md und
  AGENTS.md werden exklusiv erstellt und committed, damit spätere Worktrees die
  Anweisungen übernehmen. Betreuungsmodus ist anschließend `coordinate`.
- Ein optionales GitHub-Repository entsteht im angemeldeten persönlichen Konto
  ausdrücklich privat. ADE überprüft die API-Antwort und Sichtbarkeit, setzt
  `origin` und pusht den initialen Stand. Organisationen/Übernahme vorhandener
  Remote-Repositories sind nicht Teil dieses Ablaufs. Ohne GitHub-Angabe bleibt
  das Projekt lokal. Ohne `start` wird kein Implementierungsauftrag gestartet.
- Für vorhandene Projekte darf `ade_prepare_task` mit `coordinate:true` einen
  bestätigten Wechsel von Direct/Observe nach Koordinieren einschliessen. Der
  bestehende Checkout/Branch bleibt bestehen; der verwaltete Auftrag arbeitet in
  seinem eigenen Workspace. Ein vorheriger manueller Moduswechsel entfällt.
- Neue Dateien/Git-Effekte laufen im exklusiven Workspace-Gate. Pfade werden in
  main erzeugt und mit der bestehenden Link-/Identitätsdisziplin geprüft.
  Der Dispatchbeleg liegt vor dem ersten Effekt auf Platte; Fehler/Absturz
  bleiben `uncertain`, ohne automatisches Wiederholen oder Aufräumen. Der
  abschließende Betreuungsbeleg kann einen verlorenen Erfolgsbeleg wiederfinden.
  Bei kombiniertem Start sind zusätzlich der exakte Kindauftrag und sein
  Dispatchbeleg erforderlich. Teilanlage/Teilausführung werden nicht wiederholt;
  ein bereits übergebener Auftrag bleibt für Ergebnisse/Rückfragen sichtbar.
- Host-Routen bleiben bei `AdeApplicationService`, Gerätebeweis, All-Resource-
  Zugriff, `workspace:read`, `runs:write`, Audit und Idempotenz. Projektbestätigung
  braucht zusätzlich `catalog:write`, `workspace:write` und bei GitHub
  `projectGit:publish`. Keine generischen IPC-Freigaben werden erweitert.

## Verlauf und Fortsetzung

`ade_conversations` sucht gespeicherte Projektgespräche; `ade_conversation_context`
liest sie begrenzt und seitenweise. Plaudergespräche werden nicht eingemischt.
Historischer Inhalt ist Kontext, niemals eine neue Ausführungsfreigabe.

Aktuelle globale Leserechte erlauben am Tablet auch alte Verläufe und
Aktionsbelege, wenn die native Projektbindung inzwischen veraltet ist. Das
Profil muss weiterhin zugänglich sein. Schreibzugriff auf den alten nativen
Thread bleibt gesperrt. Nach einer Projektanlage bietet „Mit diesem Kontext
weiterreden“ einen neuen nativen Kontext mit einem vorbereiteten Verweis auf
den vorherigen Verlauf; der Benutzer sendet diesen Text ausdrücklich ab.
Bestehende Gespräche brauchen wegen des neuen Werkzeugvertrags ebenfalls einen
frischen nativen Kontext.

## Historischer erster Testbuild und aktueller Nachweis

Der erste reine Anlage-Build wurde am 25.09.2026 um 21:34 CEST aktiviert: PID `41220`, Source
`ad52ed19f44b0e39f7a8`, Desktop bereit und mobiler Listener bestätigt. Alle drei
Typprüfungen und beide Produktionsbuilds bestanden. Keine Funktionssuite oder
Playwright-Automation ausgeführt; der physische Tablet-Test steht noch aus.

`pnpm activate -Label ConversationProjects -SkipGate -DeferVerification -Force`
führt nur Typprüfung und isolierten Desktop-/Mobile-Build aus, sichert auch
`conversation-actions.json`, beendet ADE geordnet und behält `out.prev`.
`-DeferVerification` protokolliert den Verzicht auf den sonst automatisch
gestarteten Hintergrund-Testlauf. Tests werden nicht als bestanden ausgegeben.

Inzwischen fokussiert nachgewiesen: lokale Anlage mit vollständigen Dateien,
privates GitHub-API-Protokoll mit Fixtures, doppelte Bestätigung/Reload, verlorene
Antwort, Teilfehler/Neustart, Rechteentzug, historischer Kontext und Fortsetzung;
Tastatur/Fokus, schmale Tabletansicht und kombinierter Auftrag bis zum Ergebnis.
Scope-/Toolanzahl-Tests wurden an den geänderten Verlaufsvertrag angepasst.
Aktivierung, genaue Zahlen und verbleibende Grenzen stehen im
[Recovery-Beleg](TABLET_RECOVERY_2026-09-25.md). Offen: physischer Tablet-Test,
echte neue private GitHub-Anlage und vollständiger aktueller `pnpm verify`.
