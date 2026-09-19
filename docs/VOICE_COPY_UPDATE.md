# Kurzer Stimmtest und englisches „Agent“

Nutzerkorrektur vom 19. September 2026: Der Stimmtest lautet jetzt
„Hallo Adi, ich bin dein Agent. Was kann ich für dich tun?“
Die technische ElevenLabs-Erfolgsmeldung entfällt. Auch die zeitabhängige
Computer-Begrüssung fragt „Was kann ich für dich tun?“; die Hinweise zum Diktieren
und Prüfen bleiben dort bestehen.

Die Aussprachevorgabe für das eigenständige Wort „Agent“ verwendet beim Provider
englische IPA mit Erstsilbenbetonung und expliziter Silbengrenze: `/ˈeɪ.dʒənt/`.
Sie gilt auch beim Vorlesen von Antworten, unabhängig von Gross-/Kleinschreibung.
Zusammengesetzte Wörter wie „Agenten“, „Agentur“ und Bezeichner bleiben erhalten.
Angezeigter Text behält die normale Schreibweise. Die Adi-Aussprache bleibt erhalten.

Grundlage ist die [ElevenLabs-Dokumentation zu IPA in Eleven v3](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#ipa-with-eleven-v3),
abgerufen am 19. September 2026. Das ist eine Aussprachevorgabe; die tatsächliche
Qualität mit der ausgewählten Stimme braucht weiterhin eine Hörprobe. Es wurde
keine neue kostenpflichtige Synthese und keine akustische Abnahme durchgeführt.

Gezielte Prüfungen: `test-speech.ts` **64/0**, `test-speech-usage.ts` **36/0**.
Sie prüfen den tatsächlichen Provider-Auftrag mit simuliertem Transport,
die unveränderte Anzeige, Wortgrenzen, Begrüssung und Verbrauchserfassung.
Der vollständige Testlauf bleibt auf Nutzerwunsch ausgesetzt.

Gemeinsam mit Tasks/Notes am 19. September um **23:19:44 CEST** aktiviert;
Desktop/Mobile-Quelle **`84c3fb056ecdde7aa0f1`**, Kopplungen erhalten.
