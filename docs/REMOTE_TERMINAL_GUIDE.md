# Workspace und Terminal am Tablet freigeben

Stand: 2026-09-09. Für den vollständigen Einstieg mit Bildern den
[User-Guide](USER_GUIDE.md) verwenden. Diese Seite ergänzt Freigaben,
Dateigrenzen und erweiterte Sitzungsauswahl.

Der neue Einstieg **Neues Projekt → Mit Codex starten** und **Weiterarbeiten**
verwendet einen einmal am PC konfigurierten Projekt-Stammordner. Einrichtung und
Recovery: [TABLET_PROJECT_START.md](TABLET_PROJECT_START.md). Terminal- und
Auftragsentwürfe bleiben damit über Seitenneuladen erhalten; Datei-/Profilentwürfe
unterliegen weiterhin den unten beschriebenen Grenzen.

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
| Projekt-Workspaces ohne Agent-Profil öffnen | Vorhandenen nativen Checkout aus der neuen Projektordnerliste in ADE registrieren und öffnen; benötigt zusätzlich das Leserecht |
| Kleine Workspace-Textdateien bearbeiten | Zusätzlich zum Leserecht vorhandene Textdateien speichern |
| Interaktive Terminals steuern | Shell oder konfigurierten Agenten starten und interaktive Eingaben senden |
| Agent-Namen, Rollen und Profilbilder bearbeiten | Profil ändern, Foto hochladen oder entfernen |

Im Agent-Workspace lassen sich ein Projekt oder **Ohne Projekt · Eigener Workspace**
und die Reiter **Dateien**,
**Git-Änderungen**, **Terminal** und **Agent-Profil** wählen. **Aufgabe vergeben**
bleibt für verwaltete Aufgaben verfügbar. Ein fehlender Workspace kann unter
**Verwalten → Projekte & Workspaces** vorbereitet werden; dafür ist weiterhin
die bisherige Agent-/Projekt-Verwaltungsfreigabe nötig. Ohne Projekt verwenden
Dateien und Terminal den eigenen Agent-Ordner. Fehlt dieser noch, wird er erst
beim ausdrücklichen Öffnen einer Terminalsitzung angelegt. Danach **Workspace
aktualisieren** wählen. **Git-Änderungen** und **Aufgabe vergeben** benötigen
weiterhin ein Projekt. Ein vorhandenes Standardprojekt lässt sich im Dialog
für diese Sitzung abwählen, ohne die Agent-Einstellung zu ändern.

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
3. Für Projektarbeit **Projekte → Projekt → Workspace öffnen** wählen und danach
   unter **Arbeiten mit** die CLI auswählen. Für den persönlichen Assistenten ohne
   Projekt in **Overview** dessen **Terminal öffnen** verwenden.
4. Eine vorhandene Sitzung auswählen und **Eingabe übernehmen** drücken oder
   **Shell öffnen** / **[Agentname] öffnen** wählen. Der Agent verwendet sein am PC
   konfiguriertes Startprofil. Direkt ins Terminal tippen oder **Tastatur** drücken;
   längeren Text bei Bedarf über **Text verfassen → Text und Enter senden** abschicken;
   die Tastenleiste stellt Enter, Tab, Escape, Ctrl+C und Pfeiltasten bereit.
5. **Eingabe freigeben** übergibt die Steuerung an den Desktop. **Sitzung beenden**
   beendet nach Bestätigung den Prozess. Das Schliessen der Tablet-Ansicht
   beendet die Sitzung nicht. Ohne Lebenszeichen läuft die Freigabe nach
   30 Sekunden aus. Am Desktop ist eine sofortige Übernahme möglich.

Die native Shell läuft mit den Rechten des angemeldeten Windows-Benutzers;
in WSL läuft sie als Benutzer der konfigurierten Linux-Distribution. Der
Workspace ist ihr Startverzeichnis, keine Sandbox. Die Freigabe daher nur
dem eigenen gekoppelten Gerät geben. Tailscale allein erteilt keine ADE-Rechte.
Zum Widerruf den Haken entfernen und speichern oder das Gerät entfernen.
Weitere Eingaben und Ausgabezugriff werden gesperrt; gestartete Prozesse
laufen weiter und können am Desktop beendet werden.

Bei Verbindungsabbruch wieder dieselbe Sitzung auswählen. Eine unbestätigte
Eingabe wird nicht automatisch wiederholt. **Eingabestatus prüfen** liest die
Bestätigung vom PC. Bleibt sie unklar, Ausgabe prüfen und die Steuerung
freigeben, bevor neue Eingaben erfolgen.

Die Terminalanzeige zeigt Farben und Cursor; durch Antippen lässt sich direkt
schreiben. Die zusätzliche Textansicht enthält einen begrenzten Verlauf.
Bekannte Zugangsdaten und Host-Pfade werden redigiert. Mausreporting und
Dateiübertragung im Terminal sind nicht enthalten. Direkter Agent-Einstieg und
separater Dashboard-Tab: [ASSISTANT_ACCESS.md](ASSISTANT_ACCESS.md).
Verwaltete Task-Sitzungen und Login-Sitzungen werden nicht interaktiv freigegeben.
Dateien/Editor und Terminal im eigenen Ordner sind für Windows und Windows mit
WSL-Backend vorgesehen; WSL benötigt Python 3. Remote-Git-Projektwerkzeuge bleiben
auf native Repository-Bindings begrenzt. Gemessene Plattformen und Grenzen stehen
in `SESSION_WORKSPACE_RESULTS.md`.

## Eine leere Sitzung oder einen anderen Agenten starten

Am Desktop den Agenten wählen und oben **+** drücken (oder **Ctrl+Shift+T**).
Im Dialog ein Projekt oder **Ohne Projekt · Eigener Workspace** wählen. Unter
**Sitzung starten mit** die gewünschte Auswahl treffen und **Sitzung starten**
drücken. Am Tablet gibt es dieselbe Auswahl im Reiter **Terminal**.

| Auswahl | Verhalten |
|---|---|
| Leeres Terminal | Öffnet die Shell im gewählten Workspace; dort eigene Befehle eingeben |
| Gespeichertes Agent-Profil | Startet das bestehende Profil, etwa Hermes General mit `general --tui` |
| Codex | Startet `codex` mit dessen normalen CLI-Einstellungen |
| Claude CLI | Startet `claude` unabhängig vom gespeicherten Workspace-Profil |
| Grok CLI | Startet `grok` unabhängig vom gespeicherten Workspace-Profil |
| Hermes | Startet `hermes`; eigene ADE-Wrapper bleiben über das gespeicherte Profil erreichbar |
| Ollama | Ein vom Host gemeldetes Modell auswählen und mit `ollama run` öffnen |

**Startmöglichkeiten aktualisieren** liest die Installation/Modellliste erneut.
Die angezeigte Umgebung muss passen: Windows-Programme und WSL-Programme werden
getrennt erkannt. Fehlt ein Programm, Installation und PATH in dieser Umgebung
am PC prüfen. Die Auswahl installiert keine Modelle und ändert das Agent-Profil
nicht. Ein frischer CLI-Start übernimmt keine ADE-Bypass- oder Modellvorgaben eines
anderen Profils. Für diese gespeicherten Einstellungen das Profil auswählen.
Anmeldung und Modellfehler zeigt das Terminal. Beim **Restart** einer Sitzung
bleibt ihre Auswahl erhalten; nach einem vollständigen ADE-Neustart müssen
Terminals neu gestartet werden.

CLI-Referenzen: [Hermes CLI](https://hermes-agent.nousresearch.com/docs/reference/cli-commands/),
[Ollama CLI](https://docs.ollama.com/cli).
