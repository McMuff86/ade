> Archiviert am 2026-09-09. Historischer Stand; damalige nächste Schritte sind keine aktuellen Aufträge.
> Aktueller Einstieg: [User-Guide](../USER_GUIDE.md), [Status](../STATUS.md), [Handoff](../HANDOFF.md).
> Der Inhalt bleibt als Nachweis erhalten; relative Links wurden an den Archivort angepasst.

# ADE zuhause neu starten

Hallo! Kannst du bitte am Heim-PC die ADE-App einmal beenden und wieder
öffnen? Damit wird die neue Handy-/Tablet-Oberfläche von heute Morgen aktiv.
Der ganze PC muss dafür nicht neu gestartet werden.

1. **ADE vollständig beenden.** Unten rechts neben der Windows-Uhr auf den
   kleinen Pfeil **˄** klicken. Das **ADE-Symbol** suchen; wenn du mit der Maus
   darauf bleibst, erscheint „ADE“. Mit der rechten Maustaste darauf klicken
   und **„ADE und mobilen Zugriff beenden“** auswählen.
   Falls ADE gerade eine Aufgabe ausführt, bitte vorher mit Adi abstimmen.
   Das **X** am Fenster versteckt die App nur und reicht für den Neustart nicht.
2. **ADE wieder starten.** Das bereits geöffnete Terminal-/PowerShell-Fenster
   verwenden, in dem ADE gestartet wurde. Sobald dort wieder eine Eingabezeile
   erscheint, diesen Befehl eingeben und **Enter** drücken:

   ```text
   pnpm start
   ```

   Der Befehl muss im **ADE-Projektordner auf dem Heim-PC** ausgeführt werden.
   Falls dieses Terminal nicht mehr offen ist oder unklar ist, welches Fenster
   gemeint ist: bitte Adi kurz Bescheid geben. Keinen Ordner oder Startbefehl
   raten und keine zweite ADE-Version öffnen.
3. **Warten, bis das ADE-Fenster erscheint.** PC angemeldet und eingeschaltet
   lassen, Tailscale verbunden lassen. Adi kurz melden: **„ADE läuft wieder.“**

Adi lädt danach die ADE-Seite auf Handy/Tablet neu. Die bestehende Kopplung
bleibt erhalten; es ist kein neuer QR-Code nötig.

---

Hinweis für Adi: Diese Anleitung aktiviert den bereits gebauten Stand vom
8. September 2026 morgens. Die anschliessend beauftragten Goals 12–15 sind
umgesetzt und geprüft, aber noch nicht zuhause installiert.
Deren spätere Aktivierung braucht zuerst die neuen Änderungen und einen Build
auf dem Heim-PC, danach einen Neustart
und die Freigabe der neuen Verwaltungsrechte für das gekoppelte Gerät.
