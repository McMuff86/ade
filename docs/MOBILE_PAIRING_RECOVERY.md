# Tablet-Kopplung und Browser-Build · 19. September 2026

## Bedienung zu Hause und unterwegs

1. PC eingeschaltet und im Benutzerkonto angemeldet lassen. ADE muss laufen.
2. Tailscale auf PC und Tablet verbinden; beide Geräte müssen im selben privaten
   Netz berechtigt sein. Es braucht keine öffentliche Router-Portfreigabe.
3. In ADE am PC unter **Einrichtung → Tablet verbinden** oder **Settings →
   Mobiler Zugriff** auf **Tablet oder Smartphone koppeln** klicken.
4. QR-Code scannen oder die angezeigte HTTPS-Adresse auf dem Tablet öffnen und
   den **Pairing-Code** einfügen. Gerätenamen eingeben und **Dieses Gerät verbinden**.
   Code/Link sind einmalig und fünf Minuten gültig. Das Pairing-Fenster bis zur
   Kopplung offen lassen; Schliessen bricht die noch offene Kopplung ab.
5. Im selben Tablet-Browser bleibt die Kopplung gespeichert. Zu Hause und
   unterwegs dieselbe HTTPS-Adresse öffnen. Ein Wechsel des WLANs verlangt
   keinen neuen Code. Browser und installierte Web-App können getrennte
   Gerätespeicher verwenden; dann einmal direkt in der gewünschten App koppeln.

Eine neue Kopplung wird am vertrauenswürdigen PC gestartet. Wer bereits unterwegs
ist und einen anderen Browser/ein anderes Gerät koppeln möchte, braucht dafür
Zugriff auf ADE am PC. Ein abgelaufener Code wird nicht wiederverwendet.
Freigaben unter **Settings → Verbundene Geräte** für das tatsächlich verwendete
Gerät prüfen; erneutes Pairing kopiert keine zusätzlichen Rechte von alten Geräten.

## Ursache und Korrektur

Das produktive `audit.jsonl` enthielt 8.388.490 Bytes gültiges Protokoll. Ein weiterer
Eintrag überschritt die bisherige starre 8-MiB-Grenze und deaktivierte die sichere
Geräteverwaltung. Der Netzwerkmonitor stellte trotzdem den HTTP-Listener wieder
her, weshalb die Oberfläche HTTPS bestätigte und Pairing erst beim Klick scheiterte.

Vor Überschreitung wird jetzt der komplette aktuelle Abschnitt atomar als
`audit.previous.jsonl` gesichert; die aktuelle Datei behält die jüngsten vollständigen
Zeilen (bis 4 MiB) plus Historienmarker. Beide dauerhaften Dateien sind auf jeweils
8 MiB begrenzt. Historienmarker verhindern auch nach mehreren Archivierungen,
dass verlorene Geräte- oder Befehlsdateien als neue Installation gelten.
Beschädigte Dateien, Verknüpfungen oder Schreibfehler sperren weiterhin den Zugriff.
Der Status und die Wiederaufnahme prüfen nun zusätzlich die Geräteablage.

## Desktop und Mobile bauen

Laufende Arbeit abschliessen und eine vorhandene ADE-Instanz über den Infobereich
vollständig beenden. Nur das Fenster zu schliessen lässt den mobilen Host weiterlaufen.
Dann im Repository ausführen:

```powershell
pnpm build
pnpm start
```

`build` erstellt Electron-Main, Preload, Desktop-Oberfläche und Mobile-Oberfläche.
`start` startet danach den gebauten Stand ohne einen zweiten, nur Desktop
betreffenden Build. Nach Quelländerungen erneut `pnpm build` ausführen.
Anschliessend die Tablet-Seite neu laden; Kopplungen im selben Profil bleiben erhalten.

React und Terminalbibliothek werden als eigene Browser-Chunks gebaut. Die mobile
Terminalanzeige wird erst beim Öffnen geladen; Ladefehler erhalten einen expliziten
Neuladen-Knopf und starten keine zweite PC-Sitzung. QR-Erzeugung lädt erst beim
Pairing. Desktop-JavaScript und CSS werden in Produktion minifiziert.
Die Gesamtfunktionalität bleibt gleich; Mobile lädt die öffentlichen Chunks im
Hintergrund weiterhin in den Offline-Cache. Deshalb bedeutet ein kleineres
Startmodul keine entsprechende Verringerung des gesamten Downloads.
Main/Preload bleiben lokal und müssen nicht über das Netz zum Tablet übertragen werden.

Gemessene Produktionsgrössen (JavaScript, unkomprimiert):

| Oberfläche | Vorher | Nachher |
| --- | ---: | ---: |
| Desktop, alle JavaScript-Chunks | 2.069,22 kB | 1.096,07 kB |
| Mobile, Hauptmodul | 929,85 kB | 385,40 kB |
| Mobile, Hauptmodul plus sofort benötigtes React | 929,85 kB | 577,89 kB |

Mobile lädt Terminalbibliothek/Anzeige zusätzlich bei Bedarf; die Summe aller
Chunks bleibt etwa 930 kB. Der grösste Desktop-Chunk liegt bei 491,38 kB,
der grösste Mobile-Chunk bei 385,40 kB. Die 500-kB-Warnschwelle wurde nicht erhöht.

## Prüf- und Betriebsstand

- Vollständiges **`pnpm verify` bestanden**, Exit **0**, am **19. September
  2026, 11:15 CEST**: alle drei TypeScript-Projekte, **91 Kernsuiten / 3.780
  Prüfungen**, Desktop-/Mobile-Produktionsbuild und **30 Electron-/Browser-Driver**.
  Belege: `test-results/pairing-verify.log`, `test-results/pairing-verify-exit.json`.
- Geräte/Audit: **51/0**; Verbindung/Protokoll: **88/0**.
- Electron-Pairing: **37/0**; Tastatur/Antworten nach Layoutkorrektur: **35/0**;
  Terminal-Medien mit Import-Fehlerkontrolle erneut **27/0**.
- Erster Gesamtlauf: **91 Suiten / 3.780 Prüfungen** bestanden. Anschliessend
  erkannte der echte Tastatur-Tipptest, dass der neue Links-Knopf den linken
  Terminaltext verdeckte. Platzierung korrigiert.
- Zweiter Gesamtlauf: Kernprüfungen und die bis dahin ausgeführten UI-Flows
  bestanden, dann Terminal-Driver **56/1**: Der Tastaturstart wartete nicht auf
  einen bedienbaren Startknopf nach der anfänglichen Grössenanpassung. Der Test
  wartet jetzt auf Bedienbarkeit vor Fokus/Enter. Der isolierte Driver erhält
  zudem ausdrücklich dieselbe Landschaftsgrösse wie der Gesamtflow, statt vom
  vorherigen Test abhängig zu sein. Positive isolierte Wiederholung **59/0**;
  dafür war keine weitere Produktänderung nötig.
- Dritter Gesamtlauf: Die zuvor zweimal erfolgreiche Orchestrierungs-Suite
  überschritt unter parallel laufenden UI-Vorprüfungen ihr viersekündiges
  Git-Wartefenster (`dependent-topology approval`). Kein Produktcode und keine
  Testgrenze dafür verändert. Die zusätzliche Schlussstrecke und alle übrigen
  Terminal-Unterabläufe bestanden separat.
- Vierter, serieller Gesamtlauf: **91 Suiten / 3.780 Prüfungen**, Build,
  Desktop-/Mobile-Abnahme und Terminal-Gesamtflow **208/0** bestanden. Die
  Wiederaufnahme-Prüfung scheiterte danach an einer momentanen Sammelabfrage
  der Bedienelemente. Laufende Terminalanfragen sperren den Schliessen-Knopf
  vorübergehend. Der Test prüft nun
  die tatsächliche bedienbare Schliessen-Bestätigung bei weiter fehlschlagenden
  Anzeigeanfragen statt eines momentanen `disabled`-Werts. Isoliert **30/0** mit
  gesperrten Blind-Eingaben, Abbrechen und positiver Wiederaufnahme. Keine
  Produktänderung; im abschliessenden seriellen Gesamtlauf ebenfalls **30/0**.
- Abschliessender fünfter Gesamtlauf vollständig grün, einschliesslich
  Electron-Pairing, verzögertem/fehlgeschlagenem Terminal-Import, Links/Bildern,
  Wiederaufnahme, Einrichtung und Bildvergleich. Keine Warnschwellen erhöht.
- Native Windows-Abnahme; Linux/WSLg, Windows→WSL und macOS sind getrennt zu bewerten.
  Ein echter Wechsel des physischen Tablets zwischen Heimnetz und Mobilfunk ist
  von Browser-/HTTPS-Automation zu unterscheiden. Der Nutzer hat den Projekt-
  und Linkzugriff vom physischen Tablet am 19. September bestätigt; die separate
  Rückmeldung zum Netzwechsel steht noch aus.

Persönliche Aktivierung am **19. September, 09:18 CEST**: Source
**`9c76087fb515f3b8c16e`**, PID **47752**, Release
`dist/pairing-recovery-9c76087fb515f3b8c16e`. Sechs Profile, sechs Projekte und
beide bisherigen aktiven Gerätekopplungen einschliesslich verschlüsselter
Schlüssel und Freigaben bytegleich erhalten. Sicherung:
`C:\Users\Adi.Muff\ADE-Backups\PairingRecovery-20260919-091828`.
Vorherige PID 36692 regulär über die Tray-Aktion beendet; Startmenü-Verknüpfung
aktualisiert. Die Aktivierung erfolgte nach den Kern- und fokussierten UI-Prüfungen,
während die vollständige Prüfung erneut lief; sie war noch keine Gesamtfreigabe.
Die nachträgliche Gesamtprüfung desselben Quellstands ist um **11:15 CEST**
vollständig bestanden. Die späteren Korrekturen betrafen ausschliesslich Tests.

Ein isoliertes Profil bestand die reale private Tailscale-HTTPS-Abnahme **9/0**
mit gültigem TLS, QR-Link, manueller Code-Kopplung, Reload, Widerruf und positiver
erneuter Kopplung. Die persönliche Instanz bestätigte danach sicheren Speicher,
Pairing-Erstellung und bytegleiche Auslieferung aller fünf Mobile-JavaScript-Dateien.
Das ursprüngliche Audit blieb mit **8.388.490 Bytes** als vorheriger Abschnitt
erhalten, der aktuelle Abschnitt hatte nach Aktivierung **4.195.022 Bytes**.
Die bestehende Tailscale-Serve-Konfiguration einschliesslich Port 3200 blieb
unverändert. Belege: `test-results/pairing-private-https.log`,
`test-results/pairing-restart.json`, `activation.json` im Release.
