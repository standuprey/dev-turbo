#!/usr/bin/env bash
# install.sh - install prompts, dt.mjs, overlays, the dev-turbo extensions and config.json (if missing); run the selftest
set -euo pipefail

if [ "$#" -gt 0 ]; then
  echo "usage: ./install.sh (to remove: ./uninstall.sh [--purge])"
  case "$1" in -h|--help) exit 0 ;; *) exit 2 ;; esac
fi

KIT="$(cd "$(dirname "$0")" && pwd)"
PI="${PI_AGENT_DIR:-$HOME/.pi/agent}"
PROMPTS="$PI/prompts"
DT="$PI/dt"
EXTENSIONS="$PI/extensions"

command -v node >/dev/null || { echo "node 18+ is required"; exit 1; }
mkdir -p "$PROMPTS" "$DT/overlays" "$DT/features" "$EXTENSIONS"
cp "$KIT"/prompts/dt-*.md "$PROMPTS"/
# Remove obsolete prompts when upgrading: ticket closure is handled by dt-approve.
rm -f "$PROMPTS/dt-status.md" "$PROMPTS/dt-accept.md" "$PROMPTS/dt-final-check.md"
cp "$KIT"/dt.mjs "$DT"/dt.mjs
cp "$KIT"/AGENTS.md "$DT"/AGENTS.md
cp "$KIT"/README.md "$DT"/README.md
cp "$KIT"/overlays/*.md "$DT"/overlays/
cp "$KIT"/extensions/dt-resume.ts "$EXTENSIONS"/dt-resume.ts
cp "$KIT"/extensions/dt-help.ts "$EXTENSIONS"/dt-help.ts
mkdir -p "$EXTENSIONS/dt-autocomplete"
cp "$KIT"/extensions/dt-autocomplete/index.ts "$KIT"/extensions/dt-autocomplete/completion.mjs "$EXTENSIONS/dt-autocomplete"/
mkdir -p "$EXTENSIONS/dt-session"
cp "$KIT"/extensions/dt-session/index.ts "$KIT"/extensions/dt-session/state.mjs "$KIT"/extensions/dt-session/lane-picker.mjs "$KIT"/extensions/dt-session/footer.mjs "$KIT"/extensions/dt-session/gates.mjs "$KIT"/extensions/dt-session/runtime.ts "$EXTENSIONS/dt-session"/
mkdir -p "$EXTENSIONS/dt-status"
cp "$KIT"/extensions/dt-status/index.ts "$KIT"/extensions/dt-status/status.mjs "$EXTENSIONS/dt-status"/
mkdir -p "$EXTENSIONS/dt-approve"
cp "$KIT"/extensions/dt-approve/index.ts "$EXTENSIONS/dt-approve"/
if [ ! -f "$DT/config.json" ]; then
  cp "$KIT/config.example.json" "$DT/config.json"
  echo "created $DT/config.json - check the lane paths"
fi
node "$DT/dt.mjs" selftest
echo "installed $(ls "$KIT"/prompts/dt-*.md | wc -l | tr -d ' ') prompts -> $PROMPTS; dt.mjs + docs + overlays -> $DT; help + status + approve + resume + session + autocomplete -> $EXTENSIONS"
command -v gh >/dev/null || echo "note: gh is not installed; issues, PRs and review comments will not work"
echo "now: /reload in pi, then /dt-help for the flow, /dt-grill <task> to start, or /dt-resume to pick up a feature"
