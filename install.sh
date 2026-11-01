#!/usr/bin/env bash
# install.sh - install prompts, dt.mjs, overlays and config.json (if missing); run the selftest
set -euo pipefail

if [ "$#" -gt 0 ]; then
  echo "usage: ./install.sh (to remove: ./uninstall.sh [--purge])"
  case "$1" in -h|--help) exit 0 ;; *) exit 2 ;; esac
fi

KIT="$(cd "$(dirname "$0")" && pwd)"
PI="${PI_AGENT_DIR:-$HOME/.pi/agent}"
PROMPTS="$PI/prompts"
DT="$PI/dt"

command -v node >/dev/null || { echo "node 18+ is required"; exit 1; }
mkdir -p "$PROMPTS" "$DT/overlays" "$DT/features"
cp "$KIT"/prompts/dt-*.md "$PROMPTS"/
cp "$KIT"/dt.mjs "$DT"/dt.mjs
cp "$KIT"/overlays/*.md "$DT"/overlays/
if [ ! -f "$DT/config.json" ]; then
  cp "$KIT/config.example.json" "$DT/config.json"
  echo "created $DT/config.json - check the lane paths"
fi
node "$DT/dt.mjs" selftest
echo "installed $(ls "$KIT"/prompts/dt-*.md | wc -l | tr -d ' ') prompts -> $PROMPTS; dt.mjs + overlays -> $DT"
command -v gh >/dev/null || echo "note: gh is not installed; issues, PRs and review comments will not work"
echo "now: /reload in pi, then /dt-grill <task>"
