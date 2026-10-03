#!/usr/bin/env bash
# Goal 34.6 spike H0, experiment 5 (throwaway, not product code).
# Run once after a real reboot with ade-host-spike-boot.service enabled.
# Collects the probe lines of the current boot plus unit timestamps and the
# unit journal, and appends an "Experiment 5 — Ergebnis nach Reboot" section to
# the H0 protocol. Read-only apart from that append; it does not remove the unit
# (see the teardown in the protocol).
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../.." && pwd)
protocol="$repo/docs/research/host/H0_SPIKE_2026-10-03.md"
log="${XDG_STATE_HOME:-$HOME/.local/state}/ade-spike/boot-probe.jsonl"
boot_id=$(cat /proc/sys/kernel/random/boot_id)

preparation_boot=16f1f43a-8b62-412b-bb27-d934d3a2bd6a
[ "$boot_id" != "$preparation_boot" ] || { echo "Still the boot of the preparation ($boot_id): no reboot yet, nothing collected." >&2; exit 1; }
[ -f "$log" ] || { echo "No probe log at $log - was the unit enabled before the reboot?" >&2; exit 1; }
grep -q "\"bootId\":\"$boot_id\"" "$log" || { echo "No probe lines for the current boot $boot_id - reboot still pending?" >&2; exit 1; }

show() { systemctl --user show "$1" -p "$2" --value 2>/dev/null || echo 0; }
default_us=$(show default.target ActiveEnterTimestampMonotonic)
basic_us=$(show basic.target ActiveEnterTimestampMonotonic)
keyring_us=$(show gnome-keyring-daemon.service ActiveEnterTimestampMonotonic)
probe_start_us=$(show ade-host-spike-boot.service ExecMainStartTimestampMonotonic)
probe_result=$(show ade-host-spike-boot.service Result)
journal=$(journalctl --user -b -u ade-host-spike-boot.service -o short-precise --no-pager 2>/dev/null | tail -n 20)

BOOT_ID="$boot_id" LOG="$log" DEFAULT_US="$default_us" BASIC_US="$basic_us" KEYRING_US="$keyring_us" \
PROBE_START_US="$probe_start_us" PROBE_RESULT="$probe_result" JOURNAL="$journal" python3 - >>"$protocol" <<'PY'
import json, os, datetime
boot = os.environ["BOOT_ID"]
all_lines = [json.loads(l) for l in open(os.environ["LOG"]) if l.strip()]
# The unit runs whenever default.target is reached, so a re-login without a
# reboot adds lines under the same boot id. Group by boot id; only the current
# boot id (different from the boot during preparation) is the reboot evidence.
groups = {}
for l in all_lines: groups.setdefault(l["bootId"], []).append(l)
lines = groups.get(boot, [])
logins = sum(1 for l in lines if l["event"] == "start")
us = lambda k: int(os.environ[k] or 0)
default, basic, keyring, probe = us("DEFAULT_US"), us("BASIC_US"), us("KEYRING_US"), us("PROBE_START_US")
rel = lambda t: "nicht aktiv" if not t or not default else f"{(t - default) / 1000:+.0f} ms"
# /proc/uptime equals CLOCK_MONOTONIC until the first suspend after boot.
# First login of this boot = the boot itself; later ones are re-logins.
first_login = lines[:3]
ev = {}
for l in first_login: ev.setdefault(l["event"], l)
start = ev.get("start", {}); owner = ev.get("owner", {}); cols = ev.get("collections", {})
print(f"\n### Experiment 5 — Ergebnis nach Reboot ({datetime.date.today().isoformat()}, Boot-ID `{boot}`)\n")
print("Eingesammelt mit `scripts/spikes/h0/boot-collect.sh`. Zeiten relativ zu `default.target` der Benutzersitzung.\n")
print("Einträge nach Boot-ID (der Eintrag der aktuellen Boot-ID ist der Reboot-Nachweis; die Vorbereitung lief unter `16f1f43a-8b62-412b-bb27-d934d3a2bd6a`):\n")
for b, ls in groups.items(): print(f"- `{b}`: {sum(1 for l in ls if l['event'] == 'start')} Anmeldung(en){' **← Reboot-Nachweis**' if b == boot else ''}")
print(f"\nDie Tabelle verwendet die erste von {logins} Anmeldung(en) unter der aktuellen Boot-ID; das ist der eigentliche Boot.\n" if logins > 1 else "")
print("| Ereignis | relativ zu `default.target` |\n|---|---|")
print(f"| `basic.target` aktiv | {rel(basic)} |")
print(f"| `gnome-keyring-daemon.service` aktiv | {rel(keyring)} |")
print(f"| Probe gestartet (`ade-host-spike-boot.service`) | {rel(probe)} |")
if start: print(f"| Probe-Beobachtung `start` | {rel(int(start['uptimeS'] * 1e6))} |")
if owner: print(f"| `org.freedesktop.secrets` hat Besitzer | {rel(int(owner['uptimeS'] * 1e6))} (gewartet {owner.get('waitedHalfSeconds', 0) * 0.5:.1f} s) |")
print(f"\n- Unit-Ergebnis: `{os.environ['PROBE_RESULT']}`")
j = lambda v: json.dumps(v)
if start: print(f"- Beim Start: Bus-Adresse gesetzt `{j(start.get('busAddressSet'))}`, Secret Service hatte Besitzer `{start.get('secretsOwner')}`, Daemon lief `{j(start.get('daemonRunning'))}`")
if cols: print("- Sammlungen: " + ", ".join(f"`{c['collection']}` Locked={c['locked']}" for c in cols.get("collections", [])))
print("\nRohdaten:\n\n```")
for l in lines: print(json.dumps(l, ensure_ascii=False))
print("```\n\nJournal der Unit:\n\n```")
print(os.environ["JOURNAL"])
print("```")
PY
echo "Appended experiment 5 result to $protocol"
