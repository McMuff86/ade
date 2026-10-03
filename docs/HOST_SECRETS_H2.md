# Goal 34.6 H2 — Secrets-Tresor

Stand: 4. Oktober 2026. H2 folgt auf die abgeschlossene Trennung der
Composition Root (H1). Der Benutzer hat die Fortsetzung beauftragt und die
Arbeit ohne externe Orchestrator-Session bestätigt.

## Schrittfolge und aktueller Umfang

1. **H2a: Tresor-Kern und Migrationsempfänger.** Implementiert unter
   `src/main/host/secrets/`, noch nicht in `composeHost` verdrahtet. Echte
   AES-GCM- und Dateisystemtests mit einem injizierten Schlüsselbund-Port.
2. **H2b: nativer Linux-Schlüsselbund.** Implementiert: Profilbindung,
   ausschliesslich Secret Service, Sperrprüfung der tatsächlichen Sammlung
   und des Eintrags, GNOME-Protektion, begrenzter Kindprozess, Polling/Retry.
   Gemessen mit privatem D-Bus unter Node und `ELECTRON_RUN_AS_NODE` (unten).
3. **H2c: Desktop-Migration und Konsumenten.** Offen: alle Werte aus
   `harness-credentials.json`, `remote/devices.json` und `remote/push.json`
   über Electron `safeStorage` lesen, striktes Manifest aus verschlüsselten
   Quellen bilden, an den Empfänger übergeben, jeden Eintrag bestätigen und
   den vollständigen Satz abschliessen. Metadaten (Scopes, Gerätewiderrufe,
   Audit, Push-Zustand) erhalten. Stores auf Host-Tresor umstellen;
   Altbestände erst nach bestätigtem Gesamtabschluss und mit einem geprüften
   Rollback-Verfahren entfernen. Der authentifizierte Prozesskanal kommt H3;
   bis dahin bleibt jede Übergabe innerhalb des Main-Prozesses.
4. **H2d: sichtbare Zustände und Abnahme.** Offen: verständliche Zustände auf
   Desktop/Tablet, Starts mit betroffenen Zugangsdaten blockieren, Arbeit ohne
   Zugangsdaten ermöglichen, Recovery nach Entsperren; Playwright-Abnahme und
   vollständiges `pnpm verify`. Windows-DPAPI bleibt eine separate Messung.

**H2 ist damit nicht abgeschlossen.** Produktiv verwendet ADE weiterhin
`desktopSecrets`/`safeStorage`. H2a/H2b verändern keine laufenden Stores, keine
IPC-Kanäle, keine UI und keine Startentscheidung. H2a simuliert den OS-Port,
H2b misst einen echten isolierten Secret Service. Die vollständige Migration
der drei produktiven Dateiformate bleibt H2c.

## Kernvertrag H2a

`HostSecretVault(file, profileId, keyring)` verlangt eine stabile Profil-ID als
SHA-256-Hexwert und einen profilgebundenen `WrappingKeyStore`. Der Aufrufer
muss bereits den exklusiven Profilbesitz halten; der Dateifingerabdruck ist
nur eine zweite Schutzlinie, keine Mehrprozess-Sperre. H2b leitet die Profil-ID
aus dem kanonischen Profilpfad ab; die produktive Dateiposition folgt H2c.
Der Port liefert eigene Buffer, die der Kern nach Gebrauch löscht,
und muss beim Erzeugen einen bestehenden Schlüssel unangetastet lassen.

- Ein 256-Bit-Schlüssel liegt nur im OS-Port und im Speicher des geöffneten
  Tresors. Die Datei enthält `ADEVAULT` + Version 1, einen zufälligen 96-Bit-
  Nonce, einen 128-Bit-GCM-Tag und den verschlüsselten Gesamtzustand. AES-256-GCM
  authentifiziert zusätzlich Version/Zweck und Profil-ID. Auch Namen und
  Migrationsbestätigungen liegen verschlüsselt vor.
- Höchstens 2 MiB Datei, 256 Einträge, 512 KiB UTF-8 je Wert; IDs sind auf
  `harness:`, `service:`, `device:` und `push:` begrenzt. Struktur, Grössen,
  Dopplungen und Migrationseinträge werden nach Entschlüsselung geprüft.
- Neue Datei 0600, neues Verzeichnis 0700 unter Unix; symbolische Links in
  Pfadkomponenten und Hardlinks auf die Datei werden verweigert. Begrenzte
  Deskriptor-Lesezugriffe erkennen Austausch/Änderung. Schreiben erfolgt mit
  zufälliger exklusiver Temp-Datei, fsync, Fingerabdruckprüfung, Rename und
  Verzeichnis-fsync (Unix); anschliessend authentifizierter Read-back.
- `refresh()` verwirft zuerst den bisherigen Schlüssel und Zustand. `locked`
  verhindert schon das Lesen eines vermeintlich fehlenden Schlüssels; vor
  einer Erzeugung und nach dem Lesen wird erneut geprüft. Fehlender Schlüssel
  bei vorhandener Datei, falscher Schlüssel, defekte Daten oder Providerfehler
  ergeben `unavailable`, ohne Ersatzschlüssel oder Klartext-Fallback.
  Erstinitialisierung schreibt sofort einen leeren verschlüsselten Tresor;
  vorhandener OS-Schlüssel bei fehlender Datei wird ebenfalls verweigert.
  Ein Abbruch zwischen OS-Erzeugung und erster Datei braucht daher eine
  ausdrückliche Reparatur im späteren Anschluss, keine automatische Löschung.
- Diagnose besteht nur aus fest definierten Zuständen/Gründen und
  `encrypted`/`passwordless`/`unknown` für die Schlüsselbund-Protektion. Native
  Fehlermeldungen, Werte und Hostpfade werden nicht übernommen. Es gibt hier
  keine automatische Beobachtung von OS-Ereignissen: der spätere Adapter muss
  bei Sperr-/Dienstwechseln `refresh()` aufrufen und Startentscheidungen sperren.
- Die Migration beginnt mit einem Digest des **verschlüsselten** Quellmanifests.
  Jeder Import wird dauerhaft gespeichert und erst nach Read-back bestätigt.
  Wiederholte identische Einträge sind idempotent; anderer Quell-Digest oder
  veränderter Wert wird verweigert. Abschluss verlangt die exakte erwartete
  ID-Menge. Solange er fehlt, sind normales Lesen, Schreiben und Löschen
  blockiert. Der Sender ist dafür verantwortlich, diese erwartete Menge aus
  allen drei validierten Quellen zu bilden. Spätere Wiederholungen können
  keine gelöschten Zugangsdaten wiederherstellen.
- Der Empfänger erhält keine Altdatei-Pfade und löscht keine Altdateien.
  `close()` sperrt endgültig; ein noch laufendes `refresh()` kann ihn nicht
  wieder öffnen. JavaScript-Strings sind nicht zuverlässig überschreibbar;
  ein Löschen aller Klartextkopien aus dem Heap wird nicht behauptet.

## Nativer Linux-Anschluss H2b

- `LinuxWrappingKeyStore` spricht einen eigenen, kurzlebigen Node-Kindprozess
  `keyringWorker.js` an. Der Build emittiert ihn neben `main/index.js`; beide
  können gemeinsame Chunks unter `main/chunks/` laden. Ein Hoststart mit dem
  Electron-Binary reicht `ELECTRON_RUN_AS_NODE=1` an den Worker weiter.
- `@napi-rs/keyring` ist auf **2.1.0** gepinnt und bekommt immer
  `linux.store: 'secret-service'`. Weder Kernel-Keyring noch ein Klartext-Store
  sind Ausweichmöglichkeiten. Die Bibliothek übernimmt den verschlüsselten
  D-Bus-Secret-Transport. Die Main-Seite importiert das native Modul nicht.
- Profil-ID: SHA-256 über Versions-/Zweckpräfix und `realpath(profileDir)`;
  Links sind verweigert, das Verzeichnis muss existieren. Die OS-Attribute
  lauten `service=com.adimuff.ade.host-vault.v1`, `username=<Profil-ID>`.
  Ein Verschieben des Profils ändert die Identität; automatischer Umzug ist
  nicht implementiert. Ein Betriebssystem-Benutzer hat seinen eigenen Bus.
- `busctl` liest nur Metadaten: eindeutiger Dienstbesitzer, passende **gesperrte
  und entsperrte** Einträge, tatsächliche Sammlung, `Locked`, `Modified` und
  Aliase. Mehrdeutige Einträge werden verweigert. Ein vorhandener Schlüssel
  bleibt an seine tatsächliche Sammlung gebunden, auch wenn `default` wechselt.
  Für einen neuen Eintrag muss die Default-Sammlung existieren und entsperrt
  sein; `session` ist kein dauerhafter Speicher und wird verweigert. ADE
  erzeugt/entsperrt keine Sammlung ausdrücklich. Ein fehlender Dienst wird
  als `unavailable` wiederholt geprüft; dieser Anschluss startet ihn nicht.
- Vor/nach nativen Aufrufen werden Besitzer, Sammlung und Zustand geprüft;
  Erzeugen verlangt einen fehlenden Eintrag und liest den Wert zurück.
  Exklusiver Profilbesitz bleibt Voraussetzung, kein atomarer Compare-and-set
  gegenüber fremden Prozessen desselben Benutzers wird behauptet. Die native
  Bibliothek kann bei einem Sperrwechsel nach der Prüfung intern einen
  Entsperrversuch auslösen; ADE ruft selbst keinen Prompt auf und begrenzt den
  Worker. Die explizit gemessenen gesperrten Fälle erreichen den Schreibaufruf
  nicht. Ein abgebrochener Schreibaufruf kann einen OS-Eintrag hinterlassen;
  H2a verweigert dann den stillen Neuaufbau eines fehlenden Tresors.
- Diagnose `passwordless`/`encrypted` liest **nur 16 Header-Bytes** der zum
  GNOME-Sammlungspfad gehörenden `.keyring`-Datei im XDG-Datenverzeichnis. Vorher
  werden Dienst-PID/Executable, Pfadlinks, Dateityp und Besitzer geprüft.
  Unbekannter Provider, Dateiposition oder Header ergibt `unknown`; die
  Header-Diagnose ist kein allgemeiner Beweis für den Schutz des Systems.
- Standardlimit: **8 Sekunden** pro Worker, **2 KiB** Antwort und **1 KiB**
  Anfrage; einzelne Metadaten-Aufrufe höchstens 2,5 Sekunden/32 KiB. Schlüssel
  gehen nur über stdin/stdout-Pipes, nie über argv, Dateien oder Logs. Native
  Fehler werden verworfen und feste Zustände zurückgegeben. Der Worker erhält
  nur Bus-/Profil-Umgebung, kein `NODE_OPTIONS` und keine CLI-Zugangsdaten.
- `SecretVaultMonitor` prüft gesund alle **2 Sekunden**, bei Ausfällen mit
  exponentiellem Backoff bis **30 Sekunden**. Die Generation umfasst
  Dienst/Sammlung/Eintrag/Änderungszeit und einen Digest des zufälligen
  256-Bit-Schlüssels: ein Schlüsselwechsel innerhalb derselben Sekunde darf
  den Cache nicht gültig lassen. Fehler invalidieren den Tresor vor dem Retry;
  geänderte Protektion wird ebenfalls übernommen. Es gibt keine permanente
  D-Bus-Signalverbindung. Erkennungszeit: Intervall plus begrenzte Aufrufdauer.
  H2c muss **vor credentialabhängigen Starts `checkNow()` abwarten**. Schliessen
  entfernt Timer und beendet den eigenen Worker; spätes Initialisieren nach
  Invalidierung darf keinen alten Schlüssel wieder freigeben.

Linux benötigt `busctl` unter `/usr/bin/busctl` und einen laufenden Secret
Service. Gemessen ist GNOME Keyring auf nativem Linux; KWallet, KeePassXC,
WSLg, Windows-UI/WSL-Backend, DPAPI, macOS und gepackte Distributionen sind
hier nicht gemessen. Das asar-Unpack-Muster für das native Modul ist vorbereitet,
aber allein noch kein Packaging-Nachweis.

Quellen zur Anschlussentscheidung:
[keyring-node 2.1.0](https://www.npmjs.com/package/@napi-rs/keyring?activeTab=readme),
[Secret-Service-Backend und sammlungsübergreifende Suche](https://docs.rs/dbus-secret-service-keyring-store/latest/src/dbus_secret_service_keyring_store/lib.rs.html),
[Secret Service API](https://specifications.freedesktop.org/secret-service/latest-single/),
[GNOME-Pfadkodierung](https://github.com/GNOME/gnome-keyring/blob/main/daemon/dbus/gkd-secret-util.c).

## Nachweise und Grenzen

`scripts/test-host-secret-vault.ts`: **59/0** unter nativem Linux, echte
Verschlüsselung und Dateien, injizierter OS-Port. Negativkontrollen: gesperrte
Sammlung mit fehlendem Schlüssel, Sperrwechsel vor Erzeugung, Schlüsselverlust,
falscher Schlüssel/Profil, manipulierte Version/Nonce/Tag/Chiffretext,
ungültiger authentifizierter Inhalt, Links, Limits, veralteter Schreiber,
abgebrochene Migration und fehlgeschlagenes Schreiben ohne Bestätigung.
Nach den Negativkontrollen wird ein intakter Tresor erfolgreich gelesen.

`host-boundary`: **18/0**, nun **215** erreichbare Module (Mindestzahl angehoben).
Typecheck aller drei Projekte grün. Die neue Suite gehört über `run-suites.ts`
zum bestehenden `suites`-Schritt von `scripts/verify.ts`. Finales `pnpm verify`
am 3. Oktober, 23:39–23:42 CEST: **30 bestanden / 0 Fehler / 16 nicht gemessen**,
**113 Suiten / 4.714 Checks**; Details im [Handoff](HANDOFF.md).
Das sind die H2a-Nachweise. H2b ergänzt `test-linux-keyring-boundary.ts`
(**21 Checks**, Prozessgrenzen, Retry, Cache-Invalidierung) und den
Linux-Treiber `linux-secret-service` in `verify.ts`: privater D-Bus ohne
Dienstverzeichnisse, eigener GNOME-Daemon und eigenes HOME/XDG, Node und
Electron-Node-Modus. `python3-dbus` und private GNOME-Testmethoden dienen nur
im Treiber zum Entsperren/Ändern der Fixtures; sie werden nicht ausgeliefert.
Der persönliche Bus/Schlüsselbund wird nicht verwendet. H2b-Endergebnis am
4. Oktober: **42/0** native Integration; **18/0** Host-Grenze mit **219 Modulen**;
vollständiges `pnpm verify` **31 bestanden / 0 Fehler / 16 nicht gemessen**,
**114 Suiten / 4.735 Checks** in 3 min 34 s. Umgebung: natives Linux,
Node 26.8.2, Electron 43.1.0, GNOME Keyring 50.0. Details und behobener
Modellwahl-Treiberrace: [aktueller Handoff](HANDOFF.md).
UI und Migration folgen H2c/H2d.
