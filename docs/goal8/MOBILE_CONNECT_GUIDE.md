# Tablet oder Smartphone mit ADE verbinden

1. `pnpm install` und `pnpm build`, danach ADE mit `pnpm start` öffnen.
   Für Entwicklung die mobile Oberfläche mit `pnpm build:mobile` bauen;
   `pnpm dev` aktualisiert die Desktop-Oberfläche.
2. Tailscale auf PC und Mobilgerät installieren, anmelden und mit demselben
   Tailnet verbinden. Auf dem PC müssen MagicDNS und HTTPS verfügbar sein.
3. In ADE: **Settings → Mobiler Zugriff → Mit Tailscale aktivieren**.
   ADE prüft den CLI-Status, startet seinen Listener auf `127.0.0.1:4317` und
   richtet eine private HTTPS-Freigabe über Tailscale Serve ein.
   **Private Freigabe eingerichtet** bestätigt die Konfiguration;
   **HTTPS-Verbindung bestätigt** erscheint erst nach einer erfolgreichen
   HTTPS-Anfrage mit normaler Zertifikatsprüfung vom PC.
4. **Tablet oder Smartphone koppeln** wählen. Den QR-Code auf dem Mobilgerät
   scannen, einen Gerätenamen eingeben und **Dieses Gerät verbinden** wählen.
   Alternativ die angezeigte ADE-Adresse öffnen und den Pairing-Code einfügen.
   Der Code gilt fünf Minuten und funktioniert einmal. Neuer Code oder
   Schliessen des Pairings macht den bisherigen Code ungültig.
5. **Overview** zeigt Agents, Projects und die letzten Runs wie auf dem Desktop.
   **Neue Aufgabe** oder einen Agent/Projekt-Eintrag wählen, Aufgabe schreiben
   und starten. Für **Neuer Run** mindestens zwei Agents wählen; der zuerst
   gewählte koordiniert. Run vorbereiten, Namen/Budget prüfen und im Inspector
   **Run starten** wählen. **Work** durchsucht und filtert alle verfügbaren Runs;
   **Graph** zeigt die Teamstruktur. Nodes auswählen, um deren Tasks anzusehen.
6. Für den Home-Bildschirm die Installationsfunktion des Browsers verwenden.
   Jeder Browser bzw. jede separat gespeicherte PWA-Installation kann eine
   eigene Kopplung benötigen. Keine native iOS-/Android-App erforderlich.

Bei aktiviertem mobilen Zugriff bleibt ADE nach dem Schliessen des Fensters
im Infobereich aktiv. Über das ADE-Symbol lässt sich das Fenster öffnen oder
ADE vollständig beenden. Der PC muss eingeschaltet, angemeldet und online
bleiben. Ein schlafender PC wird nicht automatisch geweckt. Automatischer
Windows-Loginstart ist noch kein Teil dieser Umsetzung.

**Geräte entfernen:** Settings → Verbundene Geräte → Gerät entfernen widerruft
sofort den Zugriff und trennt offene Verbindungen. Bereits angenommene Aufgaben
laufen weiter. **Settings → Dieses Gerät lokal trennen** im Browser löscht dessen lokalen
Schlüssel; den dauerhaften Widerruf führt man am PC aus.

**Ansicht und Bedienung:** Die mobile Oberfläche verwendet die Desktop-Farben,
Schrift und Agent-Symbole. Dark/Light ist pro Browser einstellbar. Auf dem Tablet
stehen Graph und Inspector nebeneinander; auf dem Handy öffnet die Auswahl eine
Detailansicht. Escape schliesst sie und setzt den Fokus zurück. Pfeiltasten sowie
Home/End wechseln die Ansicht; Enter/Leertaste wählen Graph-Nodes. Der Graph
lässt sich scrollen, zoomen und einpassen. Auftragsentwürfe bleiben beim Wechsel
der Ansicht oder des Themes in der offenen Seite erhalten.

**Neue Version aktivieren:** Eine bereits laufende ADE-Version hält die mobile
Oberfläche im Speicher. Ein Build oder Neuladen am Handy allein ersetzt sie
nicht. Zu einem passenden Zeitpunkt ADE über das Tray-Menü vollständig beenden
und mit `pnpm start` neu öffnen; danach die Mobilseite neu laden. Die bestehende
Gerätekopplung bleibt erhalten. Während dieser Umsetzung wird eine bestehende
Sitzung nicht automatisch neu gestartet. Aktive Aufgaben vor einem eigenen
Neustart abschliessen oder gezielt beenden; ein Host-Neustart stoppt deren PTYs.

**Wenn die Verbindung fehlt:**

- Beide Geräte in Tailscale online halten. Adresse aus ADE verwenden; keine
  lokale IP und keinen Router-Port öffnen.
- Bei fehlender HTTPS-Freigabe die Statusmeldung in ADE befolgen. Tailscale
  kann die Bestätigung von HTTPS im Tailnet verlangen. Danach in ADE erneut
  aktivieren. ADE protokolliert keine Anmelde-URLs oder CLI-Ausgaben.
- Die erstmalige DNS-/Zertifikatsbereitstellung durch Tailscale kann mehrere
  Minuten dauern. Bei ausstehender HTTPS-Prüfung Tailscale online lassen und
  **Verbindung prüfen** verwenden. ADE wiederholt die echte Prüfung; es
  deaktiviert dafür weder die Zertifikatsprüfung noch die Firewall.
- Bestehende HTTPS-Freigaben werden bei Konflikten nicht überschrieben.
  Funnel wird abgewiesen. Andere Tailscale-Ports bleiben erhalten.
- Ist Port 4317 belegt, den Konflikt beheben oder vor ADE-Start den begrenzten
  Loopback-Port über `ADE_MOBILE_PORT` (1024–65535) einstellen. Der alte
  `ADE_HOST_API_ENABLED`-Modus muss für den mobilen Einstieg ausgeschaltet sein.
- Gerätezeit automatisch synchronisieren. Signaturen tolerieren fünf Minuten
  Abweichung. Bei Widerruf neu koppeln; bei Netzverlust erneut verbinden.
- Bei unklarer Auftragsantwort **Diesen Auftrag erneut prüfen** verwenden.
  Diese Wiederholung behält dieselbe Vorgangs-ID. Die Oberfläche sendet nach
  einem Offline-Zustand keine vorgemerkten Aufgaben automatisch ab.
  Mit dem Tablet-Projektstart-Update bleiben Auftragsentwurf und Vorgangs-ID
  auch nach Neuladen auf diesem Gerät erhalten. Widerruf oder lokales Trennen
  löscht diese Daten; eine Wiederholung erfolgt ausschliesslich auf deinen Klick.
- Sichere Schlüsselablage und Audit müssen verfügbar sein. Das Audit hat eine
  8-MiB-Grenze; bei beschädigter/voller Ablage bleiben Geräte gesperrt. Daten vor
  manueller Wartung sichern und untersuchen; keine automatische Löschung.

Die mobile Oberfläche zeigt den Run-/Aufgabenstatus und den Freigabebedarf.
Detaillierte Ergebnisberichte, Diffs, Genehmigungen, Publishing und Terminals
bleiben im Desktop. Benachrichtigungen und Loginstart sind Folgegoals.

**Remote-Verwaltung (Goals 12–15):** Nach Update/Build und einmaligem normalem
Neustart in **Settings → Verbundene Geräte** die gewünschten Verwaltungsrechte
für das gekoppelte Gerät anhaken und **Verwaltungsrechte speichern** wählen.
Bestehende Geräte erhalten diese Rechte nicht automatisch. Nach der erneuten
Verbindung bietet **Settings → ADE auf dem PC** den Fernneustart, sofern keine
Arbeit läuft. Erfolg wird erst nach Erreichen der neuen Host-Instanz bestätigt.
Dies ist für `pnpm start` auf nativem Windows geprüft; installierte Pakete und
andere Startmodelle erhalten noch keine Neustartfreigabe.

**Verwalten** öffnet die Projekt-/Agent-Verwaltung. **Neues Projekt** erstellt
ein natives Git-Projekt in ADEs eigenem Projektordner; die erste Version
initialisiert lokal und klont noch keine externen Repository-URLs. **Agents**
legt einen neuen Agent aus einem Codex-Standardprofil oder vorhandenen
Agent-/Template-Einstellungen an. **Workspace vorbereiten** verbindet den
gewählten Agent mit einem isolierten Arbeitsordner im gewählten Projekt.

Unter **Git-Abgleich** zuerst das Projekt und **Git-Zustand prüfen** wählen.
**Änderungen abrufen** aktualisiert die origin-Informationen. Danach eine lokale
oder origin-Basis wählen, **Update prüfen** und das konkrete **Fast-forward**
bestätigen. Ungesicherte Änderungen, eigene Commits und laufende Arbeit zeigen
einen Sperrgrund. Kein automatisches Zurücksetzen oder Pushen.

**Work** und **Graph** filtern nach Projekt und Agent. Der Task-Slot-Zähler gilt
über alle Projekte. Einzelaufgaben und Managed Runs halten je Projekt einen
eigenen Entwurf auf dem gekoppelten Gerät; Seitenneuladen erhält ihn, lokales
Trennen löscht ihn. Bei unklarer Verwaltungsantwort **Aktion erneut prüfen**
wählen; Offline-Aktionen werden nicht automatisch nachgesendet.

**Neues Projekt und Weiterarbeiten:** Der aktuelle Einstieg mit einem eigenen
Projekt-Stammordner, Codex-Start, erhaltenen Entwürfen und Tablet-Arbeitsansicht
steht in [TABLET_PROJECT_START.md](../TABLET_PROJECT_START.md).

Entwicklungstests: `pnpm exec playwright install chromium`, danach
`pnpm test:mobile-access`, `pnpm test:mobile-browser`, `pnpm test:mobile-electron`
oder das vollständige `pnpm verify`. Browser-TLS-Fixtures sind ausschliesslich
Testmaterial; der echte Tailscale-Test verwendet normale Zertifikatsprüfung.
Zusätzlich: `pnpm exec playwright install webkit`, dann `pnpm test:mobile-webkit`.
Die Windows-WebKit-Messung ersetzt keinen Test auf iOS; bekannte Messgrenzen
stehen in `MOBILE_CONNECT_RESULTS.md`.

Der separate Operatortest `pnpm test:mobile-tailscale --enable-private-serve`
verwendet ein temporäres ADE-Profil und die echte private Freigabe dieses PCs.
Vorher die reguläre ADE-Instanz beenden und Port 4317 freihalten. Er entfernt
nur eine selbst eingerichtete Route und überschreibt keine fremde Konfiguration.
Er gehört wegen dieser realen Tailscale-Änderung nicht zum automatischen Verify-Gate.

Quellen: [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve),
[Serve-CLI](https://tailscale.com/docs/reference/tailscale-cli/serve).
