# Goal 33 — Persönlicher Sprachdialog auf PC und Tablet

Stand 16. September 2026: Der Operator priorisiert einen sofort testbaren
„Computer“-Aufruf. Goal 33.0 ist deshalb implementiert und in Abnahme;
der weitergehende Dialog bleibt ein Vorschlag. Parallel läuft [Goal 32](LONG_DICTATION_GOALS.md).

## Goal 33.0 — Erster Live-Test

PC und Tablet: Im aktiven CLI-Terminal **Prompt / Diktat → Computer testen**
wählen, Mikrofon erlauben und **Computer** sagen. Nach der bestätigten Erkennung
stoppt die Aufnahme, dann antwortet die gewählte ADE-Standardstimme:
„Guten Morgen/Tag/Abend, Adi. Ich bin bereit. Was möchtest du als Nächstes angehen?“
Massgeblich ist die Tageszeit des Hosts. Derselbe Text steht im Fenster.
**Computer-Test beenden** stoppt Aufnahme/Wiedergabe; **Begrüssung abspielen**
verwendet bereits empfangenes Audio ohne weitere Synthese. Die nächste Aufgabe
kann anschliessend mit **Diktieren** eingegeben werden.

Dieser erste Test hört nach ausdrücklichem Aktivieren bis zu 20 Sekunden auf
einen einzelnen Aufruf „Computer“ oder „Hey Computer“. Er endet bei Schliessen,
Verbindungsverlust oder verborgenem Dokument. Kein ständig aktives Hintergrund-
Mikrofon, kein Arbeitsrückblick und keine ausgeführten Sprachaktionen in dieser
ersten Lieferung. Der Prompt bleibt unverändert. Erkennung und Sprachausgabe
verwenden ElevenLabs; das Tablet benötigt `dictation:transcribe`,
`terminal:control` und `speech:control` sowie Zugriff auf die Standardstimme.

Technisch: gemeinsame React-Komponente, vorhandene zielgebundene Live-Diktat-
Tickets und ein streng validiertes `computer-greeting`-Preset im bestehenden
Stimmtest-Vertrag. Text und Tageszeit entstehen in main. Keine freien TTS-Texte,
neuen IPC-Kanäle oder erweiterten generischen Remote-Schreibrechte. AudioContext
wird beim Aktivieren freigeschaltet; Replay bleibt als ausdrückliche Alternative
bei unterbrochener Browserwiedergabe verfügbar. Der Verbrauch zählt als Stimmtest
mit tatsächlicher Zeichenzahl. Providerantworten und Schlüssel bleiben geschützt.

Abnahme: `pnpm exec tsx scripts/test-dictation-electron.ts --computer-only`
prüft die echte Electron-/Chromium-Audiopipeline mit simuliertem Mikrofon und
Provider über beide Produktionsoberflächen. Physisches Samsung-Tablet und echte
ElevenLabs-Erkennung werden anschliessend vom Operator live erprobt.

## Erlebnis

Ein ruhiger, aufmerksamer „Computer“ begleitet den Arbeitsbeginn. Er stellt
sich nicht vor, spricht knapp und erinnert an nachweisbare Arbeit. Stimme,
Anrede und Ausführlichkeit sind persönliche Einstellungen. Als Vorgabe:
„Adi“, die bereits gewählte Standardstimme, sachlich und freundlich,
ungefähr 15–25 Sekunden Begrüssung mit höchstens zwei Arbeitspunkten.

1. Adi wählt **Sprache aktivieren**. PC und Tablet zeigen denselben Zustand.
2. Die Begrüssung richtet sich nach der lokalen Tageszeit und dem aktiven
   Projekt. Beispiel nach erfolgreicher Lieferung der aktuellen Arbeit:

   > Guten Morgen, Adi. Zuletzt haben wir die Ollama-Auswahl erweitert und
   > längere Sprachaufnahmen ermöglicht. Als Nächstes könnten wir die
   > Sprachbedienung ausbauen. Womit möchtest du heute beginnen?

3. Währenddessen steht derselbe Text lesbar im Sprachbereich. **Überspringen**
   beendet die Ausgabe. Anschliessend signalisiert ein kurzer Ton optional
   die Aufnahmebereitschaft; die Anzeige lautet **Ich höre zu**.
4. Adi: „Lass uns beim Tablet weitermachen.“ Bei mehreren passenden Projekten
   fragt der Computer kurz nach. Bei eindeutigem Ziel öffnet er das Projekt
   und bietet den letzten belegten offenen Schritt an.
5. Adi: „Bereite einen Auftrag für die Begrüssung vor.“ Der Computer erstellt
   einen sichtbaren, bearbeitbaren Auftragsentwurf. Ein bestätigtes **Starten**
   übergibt genau diesen Entwurf an das gewählte Projekt und Profil.

Pro Sprachsitzung gibt es eine ausführlichere Begrüssung. Kurzes Wiederaufnehmen
verwendet „Wir waren gerade bei …“. Eine zweite offene Oberfläche spricht nicht
ungefragt mit. **Sprache beenden** stoppt Wiedergabe, Aufnahme und Sitzung.

## Goal 33.1 — Begrüssung und Arbeitsrückblick

Empfohlene erste Lieferung:

- Global erreichbarer Sprachknopf mit grosser Touchfläche; auf PC zusätzlich
  ein konfigurierbares Tastenkürzel. Anrede, Standardstimme, Rückblicklänge und
  Begrüssung ein/aus. Tastatur und Text bleiben vollständig nutzbar.
- Begrüssung erst nach ausdrücklicher Aktivierung. Wiedergabe startet auf dem
  aktivierten Gerät. Browserblockaden erhalten einen sichtbaren Wiedergabeknopf.
- Hauptprozess bildet einen kleinen Rückblick aus erlaubten Projekt-/Auftrags-
  Metadaten, vollständigen `RunReport`-Ergebnissen und gespeicherten expliziten
  Übergaben. Jeder Punkt erhält Quelle, Zeitpunkt und Ergebnisstatus.
- Priorität: aktives Projekt, letzte bestätigte Arbeit, höchstens ein offener
  Schritt. Ein laufender CLI-Prozess ist kein Beleg für erledigte Arbeit.
  Ein Commit belegt eine Änderung, aber nicht automatisch bestandene Tests.
- Fehlt ein gesicherter Rückblick: „Für dieses Projekt ist noch kein
  Arbeitsrückblick gespeichert. Womit möchtest du beginnen?“
- Veraltete Informationen werden zeitlich eingeordnet („Beim letzten
  gespeicherten Stand …“). Kein erfundenes „Wir haben erledigt“ aus
  Terminal-Schnipseln. Optional manuell gepflegte **Letzte Übergabe** pro
  Projekt schliesst die Lücke bei interaktiven CLI-Sitzungen.
- Anfangs deterministische Satzbausteine. Eine spätere Modellzusammenfassung
  darf nur belegte Fakten kürzen und wird separat geprüft; sie benötigt keine
  Coding-Harness und erhält keine Ausführungswerkzeuge.

Abnahme: morgens/abends, leere/veraltete Historie, laufende/fehlgeschlagene Arbeit,
begrenzte Projektfreigabe, fehlende Stimme, Wiedergabefehler, Doppelaktivierung,
Escape/Fokusrückgabe, PC und Tablet. Ein ungültiger Rückblick darf keine
behauptete Erfolgsmeldung erzeugen.

## Goal 33.2 — Sprechen, verstehen und gezielt handeln

Erste Absichten: Projekt öffnen, letzten Stand erklären, offene Aufgaben
anzeigen, Auftragsentwurf vorbereiten, Entwurf ändern und freigegebenen Auftrag
starten. Eine mehrdeutige Zielauswahl wird geklärt. Navigation und Statusabfragen
können direkt erfolgen. Für Start/Änderung wird der konkrete Auftrag mit Projekt
und Profil angezeigt und erst nach Bestätigung ausgeführt; keine wiederholte
Bestätigung für dieselbe unveränderte Freigabe.

**Sprachdialog** und **Diktat** bleiben erkennbare Modi. Im Diktat wird das
Gesagte zu Entwurfstext. Im Dialog werden freigegebene Absichten verarbeitet.
„Lösche die Datei“ im diktierten Prompt löst deshalb keine Bedienaktion aus.
Unbekannte Absichten erzeugen eine Rückfrage oder einen Entwurf. Projekttexte,
Terminalausgabe und Rückblickquellen sind Daten, keine Steueranweisungen.

Gemeinsame Zustände: **Aus → Bereit → Spricht → Hört zu → Verarbeitet →
Entwurf/Bestätigung → Bereit**, ergänzt um verständliche Fehler. Mikrofonzustand,
erkanntes Gesagtes und Antwort bleiben sichtbar. Stummschalten betrifft nur
Ausgabe; ein separater klarer Schalter beendet das Mikrofon. Bei Trennung bleibt
der letzte Entwurf erhalten; kein automatisches Wiederholen bezahlter Anfragen
oder gestarteter Aufträge.

Die erste Version hört während eigener Sprachausgabe nicht auf neue Befehle.
**Unterbrechen** ist stets als Taste verfügbar. Sprechunterbrechung durch „Stopp“
folgt erst nach Tests zur Echo-Unterdrückung und Fehlaktivierung in Goal 33.3.
Kurze Dialogbeiträge erhalten ein eigenes Zeitlimit und eine sichtbare
Fortsetzen-Aktion; fünf Minuten bleiben das Limit eines Diktats, nicht die
Lebensdauer der gesamten Sprachsitzung.

## Goal 33.3 — Unterbrechen und zwischen Geräten fortsetzen

Nach der ersten stabilen Lieferung: natürliches Unterbrechen der Sprachausgabe,
gezielte Statusansagen nach längeren Aufgaben und **Hier fortsetzen** beim
Wechsel PC ↔ Tablet. Projekt-/Gesprächskontext liegt berechtigt am Host;
Mikrofon und Wiedergabe bleiben gerätelokal. Ein kurzlebiger, widerrufbarer
Sitzungsbesitz verhindert parallele Antworten und doppelte Auftragsstarts.

Ein optionales Aktivierungswort „Computer“ wird als eigene spätere Untersuchung
behandelt: lokale Erkennung, eindeutiger Aktivzustand und Messung von Fehlstarts,
Akkuverbrauch sowie tatsächlichem Geräteverhalten. Die erste Lieferung wird
für ein sichtbares, aktives ADE-Fenster entworfen. Hintergrund-/Sperrbildschirm-
Nutzung wird auf dem konkreten Tablet geprüft, bevor Unterstützung zugesagt wird.

## Technischer Anschluss und Grenzen

Vorhanden sind gemeinsame Live-Aufnahme, gerätegebundene Diktatfreigabe,
ElevenLabs-Stimmenwahl, Sprachverbrauch, Auftragsberichte und ein signierter
mobiler Aufgabenpfad. `SpeechService` synthetisiert derzeit ausschliesslich
einen festen Stimmtesttext; `RemoteSpeechService` transportiert dessen begrenzte
Test-ID und Audio. Allgemeine Antworten, ein Rückblickdienst und ein
Dialogzustand müssen neu implementiert werden.

Vorgeschlagene Trennung: Hauptprozess erstellt begrenzte Rückblick-/Antwortdaten,
eine gemeinsame UI führt den Dialog, ein TTS-Dienst erzeugt begrenzte Ausgabe.
Neue DTOs in `src/shared`, strenge Validierung und Geräte-/Projektfreigaben;
mobile Adapter rufen nur `AdeApplicationService` auf. Neue Sprachoperationen
erhalten einen eigenen eng begrenzten Vertrag mit Gerätebeweis, Idempotenz,
Widerruf und Audit. Bestehende PTY-/Host-/Konfigurationskanäle werden dafür
nicht in die gemeinsame Remote-Allowlist aufgenommen. Aufträge verwenden den
bestehenden autorisierten Aufgabenpfad; keine freien Shellbefehle aus Sprache.

Providerzugang bleibt im Hauptprozess. Audio und Rohtranskripte sind flüchtig;
gespeicherte Rückblicke enthalten nur die vorgesehenen Fakten. TTS erhält nur
den zur Sprachausgabe vorgesehenen Text. Verwendung und unbekannte Kosten werden
wie bei Diktat wahrheitsgemäss erfasst. Der neue Verwendungszweck ist in den
Sprach-/Gerätefreigaben sichtbar. Widerruf stoppt auch laufende Vorgänge.

Der bewusste Aktivierungsschritt passt zu den Browserregeln für hörbare Ausgabe:
[MDN: Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).
Mikrofonaufnahme braucht eine sichere Seite und Nutzerfreigabe:
[MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
Der bestehende HTTPS-Tablet-Zugang ist die Anschlussstelle. Historische
[WebKit-Berichte zu Hintergrundaufnahme](https://bugs.webkit.org/show_bug.cgi?id=239602)
begründen zusätzliche Gerätetests, aber keine Aussage über das noch unbekannte
konkrete Tabletmodell oder seine aktuelle Browserfassung.

Für jeden Schritt: fokussierte Vertrags-/Fehlertests, echte Browser-/Electron-
Flows, vollständiges `pnpm verify`, danach konkrete PC-/Tablet-Sprachabnahme.
Begrüssung und Rückblick zuerst liefern; anschliessend begrenzte Bedienabsichten,
danach freieres Gespräch und Gerätewechsel.
