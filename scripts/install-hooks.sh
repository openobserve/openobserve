#!/usr/bin/env bash
# =============================================================================
# scripts/install-hooks.sh
# Installs git hooks from scripts/hooks/ into .git/hooks/
#
# Usage:
#   bash scripts/install-hooks.sh
#
# Run this once after cloning the repository so the pre-commit hook is active.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
GIT_HOOKS_DIR="$REPO_ROOT/.git/hooks"
HOOKS_SRC_DIR="$REPO_ROOT/scripts/hooks"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'

echo ""
echo -e "${BOLD}Installing git hooks…${NC}"
echo ""

installed=0
for hook_src in "$HOOKS_SRC_DIR"/*; do
  hook_name="$(basename "$hook_src")"
  hook_dst="$GIT_HOOKS_DIR/$hook_name"

  # Back up any existing non-symlink hook
  if [[ -f "$hook_dst" && ! -L "$hook_dst" ]]; then
    echo -e "  ${YELLOW}⚠${NC}  Backing up existing $hook_name → ${hook_name}.bak"
    mv "$hook_dst" "${hook_dst}.bak"
  fi

  # Remove existing symlink so we can re-create it
  [[ -L "$hook_dst" ]] && rm "$hook_dst"

  # Ensure the source hook is executable
  chmod +x "$hook_src"

  # Create relative symlink (works after `git worktree` moves)
  ln -sf "../../scripts/hooks/$hook_name" "$hook_dst"

  echo -e "  ${GREEN}✓${NC}  $hook_name"
  (( installed++ )) || true
done

echo ""
if [[ $installed -eq 0 ]]; then
  echo -e "${YELLOW}  No hooks found in scripts/hooks/ — nothing installed.${NC}"
else
  echo -e "${GREEN}  $installed hook(s) installed successfully.${NC}"
fi

echo ""
echo "  Tips:"
echo "    • Edit .test-ignore to exclude files from unit test enforcement"
echo "    • SKIP_TEST_CHECK=1 git commit … to bypass for a single commit"
echo "    • STALE_DAYS=60 git commit … to change the stale threshold (default: 30)"
echo ""
