# ADE-Dokumentation

Stand: 2026-09-11. Beginne je nach Anliegen hier:

| Anliegen | Dokument |
|---|---|
| ADE zum ersten Mal nutzen | **[User-Guide mit Screenshots](USER_GUIDE.md)** |
| Geführte Einrichtung und Mobile-Status: Umsetzung und Abnahme | [Onboarding-Tasks](ONBOARDING_GOALS.md) |
| Tablet verbinden / Verbindung untersuchen | [Mobile Connect Guide](goal8/MOBILE_CONNECT_GUIDE.md) |
| Terminalrechte, Dateien und erweiterte Sitzungsauswahl | [Remote Terminal Guide](REMOTE_TERMINAL_GUIDE.md) |
| Aktueller Funktionsumfang und Grenzen | [STATUS](STATUS.md) |
| Projekt → Branch → CLI → Git und Ergebnisdateien: Umsetzung und Abnahme | [Projekt-Workflow-Tasks](PROJECT_WORKFLOW_GOALS.md) |
| Was als Nächstes verbessern? | [Produktreview vom 10. September](research/ADE_PRODUCT_REVIEW_2026-09-10.md) |
| Aktuelle Übergabe / Betrieb | [HANDOFF](HANDOFF.md) |
| Geplante Tracks und Abnahmekriterien | [ROADMAP](ROADMAP.md) |
| Welche Dokumente sind noch aktuell? | [Dokumentationsaudit](DOCUMENTATION_AUDIT.md) |

## Verbindliche Produkt- und Engineering-Verträge

| Thema | Einstieg |
|---|---|
| Produktmodell | [SPEC](SPEC.md) |
| Architektur, IPC, Host API, Daten- und Sicherheitsgrenzen | [ARCHITECTURE](ARCHITECTURE.md) |
| Repositorys und Agent-Arbeitskopien | [Scopes](REPOSITORY_SCOPES_PLAN.md), [Git-Abgleich](REPOSITORY_SYNC_PLAN.md), [Inspector](REPOSITORY_INSPECTOR_PLAN.md) |
| Verifizierte Veröffentlichung | [Publishing](VERIFIED_PUBLISHING_PLAN.md) |
| Plattformen | [Multiplatform](MULTIPLATFORM_PLAN.md) |
| Privater Remote-Zugang und spätere Grenzen | [Remote Control](REMOTE_CONTROL_PLAN.md), [Host API](goal7/HOST_API_FOUNDATION_PLAN.md) |
| Profil-/Workspace-Export | [Workspace Bundles](WORKSPACE_BUNDLES.md) |
| Dynamische Desktop-Modellauswahl | [Runtime Model Selection](RUNTIME_MODEL_SELECTION.md) |
| Tablet-Projektstart und Projekteinstieg | [Project Start](TABLET_PROJECT_START.md), [Project Entry](PROJECT_ENTRY.md) |
| Eigener Workspace und Assistenten | [Session Workspace](SESSION_WORKSPACE_GOALS.md), [Assistant Access](ASSISTANT_ACCESS.md) |

Ein Dateiname mit `PLAN` oder `GOALS` bedeutet nicht automatisch „unimplementiert“.
Manche Dateien enthalten weiterhin geltende Verträge bereits gelieferter Funktionen.
Für den aktuellen Zustand immer STATUS und den jeweiligen Nachweis daneben lesen.

## Ausführbare Nachweise und datierte Recherche

`*_RESULTS.md`, [Goal 6](goal6/RESULTS.md) und dessen
[F3/F4-Retests](goal6/F3F4_RETEST.md) dokumentieren eine bestimmte Messung mit
Plattform, Commit und Grenzen. Frühere Checkzahlen widersprechen einem späteren
grünen Lauf nicht; sie sind dessen Vorgeschichte. Ergebnisdateien werden bei
weiterer Entwicklung nicht pauschal gelöscht oder „aktuell umgeschrieben“.

[Juli-Professionalisierungsreview](PROFESSIONALIZATION_REVIEW_2026-07-26.md)
enthält noch offene Nachprüfungen; erledigte Punkte sind markiert.
[Orchestrierungsrecherche](research/agent-orchestration/README.md),
[Hermes-Memory-Bericht](reports/hermes-memory.md) und
[Superset-Bericht](reports/superset.md) sind datierte Quellen, keine Zusage zum
aktuellen Verhalten externer Produkte.

Historische Übergaben, frühere Status-/Roadmap-Schnappschüsse und der abgelöste
Designreview liegen in [archived](archived/README.md). Das Archiv ist keine
Arbeitsanweisung für den nächsten Agenten.
