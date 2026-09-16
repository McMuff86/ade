# Computerstimme — persönliche Aktivierung

Am **16. September 2026 um 12:59 CEST** wurde die vorbereitete Vorschau mit der
ruhigeren Computerstimme erfolgreich gestartet. Der Operator hatte seine
Tablet-Sitzung beendet; beim Start war keine persönliche ADE-Instanz mehr aktiv.

- Release: `dist/computer-voice-9d2ad0abc6c9b97a1d29`.
- Source-ID: `9d2ad0abc6c9b97a1d29`; persönlicher Prozess **49568**.
- Enthält den Computer-Erkennungsfix aus **06cd6ea** sowie die separat
  vorbereitete, noch uncommittete Stimmabstimmung (Tempo 0.95, gleichmässige
  Betonung und „Bereit. Bitte nenne deine Anfrage.“).
- Startprüfung bestanden: sechs Profile, vier Projekte und eine Gerätekopplung
  erhalten; keine laufende CLI-Sitzung beim Start. Alle vier Runtime-Logos geladen.
- HTTPS-Tablet-Seite antwortet mit HTTP 200; ihr JavaScript wurde byteweise mit
  dem aktivierten Release verglichen. Die Fünf-Minuten-Diktatgrenze ist enthalten.
- Startmenüeintrag ADE aktualisiert. Sicherung:
  `C:\Users\Adi.Muff\ADE-Backups\ComputerVoice-20260916-125920`.
  Der vorherige Release `dist/computer-preview-06cd6ea` bleibt vorhanden.

Quell- und Release-Dateien wurden vor dem Start gegen den vorbereiteten
Hash-Nachweis geprüft. Die isolierte Startprobe sowie 55 Sprachverträge und
18 Computer-UI-Prüfungen waren bereits bestanden. Der separate vollständige
Stimmabstimmungs-Lauf war bei einer Tablet-Fokusprüfung abgebrochen; diese
Aktivierung ist eine gezielt geprüfte Vorschau. Der erfolgreiche Goal-32-Lauf
und die Abgrenzung der parallel geänderten Quellen bleiben unter
[Goal 32](LONG_DICTATION_GOALS.md) dokumentiert. Kein neuer Produktcode wurde
für diesen Neustart geändert und keine erneute Gesamtabnahme behauptet.

Nachweise: `test-results/computer-voice-start-after-close.json`,
`test-results/computer-voice-release-smoke.json` und
`dist/computer-voice-9d2ad0abc6c9b97a1d29/activation.json`.
Der frühere gescheiterte Tray-Neustart bleibt separat als negativer
Betriebsnachweis in `test-results/computer-voice-restart.json` erhalten.

Live-Test: Tablet-Seite neu laden, eine CLI-Sitzung öffnen, gegebenenfalls
**Eingabe übernehmen**, dann **Prompt / Diktat → Computer testen**. Nach
**Ich höre zu** „Computer“ sagen. Die persönliche Hörabnahme steht noch aus.
Der vorgeschlagene Tab zur Anpassung von Stimme und Tempo ist ein weiterer
Ausbauschritt und noch nicht Bestandteil dieser Vorschau.
