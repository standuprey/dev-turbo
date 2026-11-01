#!/usr/bin/env bash
# uninstall.sh           remove prompts, dt.mjs and overlays; keep config.json and features/
# uninstall.sh --purge   also remove config.json and features/ (asks first)
set -euo pipefail

if [ "$#" -gt 1 ]; then
  echo "usage: ./uninstall.sh [--purge]"; exit 2
fi
case "${1:-}" in
  ""|--purge) ;;
  -h|--help) echo "usage: ./uninstall.sh [--purge]"; exit 0 ;;
  *) echo "usage: ./uninstall.sh [--purge]"; exit 2 ;;
esac

PI="${PI_AGENT_DIR:-$HOME/.pi/agent}"
PROMPTS="$PI/prompts"
DT="$PI/dt"

rm -f "$PROMPTS"/dt-*.md "$DT"/dt.mjs
rm -rf "$DT"/overlays
echo "removed dt-* prompts, dt.mjs and overlays"
if [ "${1:-}" = "--purge" ]; then
  echo "this will delete $DT (including config.json and features/):"
  ls -d "$DT"/config.json "$DT"/features 2>/dev/null || true
  if read -r -p "continue? [y/N] " answer && [ "$answer" = "y" ]; then
    rm -rf "$DT"
    echo "removed $DT"
  else
    echo "kept $DT"
  fi
else
  echo "kept $DT/config.json and $DT/features (use: ./uninstall.sh --purge)"
fi
