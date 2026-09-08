# Workspace und Terminal am Tablet freigeben

Am Heim-PC zuerst laufende Aufgaben abschliessen und ADE vollständig beenden
(bei Tray-Betrieb dort **Beenden** wählen). Im ADE-Repository den neuen Stand
mit `git pull --ff-only` laden, dann `pnpm install --frozen-lockfile` und
`pnpm build` ausführen und mit `pnpm start` starten. Wenn Git lokale Änderungen
meldet, diese zuerst prüfen und erhalten. Am Tablet die Seite neu laden.
Die bestehende Kopplung bleibt erhalten; neue Rechte sind zunächst gesperrt.
Die Schritte gelten für den nativen Windows-Start aus dem Repository.

In **Settings → Verbundene Geräte** beim eigenen Tablet nur die gewünschten
Rechte aktivieren und **Verwaltungsrechte speichern** wählen:

| Freigabe | Ermöglicht |
|---|---|
| Workspace-Dateien und Git-Diffs lesen | Dateien, Suche, Vorschau, Branch, letzte Commits und Änderungen |
| Kleine Workspace-Textdateien bearbeiten | Zusätzlich zum Leserecht vorhandene Textdateien speichern |
| Interaktive Terminals steuern | Shell oder konfigurierten Agenten starten und interaktive Eingaben senden |
| Agent-Namen, Rollen und Profilbilder bearbeiten | Profil ändern, Foto hochladen oder entfernen |

Im Agent-Workspace lassen sich Projekt und die Reiter **Dateien**,
**Git-Änderungen**, **Terminal** und **Agent-Profil** wählen. **Aufgabe vergeben**
bleibt für verwaltete Aufgaben verfügbar. Ein fehlender Workspace kann unter
**Verwalten → Projekte & Workspaces** vorbereitet werden; dafür ist weiterhin
die bisherige Agent-/Projekt-Verwaltungsfreigabe nötig.

Im Dateireiter eine Datei öffnen und **Bearbeiten** wählen. Speichern ist
explizit; bei zwischenzeitlichen Änderungen werden Entwurf und aktueller Stand
verglichen. Erst nach eigener Zusammenführung den aktuellen Stand als Basis
bestätigen und erneut speichern. Laufende Terminal-/Agent-Sitzungen in diesem
Workspace müssen vor dem Speichern beendet sein. Bis zu 20 Datei- und
20 Profilentwürfe bleiben während des Seitenbesuchs erhalten; Neuladen oder
Trennen verwirft sie. Unterstützt sind vorhandene UTF-8-Textdateien bis 24 KiB.

Unter **Agent-Profil** Name/Rolle ändern oder ein PNG-, JPEG- oder WebP-Foto
auswählen. ADE verkleinert es vor dem Upload auf maximal 256×256 Pixel/32 KiB.
**Profil speichern** übernimmt es auch in der Desktop-App. Ist der Agent gerade
in einem verwalteten Run belegt, lässt sich sein Profil nach dessen Abschluss
bearbeiten. Namens-/Rollenänderungen aktualisieren auch seine ADE-Rollenanweisung.

## Terminal verwenden

1. In ADE am PC **Settings → Verbundene Geräte** öffnen und Geräte aktualisieren.
2. Beim eigenen Tablet **Interaktive Terminals steuern** aktivieren und
   **Verwaltungsrechte speichern** wählen. Für Dateien/Diffs zusätzlich
   **Workspace-Dateien und Git-Diffs lesen** freigeben.
3. Am Tablet ADE öffnen, den Agenten auswählen und das richtige Projekt wählen.
   Falls noch kein Workspace besteht: unter **Verwalten → Projekte & Workspaces**
   vorbereiten. Im Workspace **Terminal** öffnen.
4. Eine vorhandene Sitzung auswählen und **Eingabe übernehmen** drücken oder
   **Shell öffnen** / **Agent starten** wählen. Der Agent verwendet sein am PC
   konfiguriertes Startprofil. Text über **Text und Enter senden** abschicken;
   die Tastenleiste stellt Enter, Tab, Escape, Ctrl+C und Pfeiltasten bereit.
5. **Eingabe freigeben** übergibt die Steuerung an den Desktop. **Sitzung beenden**
   beendet nach Bestätigung den Prozess. Das Schliessen der Tablet-Ansicht
   beendet die Sitzung nicht. Ohne Lebenszeichen läuft die Freigabe nach
   30 Sekunden aus. Am Desktop ist eine sofortige Übernahme möglich.

Die Shell läuft mit den Rechten des angemeldeten Windows-Benutzers. Der
Workspace ist ihr Startverzeichnis, keine Sandbox. Die Freigabe daher nur
dem eigenen gekoppelten Gerät geben. Tailscale allein erteilt keine ADE-Rechte.
Zum Widerruf den Haken entfernen und speichern oder das Gerät entfernen.
Weitere Eingaben und Ausgabezugriff werden gesperrt; gestartete Prozesse
laufen weiter und können am Desktop beendet werden.

Bei Verbindungsabbruch wieder dieselbe Sitzung auswählen. Eine unbestätigte
Eingabe wird nicht automatisch wiederholt. **Eingabestatus prüfen** liest die
Bestätigung vom PC. Bleibt sie unklar, Ausgabe prüfen und die Steuerung
freigeben, bevor neue Eingaben erfolgen.

Die erste Ausgabeansicht ist eine aus dem Terminalzustand erzeugte Textansicht
mit begrenztem Verlauf. Bekannte Zugangsdaten und Host-Pfade werden redigiert;
Farben, Mausbedienung und Dateiübertragung im Terminal sind nicht enthalten.
Verwaltete Task-Sitzungen und Login-Sitzungen werden nicht interaktiv freigegeben.
Ausführung wird zunächst nur auf nativem Windows geprüft.
