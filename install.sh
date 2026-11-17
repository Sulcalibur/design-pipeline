#!/usr/bin/env bash
# Install the design-pipeline skill for agent sessions.
#
# It symlinks the repo's skill/ into the agents skills directory, so edits in the
# repo are live without a second copy. It never edits your shell profile; it
# prints the export line to add.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS="${AGENTS_SKILLS_DIR:-$HOME/.agents/skills}"
TARGET="$SKILLS/design-pipeline"

mkdir -p "$SKILLS"
if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  BACKUP="$TARGET.backup-$(date +%s)"
  mv "$TARGET" "$BACKUP"
  echo "moved existing skill to $BACKUP"
fi
ln -sfn "$ROOT/skill" "$TARGET"
chmod +x "$ROOT/bin/"* 2>/dev/null || true

echo "linked $TARGET -> $ROOT/skill"
echo
echo "Add this to your shell profile (zsh: ~/.zshrc), then open a new shell:"
echo "  export DESIGN_PIPELINE_HOME=\"$ROOT\""
echo
echo "For this shell only:"
echo "  export DESIGN_PIPELINE_HOME=\"$ROOT\""
echo
echo "Check the machine:"
echo "  \"$ROOT/bin/probe\" doctor"
