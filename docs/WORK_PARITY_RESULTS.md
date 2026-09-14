# Desktop/Tablet Work und Profil-Einstellungen

Benutzerauftrag vom 14. September 2026: dieselben Profilmöglichkeiten am PC,
Work auch auf dem Desktop, anschließend Commit/Push und persönlicher Neustart.

- Normaler Agent-Einstellungsdialog: gemeinsamer Anweisungs-/Markdown-Editor,
  Vorschau und Agent-Stimme; bestehende Profilwerte bleiben beim Speichern
  anderer Felder erhalten.
- Desktop Work: gleiche Reiterfolge wie Mobile, Suche, Projekt-/Agent-/Statusfilter,
  Run-Bericht, Graph-Wechsel, Agent-Profil, neue Aufgabe und neuer Run.
- Fokus, Escape, Wiederherstellung, kompakte Fenster und unveränderte
  Auftragsschlüssel beim Wiederholen werden in Electron geprüft.

`test-agent-settings-profile-electron.ts` prüft reale Speicherung in isolierten
ADE-Daten. `test-work-electron.ts` erstellt echte Katalog-/Run-Einträge; der
beendete Runstatus und Aufgabenversand sind instrumentierte IPC-Fixtures.
Dieser UI-Test startet keine echte CLI und belegt keine zusätzliche
Runtime-Unterstützung. Die vorhandenen Integrationsprüfungen bleiben maßgeblich.

Die ersten fokussierten Läufe bestehen (20 Work-, 7 Profileinstellungs-Prüfungen).
Der erste vollständige Lauf bestand TypeScript, 56 Suiten / 2.558 Checks, Build
und die vorhergehenden UI-Suiten, hielt aber im großen Terminal-Test an zwei
zu frühen Zustandsabfragen an. Einzelmessungen zeigten eine noch nicht
verarbeitete Viewport-Größenänderung und den noch ausstehenden ConPTY-Exit
nach der Schließbestätigung. Die Testhelfer warten nun auf die übernommene
Viewport-Höhe bzw. das Ende der konkret neu erstellten Sitzung und prüfen
danach weiterhin die ursprünglichen Sichtbarkeits-/Identitätsbedingungen.
Logs: `work-parity-verify.log`, `work-parity-project-diagnostic.log`,
`work-parity-home-diagnostic.log` unter `test-results/`.

Abnahme abgeschlossen: die fokussierten Wiederholungen bestehen mit 28
Projekt- und 40 Terminal-Home-Prüfungen. `pnpm verify` endet mit Exit 0:
TypeScript, 56 Suiten / 2.558 Checks, Produktionsbuild und sämtliche
Electron-/Browser-Prüfungen einschließlich 20 Work-, 7 Profileinstellungs-,
202 großer Terminal- und 22 visueller Prüfungen. Die beiden vorher
fehlgeschlagenen Bedingungen bestehen im vollständigen Lauf.
Nachweis: `test-results/work-parity-verify-final.log`.

Persönlich seit 06:49 Uhr aktiviert: Produktcommit
`8c6dd633abd14632c2ad744b7cf8596ea88dcb8b`, neuer Main-PID 21576,
Release `test-results/operator-work-parity-20260914-064933`.
Work ist sichtbar und die private Mobile-Adresse liefert HTTP 200 mit dem
Release-Asset `/assets/index-C1qEXNl6.js`. Alle Agent-/Repository-Datensätze
und die verschlüsselten Credentials blieben beim Neustart unverändert.
Backup und vollständige Aktivierungsnachweise stehen in `HANDOFF.md`.
