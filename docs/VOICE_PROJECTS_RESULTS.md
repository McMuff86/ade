# Stimmen, Projektauswahl und kompakte Terminalbedienung

13. September 2026, native Windows-Entwicklung. Persönliche Aktivierung
ab 23:45 Uhr auf Benutzerwunsch; vollständige erneute Abnahme noch laufend.

## Umsetzung

- Desktop Settings: verfügbare ElevenLabs-Stimmen laden, weibliche Vorauswahl,
  persistente Stimmenwahl, fester deutscher Stimmtest und Audio-Stop. Key nur
  im Hauptprozess, keine beliebigen URLs oder Testtexte, begrenzte Responses.
- Desktop/Mobile Projekte: Alle/Meine-Filter, explizites Hinzufügen/Entfernen;
  vorhandene Git-Ordner auch über Desktop-Ordnerauswahl hinzufügen. Entfernen
  betrifft Auswahl/Overview-Shortcuts, nicht Dateien, laufende Sessions,
  Projektidentität, Agentbindungen oder Verlauf. Alte Einträge bleiben zunächst
  enthalten; neu entdeckte Ordner werden durch bloßes Öffnen nicht ausgewählt.
- Tablet: Status im Dialogkopf, gerätebezogen einklappbare Sitzungsbedienung,
  kompakte Nutzungsanzeige mit Provider, Quellenhinweis, verbraucht/übrig und Reset.
  Bei geöffneter Bildschirmtastatur klappt auch der Statuskopf ein; der bestehende
  Knopf „Bedienung“ macht ihn wieder erreichbar und erhält den Eingabefokus.
- Provider-Key-Erkennung zählt ausschließlich die effektive Startumgebung der
  betreffenden CLI. ElevenLabs und andere Provider erzeugen keinen falschen
  Codex-/Claude-/Grok-API-Hinweis. Native Codex-Aboabfrage bleibt auch neben einem
  bereitgestellten API-Zugang sichtbar; sie ist keine Abrechnungsbestätigung
  der laufenden TUI. Native Kontoquote wird nicht auf WSL übertragen.

## Fokussierte Nachweise

| Prüfung | Ergebnis |
|---|---|
| SpeechService / IPC / Provider-Zuordnung | 38 bestanden |
| Echte Electron-Speech-UI | 10 bestanden; Netzwerk deterministisch ersetzt, gültige stille MP3 wird durch echte CSP abgespielt |
| ProjectWorkspaceService | 45 bestanden; Auswahl persistiert und erhält Dateien/Workspace |
| Signed Project Directory/Membership API | 36 bestanden; Scope, ausgewählte Ressourcen, Bearer, Idempotenz und Widerruf negativ geprüft |
| Projekt-CLI in echtem Electron/Browser | 28 bestanden; einklappen schafft Terminalfläche, Tastatur/Fokus/Phone, Branches und Rückkehr zur Sitzung |
| Reale native Codex-Kontoabfrage | 16 % verbraucht, 84 % übrig, ein 7-Tage-Fenster mit Reset-Zeitpunkt; zeitgebundene Beobachtung |
| Persönlicher ElevenLabs-Test | Sarah (weiblich) gespeichert; deutsche Ausgabe in Produkt-UI nach 7,523 Sekunden vollständig abgespielt |
| Persönliche Profilbilder und Projektauswahl | Beide Bilder geladen; Agent-Differenz ausschließlich Foto; Jumpnrun-Auswahl entfernt, sechs Repository-Identitäten erhalten |

Die stille MP3-Fixture wurde lokal mit FFmpeg aus `anullsrc` erzeugt (0,3 s,
22050 Hz, mono, MP3 32 kbit/s); kein aufgezeichneter Benutzerinhalt.
Speech-UI-Tests verbrauchen keine Provider-Credits. Der echte ElevenLabs-Hörtest
und seine persönliche Stimmenauswahl werden separat protokolliert.

Im ersten Gesamtlauf mussten die alten Desktop-Ownership-/Offline-Selektoren
an die neue Kopfzeile angepasst werden. Die anschließenden echten Keyboard-
Tests zeigten zu wenig Terminalfläche; der Kopf folgt nun dem vorhandenen
Keyboard-Kompaktmodus. Ein bestehender Integrationstest prüfte den initialen
Überschriftenfokus erst nach zwei weiteren Button-Klicks; die Fokusprüfung
steht jetzt unmittelbar nach dem Öffnen, Auswahlwiederherstellung wird separat
geprüft. Positive Endergebnisse werden nach Abschluss unten festgehalten.

## Persönliche Profilbilder

Benutzer-Vorlage für Main Chef: `test-results/main-chef-profile.png`.
Neues RhinoLayoutTools-/LayoutTool_FrontendDesigner-Porträt mit dem eingebauten
`image_gen` erzeugt, visuell geprüft und als
`test-results/rhino-layout-tools-profile.png` gesichert. Vollständiger Prompt:
`test-results/rhino-layout-tools-profile-prompt.txt`. Stil: kupferrote Haare,
weiß-goldene technische Rüstung, türkisfarbene Details, CAD-Zeichenkreise;
zentriertes Gesicht für kleine runde Avatare. Die persönliche Aktivierung
importiert beide Originalbilder über `photo:import` und weist nur das Foto zu;
Agent-ID, Modelle, Rollen und Arbeitsverzeichnisse bleiben erhalten.
Die persönlichen Bilddateien liegen außerhalb des versionierten Produktcodes.

Lokale Logs: `test-results/speech-focused.log`, `speech-electron.log`,
`projects-membership-focused.log`, `projects-membership-api.log`,
`speech-projects-tablet.log`, `speech-projects-verify.log` sowie
`codex-account-probe.json`.

## Nächste Schritte

Mobile-Ausbau vom 14. September: Stimmenvererbung 23 Checks, Browser-Sprachfluss
28 Checks, Profilbild-/Workbench-Browserfluss 43 Checks bestanden. Der Sprach-
Browserlauf spielt eine echte MP3 mit simuliertem Provider ab und verliert
gezielt eine bereits ausgeführte Testantwort: Reload und Wiederaufnahme
erzeugen kein zweites Audio. Gerätebeweis, Ressourcenbegrenzung, persistente
Auswahl, Schlüsseltrennung, Smartphone-Breite und Fokus werden geprüft.
Die Testproxy-DNS-Auflösung wurde für Playwrights serverseitiges `route.fetch`
explizit auf Loopback geführt; Browser-DNS-Regeln gelten dort nicht.
Zusätzlich 48 Projekt-Workspace-Prüfungen bestanden. Der neue Browser-Projekttest
deckte eine Konkurrenz zwischen Stimmenänderung und laufender Git-Identitäts-
abfrage auf: reine Stimmen-/Auswahlmetadaten dürfen den Workspace nicht
invalidieren. Ein gezielter negativer Test weist nach, dass eine währenddessen
geänderte Repository-Verifikation weiterhin abgewiesen wird; anschließender
positiver Kontrolllauf besteht. Der erste Gesamtlauf bestand 52 Suiten/2.480
Checks, stoppte an diesem neuen Browsertest. Erneute Gesamtabnahme:
`test-results/mobile-voice-verify-final.log`, noch offen.

Der erneute Lauf besteht 52 Suiten/2.483 Checks, Build und Sprach-/Desktop-
Electron-Prüfungen. Ein alter Mobile-Test erwartete trotz des parallel
eingecheckten Calm Pass weiterhin Monospace für alle Texte. Die Prüfung folgt
jetzt dem dokumentierten Vertrag: Sans für UI, Monospace für Maschinentext.
Der anschließende Mobile-Lauf besteht 60 Checks. Die Fortsetzung auf demselben
Produktbuild besteht außerdem den vollständigen Remote-Terminal-Lauf mit
202 Checks und die Run-Inspection mit 27 Checks. Weitere Abschlussprüfungen
bestanden anschließend ebenfalls. Fortsetzung Exit 0:
`test-results/mobile-voice-verify-continuation.log`. Projekt-CLI 28, Projekt-Git
22, Veröffentlichung 12, Einrichtung 37, visuelle Regression 22 Checks.
Ein vollständig grüner einzelner `pnpm verify`-Aufruf wird nicht behauptet;
die gesamte Prüfkette ist durch die beiden Teilläufe abgedeckt. Persönlicher
Build `8fa89f2` seit 00:54 Uhr aktiv, einschließlich Samsung-Stimmenfreigabe.

[Goals 23–25 und Multi-Host-Abfolge](VOICE_USAGE_TERMINAL_PLAN.md),
[Main Chef / Goal 26](MAIN_CHEF_COORDINATION_PLAN.md).
Diktat, vollständige Claude-/Grok-Nutzungscollector, weitere Terminal-
Latenzoptimierung und Mehr-PC-Koordination sind geplant, noch nicht implementiert.
