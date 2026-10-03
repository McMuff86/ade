# Goal 34.6 H2 — Secrets-Tresor

Stand: 3. Oktober 2026. H2 folgt auf die abgeschlossene Trennung der
Composition Root (H1). Der Benutzer hat die Fortsetzung beauftragt und die
Arbeit ohne externe Orchestrator-Session bestätigt.

## Schrittfolge und aktueller Umfang

1. **H2a: Tresor-Kern und Migrationsempfänger.** Implementiert unter
   `src/main/host/secrets/`, noch nicht in `composeHost` verdrahtet. Echte
   AES-GCM- und Dateisystemtests mit einem injizierten Schlüsselbund-Port.
2. **H2b: nativer Linux-Schlüsselbund.** Offen: Profilbindung der OS-Einträge,
   Secret Service ohne Kernel-Fallback, Abfrage von `Locked` an der richtigen
   Sammlung, Erkennung des passwortlosen GNOME-Schlüsselbunds, begrenzte
   Aufrufe, Retry und Dienst-/Sperrwechsel. Isolierte D-Bus-Tests einschliesslich
   `ELECTRON_RUN_AS_NODE`; keine Versuche am persönlichen Schlüsselbund.
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
`desktopSecrets`/`safeStorage`. H2a verändert keine laufenden Stores, keine
IPC-Kanäle, keine UI und keine Startentscheidung. Seine Proben simulieren den
OS-Port; sie belegen keinen nativen Schlüsselbund-Anschluss oder vollständige
Migration der drei produktiven Dateiformate.

## Kernvertrag H2a

`HostSecretVault(file, profileId, keyring)` verlangt eine stabile Profil-ID als
SHA-256-Hexwert und einen profilgebundenen `WrappingKeyStore`. Der Aufrufer
muss bereits den exklusiven Profilbesitz halten; der Dateifingerabdruck ist
nur eine zweite Schutzlinie, keine Mehrprozess-Sperre. Die konkrete Ableitung
der stabilen Profil-ID und die produktive Dateiposition werden beim Anschluss
festgelegt. Der Port liefert eigene Buffer, die der Kern nach Gebrauch löscht,
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
Native Windows-/DPAPI-, Secret-
Service- und UI-Nachweise sind in diesem Schritt nicht gemessen.
