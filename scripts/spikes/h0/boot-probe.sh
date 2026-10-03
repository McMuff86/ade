#!/usr/bin/env bash
# Goal 34.6 spike H0, experiment 5 (throwaway, not product code).
# Run once at login by ade-host-spike-boot.service. Logging only: it never
# reads or writes a secret, uses no network and gives up after 60 seconds.
# Writes one JSON line per observation to $XDG_STATE_HOME/ade-spike/boot-probe.jsonl
# (default ~/.local/state) and the same line to stdout (journal).
set -u
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/ade-spike"
mkdir -p "$state_dir"
log="$state_dir/boot-probe.jsonl"
boot_id=$(cat /proc/sys/kernel/random/boot_id)

uptime_s() { cut -d' ' -f1 /proc/uptime; }
# Monotonic microseconds of a user unit, 0 if not (yet) active.
active_us() { systemctl --user show "$1" -p ActiveEnterTimestampMonotonic --value 2>/dev/null || echo 0; }
has_owner() { busctl --user --timeout=2 call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s org.freedesktop.secrets 2>/dev/null | awk '{print $2}'; }
daemon_running() { pgrep -u "$(id -u)" -x gnome-keyring-d >/dev/null && echo true || echo false; }

emit() { printf '%s\n' "$1" | tee -a "$log"; }

start_uptime=$(uptime_s)
emit "{\"event\":\"start\",\"bootId\":\"$boot_id\",\"uptimeS\":$start_uptime,\"busAddressSet\":$([ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] && echo true || echo false),\"secretsOwner\":\"$(has_owner)\",\"daemonRunning\":$(daemon_running),\"keyringServiceActiveUs\":$(active_us gnome-keyring-daemon.service),\"defaultTargetActiveUs\":$(active_us default.target)}"

# Passive wait (no activation) until the name has an owner, at most 60 s.
waited=0
while [ "$(has_owner)" != "true" ] && [ "$waited" -lt 120 ]; do sleep 0.5; waited=$((waited + 1)); done
emit "{\"event\":\"owner\",\"bootId\":\"$boot_id\",\"uptimeS\":$(uptime_s),\"secretsOwner\":\"$(has_owner)\",\"waitedHalfSeconds\":$waited,\"daemonRunning\":$(daemon_running)}"

# Read-only collection state. This may D-Bus-activate the service if it still
# has no owner; that is what a host would do too, and it is recorded.
collections=$(busctl --user --timeout=5 call org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.DBus.Properties Get ss org.freedesktop.Secret.Service Collections 2>&1 | grep -o '/org/freedesktop/secrets/collection/[A-Za-z0-9_]*' | tr '\n' ' ')
locked=""
for c in $collections; do
  value=$(busctl --user --timeout=5 get-property org.freedesktop.secrets "$c" org.freedesktop.Secret.Collection Locked 2>/dev/null | awk '{print $2}')
  locked="$locked{\"collection\":\"${c##*/}\",\"locked\":\"${value:-unknown}\"},"
done
emit "{\"event\":\"collections\",\"bootId\":\"$boot_id\",\"uptimeS\":$(uptime_s),\"collections\":[${locked%,}],\"daemonRunning\":$(daemon_running)}"
exit 0
