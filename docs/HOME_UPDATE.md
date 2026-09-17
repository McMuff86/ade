# ADE zu Hause aktualisieren

Ein Pull dieses Repos aktualisiert den Programmcode. Deine ADE-Projekte,
Profilkonfiguration und Projektdateien bleiben auf deinem Heimrechner.
Der leere Projektkatalog eines anderen Rechners wird nicht mit Git übertragen.

ADE speichert seine Konfiguration unter Electron-`userData` in `ade/config.json`.
Die neue Betreuung und die Gespräche liegen daneben in `supervision.json` und
`conversations.json`. Bestätigte Codex-Aufträge behalten ihre Eltern-/Kindbelege
in `conversation-actions.json`; diese Datei bei einer Profilsicherung ebenfalls
erhalten. Diese Dateien liegen ausserhalb des Source-Repos. Verwende
zu Hause denselben Windows-Benutzer und dasselbe ADE-Profil wie bisher; ein
explizites `ADE_USER_DATA_DIR` muss auf den bisherigen Profilordner zeigen.

Für einen Start direkt aus dem Quellcode:

```powershell
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

ADE vor dem Start der neuen Version beenden. Laufende CLI-Prozesse sind keine
gespeicherten Projektregistrierungen und werden durch Git nicht übertragen.
Die neuen ADE-Gespräche setzen bestätigte Schritte erst beim nächsten bewussten
Senden fort; unbestätigte Schritte werden nicht automatisch wiederholt.

Falls deine Startmenü-Verknüpfung auf einen separaten Release-Ordner unter
`dist/...` oder eine installierte ADE-Version zeigt, aktualisiert ein Pull
diesen Build nicht. Dafür muss auch der Release gebaut und der Startweg auf
ihn umgestellt werden. Das vorhandene Benutzerprofil wird dabei beibehalten.
Ein Commit/Push allein aktiviert keinen persönlichen Release.

Die erste neue globale Gesprächsanbindung benötigt nativ unter Windows
Codex CLI 0.154.0 und ein Profil mit ausdrücklich gewähltem Modell und Reasoning.
Für die neuen bestätigten Aufträge ein **Neues ADE-Gespräch** beginnen; alte
native Unterhaltungen behalten ihre frühere Werkzeugversion. Globale MCP-
Anbindungen werden nur für den eingeschränkten Koordinatorprozess deaktiviert,
ohne die globale Codex-Konfiguration zu ändern. [Erster Tablet-Test](TABLET_CODEX_TEST.md).
Die bestehenden Projektterminals behalten ihre eigenen Laufzeitprofile.
Aktueller Funktionsumfang und offene Abnahmen: [Umsetzung](MAIN_AGENT_IMPLEMENTATION.md).
