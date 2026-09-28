#!/usr/bin/env bash
# Keeps the native Linux and native Windows checkouts of ADE in step via origin.
#
#   ade-sync save [message]   before leaving this OS: commit everything, push the branch
#   ade-sync load             after booting this OS: fast-forward pull, reinstall if deps changed
#   ade-sync status           fetch and show branch, local changes, ahead/behind
#
# Windows counterpart: scripts/ade-sync.ps1. ADE_SYNC_PNPM overrides the pnpm command.
set -euo pipefail

repo="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$repo"

info() { printf '\033[1;36m[ade-sync]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[ade-sync]\033[0m %s\n' "$*" >&2; exit 1; }

branch() {
  git symbolic-ref --quiet --short HEAD || fail "Kein Branch ausgecheckt (detached HEAD). Erst einen Branch auschecken."
}

is_dirty() { [ -n "$(git status --porcelain)" ]; }

pnpm_cmd() {
  if [ -n "${ADE_SYNC_PNPM:-}" ]; then
    # shellcheck disable=SC2086
    $ADE_SYNC_PNPM "$@"
  elif command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
  else
    local version
    version="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' package.json)"
    mise exec "pnpm@${version:-9}" -- pnpm "$@"
  fi
}

install_deps() {
  info "Installiere Abhängigkeiten für Linux …"
  pnpm_cmd install --frozen-lockfile
  # pnpm can skip Electron's postinstall; without path.txt electron-vite reports "Electron uninstall".
  if [ ! -f node_modules/electron/path.txt ]; then
    info "Lade Electron-Binary nach …"
    (cd node_modules/electron && node install.js)
  fi
  # node-pty has no Linux prebuild; compile it against Electron.
  pnpm_cmd run rebuild:pty
}

cmd_save() {
  local b message
  b="$(branch)"
  if is_dirty; then
    message="${1:-wip: sync von $(hostname) $(date '+%F %H:%M')}"
    git add -A
    git commit -m "$message"
    info "Commit auf '$b': $message"
  else
    info "Keine lokalen Änderungen."
  fi
  if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    git push
  else
    git push -u origin "$b"
  fi
  info "Gepusht. Du kannst jetzt das Betriebssystem wechseln."
}

cmd_load() {
  local b old new
  b="$(branch)"
  if is_dirty; then
    git status --short
    fail "Lokale Änderungen vorhanden. Erst 'ade-sync save' ausführen oder die Änderungen verwerfen."
  fi
  old="$(git rev-parse HEAD)"
  git pull --ff-only || fail "Pull nicht per Fast-Forward möglich: auf beiden Seiten wurde committet. Mit 'git pull --rebase' zusammenführen."
  new="$(git rev-parse HEAD)"

  if [ ! -d node_modules ]; then
    install_deps
  elif [ "$old" != "$new" ] && git diff --name-only "$old" "$new" | grep -qxE 'package\.json|pnpm-lock\.yaml'; then
    install_deps
  else
    info "Abhängigkeiten unverändert."
  fi

  if [ "$old" = "$new" ]; then
    info "'$b' war schon aktuell."
  else
    info "'$b' aktualisiert: $(git rev-list --count "$old..$new") neue Commits."
    info "App neu bauen und starten: pnpm build && pnpm start"
  fi
}

cmd_status() {
  local b counts
  b="$(branch)"
  git fetch --quiet origin
  info "Branch: $b"
  if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    counts="$(git rev-list --left-right --count 'HEAD...@{u}')"
    info "Nicht gepusht: ${counts%%[[:space:]]*}  ·  Noch nicht geholt: ${counts##*[[:space:]]}"
  else
    info "Noch nie gepusht (kein Upstream)."
  fi
  if is_dirty; then
    info "Lokale Änderungen:"
    git status --short
  else
    info "Keine lokalen Änderungen."
  fi
}

case "${1:-}" in
  save) shift; cmd_save "$@" ;;
  load) cmd_load ;;
  status) cmd_status ;;
  *) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
