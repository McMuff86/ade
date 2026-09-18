# Durchgängige native Codex-Prüfung mit Tablet-Oberfläche

18. September 2026. Anschluss an die aktivierte Eleven-v3-/Terminal-Version
`5f58bdaefddb8640de7b`. Die bisherige Abnahme verbindet einen echten Codex-
Protokolltest mit einem separaten Electron-/Browser-Test gegen einen lokalen
Protokollpeer. Dieser zusätzliche Driver prüft beide Teile zusammen.

## Umfang

`scripts/test-tablet-codex-native.ts --run-native` verwendet den bestehenden
Produktionsbuild, ein separates Electron-Profil, ein temporäres Git-Projekt mit
dauerhafter `AGENTS.md` und einen neu gekoppelten Chromium-Browser. Ausschliesslich
die lokale Tailscale-Erkennung wird simuliert. Die signierte Host-API, das
ADE-Gespräch, Bestätigung, Produktionsqueue, Workspace-Zuteilung und die
installierte Codex-CLI arbeiten unverändert zusammen.

Der Driver prüft vor Modellaufrufen die Build-Identität und CLI-Version 0.154.0.
Angefordert werden `gpt-5.6-sol`, Reasoning `high` und Bypass-Modus. Der Koordinator
muss das tatsächlich beobachtete Modell und Reasoning bestätigen. Der Auftrag
fordert eine native Rückfrage, wartet auf einen erst danach erzeugten Antwortwert
und schreibt nur `tablet-result.txt` im geleasten Checkout. Git gehört ADE.

Die bewusste Auftragsbestätigung verliert testweise ihre HTTP-Antwort. Nach Reload
müssen genau ein Auftrag und seine Elternzuordnung erhalten bleiben. Während der
Rückfrage folgt ein Offline-/Online-Wechsel. Die ursprüngliche Frage muss wieder
beantwortbar sein. Danach werden echte Datei, Ergebnis, Git-Zustand und Graph-
Zuordnung geprüft. Ein echter Neustart der isolierten Electron-Instanz muss
dasselbe abgeschlossene Ergebnis und dieselbe Gerätekopplung wiederherstellen.

Der Test ist wegen echter Modellaufrufe bewusst opt-in und gehört nicht zum
deterministischen `pnpm verify`. Aufruf:

```powershell
pnpm exec tsx scripts/test-tablet-codex-native.ts --run-native
```

## Stand und Grenzen

Der erste native Versuch (**5/1**) traf auf eine gültige Auswahlfrage mit
„Eigene Antwort“, während der Driver nur das sofort sichtbare Textfeld erwartete.
Der Driver bedient jetzt beide Frageformen. Ein zweiter Versuch fand tatsächlich
veränderte Projektanweisungen beim Einzelauftragsstart: Ohne Managed-Phasenlaunch
ging der Codex-Start noch durch die ältere `AGENTS.md`-Injektion.

Der deterministische Electron-Driver reproduziert beide fehlenden Verträge mit
**55/2**: Projektanweisungen verändert und Profil/Memory nicht im nativen
Auftragskontext. Korrektur: Fragefähige native Einzelaufträge erhalten einen
begrenzten, unveränderlichen Profil-/Memory-Snapshot direkt im Prompt. Der
Snapshot wird vor Prozessstart erneut geprüft; Repository und Auftragsanweisung
behalten Vorrang. Repositorydateien werden dafür nicht geschrieben. Verwaltete
Phasenaufträge nutzen weiterhin ihren vorhandenen Kontext.

Alle TypeScript-Projekte und der Produktionsbuild bestanden. Positive
Electron-Kontrolle **57/0**. Die anschliessende echte native Wiederholung besteht
**16/0**: native Vorschlagserstellung, genau ein Auftrag nach verlorener Quittung,
unveränderte Projektanweisungen, dieselbe Frage nach Offline/Reload, tatsächliche
Datei mit der über das Tablet übergebenen Antwort, unveränderte Git-HEADs, korrekte
Projektzuordnung sowie dasselbe vollständige Ergebnis und dieselbe Kopplung nach
Neustart der isolierten Electron-Instanz. Screenshots: `completed-phone.png` und
`restarted-phone.png` im Nachweisordner.

Die vollständige Gesamtabnahme ist bestanden: **Exit 0**, am 18. September
**03:46–04:14 CEST**. Drei TypeScript-Projekte, **90 Suiten / 3.709 Prüfungen**,
Produktionsbuild und sämtliche Electron-/Chromium-/Darstellungstests.
`test-results/tablet-native-verify.log` und `tablet-native-verify-exit.json`
dokumentieren den Abschluss. Der erweiterte Gesprächsdriver besteht auch hier
**57/0**; Cursor/Wiederaufnahme **29/0**, Eingabeüberschneidungen **15/0**.
Belege liegen unter `test-results/tablet-codex-native/` und
`test-results/tablet-codex-native-run.log`. Negative und
positive deterministische Logs: `tablet-codex-guidance-negative.log` und
`tablet-codex-guidance-positive.log` in `test-results`.

## Aktivierung

Isolierter Start bestanden. Persönlich aktiviert am **18. September 2026,
04:15 CEST**, Source **`5cf7ef2ca9b2b4a1ad54`**, Release
`dist/tablet-native-5cf7ef2ca9b2b4a1ad54`, PID **40124**. Der vorherige Prozess
15008 wurde über den regulären ADE-Tray-Befehl beendet. Die Startmenü-Verknüpfung
zeigt auf den neuen Build. Sicherung:
`C:\Users\Adi.Muff\ADE-Backups\TabletNative-20260918-041549`.

Sechs Profile, sechs Projekte und eine Tablet-Kopplung sind nachweislich erhalten.
Privates HTTPS antwortet mit 200 und bytegleich dem neuen Mobile-Bundle; die
Rhino-Git-Abfrage liefert fünf echte Commits. Alle drei kompilierten Oberflächen
bestätigen dieselbe Source-ID. Die Aktivierung startete keinen Modell- oder
Sprachaufruf. Eleven v3/Sarah und die vorherigen Tablet-Korrekturen bleiben enthalten.
Belege: `test-results/tablet-native-isolated-proof.json`,
`test-results/tablet-native-restart.json` sowie `activation.json` im Release.

Dies ist ein automatisierter Chromium-Bediennachweis unter nativem Windows,
kein physischer Samsung-, Mikrofon- oder Hörtest. Der Auftragsneustart wird nach
abgeschlossener Arbeit geprüft; Wiederaufnahme laufender Modellprozesse nach
Host-Neustart ist damit nicht behauptet. Die persönliche Tablet-Anleitung bleibt
[TABLET_CODEX_TEST.md](TABLET_CODEX_TEST.md).
