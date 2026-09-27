# Tablet-Terminal: Links und Screenshots

Beauftragt am 18. September 2026: antippbare Weblinks, Screenshot-Auswahl mit
Nachricht, ergänzendes Einfügen aus der Zwischenablage sowie Build und persönlicher
ADE-Neustart nach bestandener Prüfung.

## Bedienung

- HTTP(S)-Adressen in der Live-Ausgabe lassen sich antippen. **Links** zeigt die
  Adressen aus dem Textverlauf mit **Öffnen** und **Kopieren**. **Verlauf** enthält
  ebenfalls normale, per Tastatur erreichbare Links. Öffnen erzeugt einen neuen
  Tab ohne Opener und Referrer. Lokale PC-Adressen (`localhost`, Loopback) zeigen
  einen Hinweis auf die erreichbare Projektadresse; ADE errät keine Portfreigabe.
  **Links** liegt oben rechts bei **Verlauf**, damit der linke Terminaltext für
  Tastatur-Tipps und direkte Link-Tipps frei bleibt.
- **Bild hinzufügen** unter dem Terminal öffnet **Bild und Nachricht**. Screenshot
  aus Galerie/Dateien auswählen, Vorschau prüfen, Nachricht schreiben und
  **Bild und Nachricht senden**. PNG, JPEG und WebP werden im Browser als PNG
  vorbereitet; maximal 8 MiB und 24 Megapixel. Ohne Nachricht wird um Betrachtung
  des Screenshots gebeten. Die aktuelle Oberfläche sendet ein Bild je Nachricht.
- Ein eingefügtes Bild öffnet dieselbe Vorschau. **Bild einfügen** liest nach
  ausdrücklichem Antippen die Browser-Zwischenablage; bei fehlender Berechtigung
  bleibt die Dateiauswahl verfügbar. Kein Zugriff auf die PC-Zwischenablage.
- Der Dialog erhält den Fokus und gibt ihn beim Schliessen zurück. Bild und Text
  bleiben beim Schliessen desselben Dialogs erhalten, aber nicht nach Reload oder
  Sitzungswechsel. Upload läuft erst beim Senden. Eine verlorene Versandquittung
  stoppt weitere Versuche bis zur ausdrücklichen Prüfung. **Geprüft – neuen
  Entwurf beginnen** verwirft den unbestätigten Entwurf; es wiederholt ihn nicht.
- Die kompakte Terminalansicht bei geöffneter Bildschirmtastatur blendet keine
  Sprachleiste mit offenem Dialog aus. **Bild und Nachricht** passt Höhe und
  Position an den sichtbaren Browserbereich an und scrollt das bereits fokussierte
  Nachrichtenfeld bei Tastaturänderungen ins Sichtfeld, ohne den Fokus zu versetzen.

## Vertrag und Grenzen

`POST /api/v1/terminal/images` läuft ausschliesslich über
`AdeApplicationService.remoteTerminalImage`. Erforderlich sind signiertes,
berechtigtes Gerät, `terminal:control`, Idempotency-Key, autorisierte Auswahl und
aktuelle Eingabe-Lease. Verwaltete/gesperrte/beendete Sitzungen und fremde
Geräte/Sitzungen sind ausgeschlossen. Kein neuer generischer IPC-Kanal und keine
Erweiterung von `REMOTE_COMMAND_CHANNELS`.

Der Main-Prozess prüft PNG-Header und Dimensionen vor dem Decoder und normalisiert
das Bild nochmals mit Electron. Der Browser erhält nur eine undurchsichtige ID,
Dimensionen, Grösse und einen festen Dateinamen. Keine absoluten Hostpfade,
Bildbytes oder Prompttexte in Antworten, Audit oder dauerhaften Quittungen.
Der bestehende Promptvertrag erlaubt bis zu vier eindeutige `imageIds`; nur
Main löst diese auf. Der Transport ist für ADE-gestartete Sitzungen mit geschütztem
Prompt verfügbar, deren Bildannahme gemessen ist (`imageAttachmentMeasured`): Codex
nativ und in WSL, seit 27. September 2026 auch Claude Code nativ unter Windows.
Claude Code in WSL, Grok und andere CLIs bleiben ohne Bildaktion, bis eine Messung
vorliegt. Der Knopf **Bild hinzufügen** bleibt in diesem Fall antippbar
(`aria-disabled`). Der Dialog nennt den Grund, statt stumm ausgegraut zu sein.
Bildauswahl und Senden bleiben dann gesperrt. Fehlt nur der Eingabebesitz, lässt sich
das Bild schon wählen.

`TerminalImageStore` speichert ausserhalb von Git-Workspaces: nativ unter dem
ADE-Profil, bei Windows→WSL über einen festen Python-Worker unter einem privaten
Benutzerordner in `/tmp`. Worker-Nutzdaten gehen über JSON-stdin, keine Pfade oder
Umgebungswerte über Shell-argv. Exklusive Dateierstellung, Link-/Hardlinkprüfung,
SHA-256 und erneute Workspace-/Lease-Prüfung gelten vor der Übergabe. IDs verfallen
nach 24 Stunden; alte reguläre Dateien werden beim nächsten Upload entfernt.
Maximal 64 Bilder/64 MiB pro Speicher und zusätzlich im laufenden ID-Verzeichnis.
Bild- und Audio-Uploads teilen eine Grenze von zwei HTTP-Anfragen gleichzeitig;
gewöhnliche JSON-Anfragen bleiben auf 64 KiB begrenzt.

Codex und Claude Code erhalten jeden Bildpfad als eigenen bracketed paste, danach die Nachricht.
`ProtectedPromptWriter` hält die Eingabesynchronisierung über alle Teile, wartet
zwischen Bild/Text/Enter und prüft vor jedem Teil erneut Ziel, Rechte und Dateien.
Die native Probe prüft `[Image #1]` in einer echten separaten CLI und sendet
keinen Modellauftrag. Transportquittung bedeutet keine bestätigte Modellantwort.

Die Linkerkennung verwendet ausschliesslich bereits redigierten sichtbaren Text.
OSC-Ziele bleiben entfernt. Nur HTTP(S), keine eingebetteten Zugangsdaten oder
redigierten Platzhalter. Bei umgebrochenen Adressen wird das vollständige Ziel
aus dem Textverlauf verwendet; mehrdeutige Präfixe öffnen kein gekürztes Ziel.
Linkliste höchstens 100 Einträge; keine automatische Navigation.

## Prüfstand und Aktivierung

20. September 2026, Korrektur der Nachrichtenbearbeitung: Der neue Touch-Test
reproduzierte vor der Korrektur den Fokusverlust und das Verschwinden des
Bilddialogs beim simulierten Öffnen der Android-Tastatur (Verkleinerung von
`visualViewport.height`, unveränderter Layout-Viewport). Danach besteht
`node --import tsx scripts/test-dictation-electron.ts --terminal-image-only`
**21/0** unter nativem Windows mit echtem Electron, Chromium-Touch und ConPTY:
Antippen, Tippen/Korrigieren, Tastaturansicht, Entwurfserhalt und tatsächlicher
Bild-/Textversand einschliesslich Quittungsverlust und positiver Endkontrolle.
Der neue Schalter prüft nur den Bildablauf; der bestehende Medien-Schalter
enthält weiterhin Links und Bilder. Kein physischer Samsung-Test.

Ein vorhandener Absturz der Desktop-Testoberfläche wurde mitkorrigiert:
`TerminalArea` rendert sein JSX-Hinweiselement direkt und übersetzt nur den
Fehlertext. `pnpm run build` erfolgreich. `pnpm run typecheck` scheitert weiterhin
an TS2742 in `src/shared/i18n/index.ts:7`. Der volle Medienlauf scheiterte zuvor
am direkten Touch-Link (Popup-Timeout); das ist kein Nachweis für den korrigierten
Bildablauf. Kein neues `pnpm verify` und keine Gesamtfreigabe. Die laufende
persönliche ADE-Instanz wurde nicht neu gestartet.

- Vollständiges `pnpm verify` am **19. September 2026, 11:15 CEST**, Exit **0**:
  **91 Kernsuiten / 3.780 Prüfungen**, Produktionsbuild und **30 Electron-/Browser-Driver**.
- Fokussierter Driver: `pnpm test:terminal-media`; zusätzlich `-- --wsl` prüft
  den tatsächlichen Ubuntu-Bildspeicher. Aktuelle erweiterte Messung **50/0**
  einschliesslich WSL, signiertem HTTP, Negativkontrollen und positiver Endkontrolle.
- Echte native Codex-Bildannahme: `node --import tsx scripts/test-terminal-image-native.ts`,
  **3/0** unter Windows. Beleg `test-results/terminal-media/windows-codex.json`.
- Echte native Claude-Code-Bildannahme (27. September 2026): dieselbe Probe mit
  `--claude`, **3/0** mit Claude Code v2.1.283 unter Windows. Der eingefügte
  PNG-Pfad erscheint als `[Image #1]`; kein Enter, kein Modellauftrag. Beleg
  `test-results/terminal-media/windows-claude.json`. Die node-pty-Meldung
  `AttachConsole failed` beim Aufräumen ist bekanntes Teardown-Rauschen (Exit 0).
- Browser-/Electron-Driver: `node --import tsx scripts/test-dictation-electron.ts --terminal-media-only`.
  **27/0** einschliesslich verzögertem/fehlgeschlagenem Modulimport, Wiederaufnahme
  ohne neue Sitzung, tatsächlichem Touch-Link, Bildpasten und verlorenen Quittungen.
  Der Quittungsverlust wird am HTTPS-Proxy nach der tatsächlichen Hostantwort
  erzeugt; ein `route.fetch`-DNS-Fehler war kein gültiger Verlustnachweis.
  Der erste Gesamtlauf bestand **91 Suiten / 3.780 Prüfungen**, fand danach
  aber den über dem linken Text liegenden Links-Knopf im Tastaturtest. Knopf
  rechts zu Verlauf versetzt; Tastatur/Antworten danach **35/0**, Medien erneut **27/0**.
- Native Linux/WSLg und macOS sind für diesen neuen Ablauf noch nicht gemessen;
  Windows→WSL ist eine getrennte Bereitstellungsform. Physischer Samsung-Touch
  bleibt von Chromium-Automation getrennt.

Persönlich am 19. September um **09:18 CEST** mit Source
`9c76087fb515f3b8c16e`, PID 47752, aktiviert. Alle Profile, Projekte und bestehenden
Kopplungen erhalten; privates HTTPS liefert jeden Mobile-JavaScript-Chunk bytegleich.
[Aktivierung, Sicherung und Gesamtprüfung](MOBILE_PAIRING_RECOVERY.md).
