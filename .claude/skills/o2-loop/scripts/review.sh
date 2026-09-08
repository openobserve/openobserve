#!/usr/bin/env bash
# Runs one reviewer round for the o2-loop skill and writes the result into the ledger.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="main"
ROUND=""
LEDGER=""
BACKEND="auto"
EFFORT=""
MODEL=""
TIMEOUT_SECS=1800
MAX_BUDGET_USD=""
CANDIDATES=1
DRY_RUN=0
UNSANDBOXED=0
ALSO_REPOS=()
PROGRESS_PREFIX=""
NO_SANDBOX=0

usage() {
  cat <<'USAGE'
Usage: review.sh --round N [--ledger DIR] [--base BRANCH] [--backend auto|codex|claude|both]
                       [--effort low|medium|high] [--model MODEL] [--timeout SECS]
                       [--max-budget-usd N] [--no-candidates] [--unsandboxed] [--dry-run]
                       [--also PATH ...]

Each round first records the working tree as a local WIP commit ("wip(o2-loop): round N"),
so the reviewer sees an immutable snapshot and the caller can prove nothing changed afterwards by
checking that HEAD still equals DIR/round-N/commit and `git status --porcelain` is empty.
Round 1 reviews the whole change set against BASE. Round N>1 verifies earlier findings against
Claude's responses and reviews the delta between round N-1's commit and round N's commit.

DIR defaults to ~/.claude/o2-loop/<repo name>/<branch with / replaced by ->. It must be outside
the checkout, otherwise it would be swept into the WIP commit.

--also PATH (repeatable) adds a paired repository checkout to the same round: it gets its own WIP
commit, disposable worktree, patch, and prompt section, so one reviewer sees every side of a
cross-repo change. Its artifacts live in DIR/round-N/also/<repo name>/ (commit, path, diff.patch,
delta.patch, and the coder's evidence.md and coder-response.json). BASE must exist in every repo.

Backends:
  codex   `codex exec` in its read-only sandbox. --effort sets model_reasoning_effort (default high).
  claude  a fresh `claude -p --restricted` process with Read/Grep/Glob and read-only git only.
          --model defaults to opus; pick a model different from the one that wrote the code.
          --max-budget-usd caps the whole round (default 15): unless --no-candidates, a separate
          `claude -p "/code-review high <range>"` pre-run supplies candidate findings using at most
          half of it, and the reviewer gets exactly what remains; the pre-run gets at most half of
          --timeout and the reviewer gets the remaining seconds.
          Neither process has MCP servers, Write/Edit, or web access; the pre-run keeps Skill and
          Agent so /code-review can run its verification pass.
Every reviewer process runs inside a disposable `git worktree` of the reviewed commit that is removed
afterwards. The claude processes are additionally wrapped in a macOS seatbelt (sandbox-exec) that denies
every file write except the worktree's git metadata, temp directories, and claude's own session state
under ~/.claude (settings, skills, agents and hooks stay read-only); the worktree is verified unchanged
after each process. Without sandbox-exec the claude backend refuses to run unless --unsandboxed is
passed, and then the reviewer gets no Bash, no ledger access and no pre-run: the harness's own
working-directory confinement of Read/Grep/Glob is the only wall, and the patches are inlined instead.
  auto    (default) codex when the CLI is found, otherwise claude with a loud warning: a Claude
          reviewer is a weaker second opinion than a different vendor's model.
  both    codex and claude review the same commit in parallel; their verdicts are merged into one
          (request_changes if either says so; findings re-numbered CX<round>-<n> and CL<round>-<n>,
          near-duplicates merged; a prior finding stays open if either reviewer says so). Each
          reviewer's own files live in DIR/round-N/codex/ and DIR/round-N/claude/. Later rounds hand
          every finding to both reviewers, so each verifies the other's.
A flag that does not apply to the selected backend is rejected.

Inputs the caller must prepare before running:
  DIR/spec.md                          the confirmed plan (optional, embedded in the prompt when present)
  DIR/round-N/evidence.md              build, clippy, and test results for this round
  DIR/round-N/also/<name>/evidence.md  the same for each --also repository (optional)
  DIR/round-(N-1)/verdict.json         previous reviewer result (round > 1, written by this script)
  DIR/round-(N-1)/coder-response.json  the coder's per-finding response (round > 1)

Outputs written into DIR/round-N/:
  commit         sha of the WIP commit the reviewer saw
  backend        which backend reviewed this round
  prompt.md      the exact prompt sent to the reviewer
  diff.patch     git diff merge-base(BASE, HEAD)..commit
  delta.patch    git diff <previous commit>..<commit> (round > 1)
  candidates.md  code-review pre-run output (claude backend only), candidates.cost its spend
  progress.log   one timestamped line per reviewer action, written live; tail -f it to watch
                 (with both, lines carry a "codex |" or "claude |" prefix and end with one final done: line)
  events.jsonl   raw reviewer event stream
  verdict.json   structured review result
  reviewer.err   reviewer stderr

--dry-run does everything except invoke the backend. It never touches an existing verdict.json.
Exit code: 0 verdict approve, 10 verdict request_changes, 1 on any error.
USAGE
}

log() { echo "$*" >&2; }

realpath_of() { python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"; }

repo_name_of() { basename "$(dirname "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)")"; }

# Appending the error line (never truncating) is what lets a watcher on progress.log end, even on a refused rerun.
die() {
  log "$*"
  if [ -d "${ROUND_DIR:-/nonexistent}" ]; then
    if [ -n "$PROGRESS_PREFIX" ]; then
      echo "$(date +%H:%M:%S) $PROGRESS_PREFIX | failed: $*" >> "$ROUND_DIR/progress.log"
    else
      echo "$(date +%H:%M:%S) error: $*" >> "$ROUND_DIR/progress.log"
    fi
  fi
  exit 1
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --ledger) LEDGER="$2"; shift 2 ;;
      --round) ROUND="$2"; shift 2 ;;
      --base) BASE="$2"; shift 2 ;;
      --backend) BACKEND="$2"; shift 2 ;;
      --effort) EFFORT="$2"; shift 2 ;;
      --model) MODEL="$2"; shift 2 ;;
      --timeout) TIMEOUT_SECS="$2"; shift 2 ;;
      --max-budget-usd) MAX_BUDGET_USD="$2"; shift 2 ;;
      --no-candidates) CANDIDATES=0; shift ;;
      --unsandboxed) UNSANDBOXED=1; shift ;;
      --also) ALSO_REPOS+=("$(realpath_of "$2")"); shift 2 ;;
      --dry-run) DRY_RUN=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "unknown argument: $1" ;;
    esac
  done
  [ -n "$ROUND" ] || { usage >&2; exit 1; }
  [[ "$ROUND" =~ ^[0-9]+$ ]] && [ "$ROUND" -ge 1 ] || die "--round must be a positive integer"
}

find_codex() {
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return
  fi
  local bundled="/Applications/ChatGPT.app/Contents/Resources/codex"
  [ -x "$bundled" ] && echo "$bundled"
}

select_backend() {
  CODEX="$(find_codex || true)"
  case "$BACKEND" in
    auto)
      if [ -n "$CODEX" ]; then
        BACKEND="codex"
      else
        BACKEND="claude"
        log "WARNING: codex CLI not found, falling back to the claude backend; this round is Claude reviewing Claude"
      fi ;;
    codex|both)
      [ -n "$CODEX" ] || die "codex CLI not found: install it (npm i -g @openai/codex) or install the ChatGPT desktop app" ;;
    claude) ;;
    *) die "unknown backend: $BACKEND" ;;
  esac
  if [ "$BACKEND" = "claude" ] || [ "$BACKEND" = "both" ]; then
    command -v claude >/dev/null 2>&1 || die "claude CLI not found on PATH"
    NO_SANDBOX=0
    if ! command -v sandbox-exec >/dev/null 2>&1; then
      [ "$UNSANDBOXED" -eq 1 ] || [ "$DRY_RUN" -eq 1 ] || die "sandbox-exec not found: the claude backend needs a filesystem sandbox; pass --unsandboxed to run without one"
      NO_SANDBOX=1
      log "WARNING: no sandbox-exec; the claude reviewer runs without Bash, without ledger access, and without the code-review pre-run"
    fi
    MAX_BUDGET_USD="${MAX_BUDGET_USD:-15}"
    MODEL="${MODEL:-opus}"
  fi
  if [ "$BACKEND" = "codex" ] || [ "$BACKEND" = "both" ]; then
    EFFORT="${EFFORT:-high}"
  fi
  [ "$BACKEND" != "claude" ] || [ -z "$EFFORT" ] || die "--effort applies to the codex backend only"
  [ "$BACKEND" != "codex" ] || [ -z "$MAX_BUDGET_USD" ] || die "--max-budget-usd applies to the claude backend only"
}

check_json() {
  python3 - "$1" "$2" <<'PY'
import json, sys
path, keys = sys.argv[1], sys.argv[2].split(",")
try:
    with open(path) as f:
        doc = json.load(f)
except (OSError, ValueError) as e:
    sys.exit(f"{path}: invalid JSON ({e})")
missing = [k for k in keys if k not in doc]
if not isinstance(doc, dict) or missing:
    sys.exit(f"{path}: missing keys {missing}")
PY
}

resolve_paths() {
  REPO="$(git rev-parse --show-toplevel)"
  cd "$REPO"
  git rev-parse --verify --quiet "$BASE" >/dev/null || die "base branch not found: $BASE"
  # --git-common-dir resolves to the main checkout even inside a worktree, so all worktrees share one repo name.
  REPO_NAME="$(repo_name_of "$REPO")"
  if [ -z "$LEDGER" ]; then
    local branch_slug
    branch_slug="$(git rev-parse --abbrev-ref HEAD | tr '/' '-')"
    LEDGER="$HOME/.claude/o2-loop/$REPO_NAME/$branch_slug"
  fi
  LEDGER="$(realpath_of "$LEDGER")"
  local also
  for also in ${ALSO_REPOS[@]+"${ALSO_REPOS[@]}"}; do
    git -C "$also" rev-parse --show-toplevel >/dev/null 2>&1 || die "--also $also is not a git checkout"
    git -C "$also" rev-parse --verify --quiet "$BASE" >/dev/null || die "base branch $BASE not found in $also"
    [ "$(repo_name_of "$also")" != "$REPO_NAME" ] || die "--also $also has the same repository name as the primary checkout"
    case "$LEDGER/" in
      "$(realpath_of "$(git -C "$also" rev-parse --show-toplevel)")"/*) die "ledger $LEDGER is inside the paired checkout $also; it would be swept into its WIP commit" ;;
    esac
  done
  case "$LEDGER/" in
    "$REPO"/*) die "ledger $LEDGER is inside the checkout; it would be swept into the WIP commit. Use a path outside the repo." ;;
  esac
  MERGE_BASE="$(git merge-base "$BASE" HEAD)"
  ROUND_DIR="$LEDGER/round-$ROUND"
  PREV_DIR="$LEDGER/round-$((ROUND - 1))"
  mkdir -p "$ROUND_DIR"
  [ ! -e "$ROUND_DIR/verdict.json" ] || die "round $ROUND already has a verdict in $ROUND_DIR/verdict.json; use the next round number, or delete the round directory to redo it"
  : > "$ROUND_DIR/progress.log"
  rm -f "$ROUND_DIR"/candidates.md "$ROUND_DIR"/candidates.cost "$ROUND_DIR"/candidates.err \
    "$ROUND_DIR"/*/candidates.md "$ROUND_DIR"/*/candidates.cost "$ROUND_DIR"/*/candidates.err
}

check_inputs() {
  [ -s "$ROUND_DIR/evidence.md" ] || die "missing $ROUND_DIR/evidence.md: write build, clippy, and test results there first"
  [ "$ROUND" -gt 1 ] || return 0
  local r f
  for r in $(seq 1 $((ROUND - 1))); do
    for f in verdict.json coder-response.json commit; do
      [ -r "$LEDGER/round-$r/$f" ] && [ -s "$LEDGER/round-$r/$f" ] || die "missing or empty $LEDGER/round-$r/$f, required for round $ROUND"
    done
    check_json "$LEDGER/round-$r/verdict.json" "verdict,findings,prior_findings"
    check_json "$LEDGER/round-$r/coder-response.json" "round,responses"
    local also
    for also in ${ALSO_REPOS[@]+"${ALSO_REPOS[@]}"}; do
      [ -s "$LEDGER/round-$r/also/$(repo_name_of "$also")/commit" ] || die "missing $LEDGER/round-$r/also/$(repo_name_of "$also")/commit, required for round $ROUND"
    done
  done
}

snapshot() {
  # The WIP commit freezes what the reviewer sees; the ledger lives outside the repo so it never lands in it.
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit --quiet --no-verify -m "wip(o2-loop): round $ROUND"
  fi
  COMMIT="$(git rev-parse HEAD)"
  echo "$COMMIT" > "$ROUND_DIR/commit"
  git diff "$MERGE_BASE" "$COMMIT" > "$ROUND_DIR/diff.patch"
  CHANGED_FILES="$(git diff --name-only "$MERGE_BASE" "$COMMIT")"
  PREV_COMMIT=""
  if [ "$ROUND" -gt 1 ]; then
    PREV_COMMIT="$(cat "$PREV_DIR/commit")"
    git cat-file -e "$PREV_COMMIT^{commit}" 2>/dev/null || die "previous round commit $PREV_COMMIT is not in this repo"
    git diff "$PREV_COMMIT" "$COMMIT" > "$ROUND_DIR/delta.patch"
    [ "$PREV_COMMIT" != "$COMMIT" ] || log "warning: round $ROUND reviews the same commit as round $((ROUND - 1)); only responses changed"
  fi
  local also any_paired_change=0
  for also in ${ALSO_REPOS[@]+"${ALSO_REPOS[@]}"}; do
    snapshot_also "$also"
    [ ! -s "$ROUND_DIR/also/$(repo_name_of "$also")/diff.patch" ] || any_paired_change=1
  done
  [ -n "$CHANGED_FILES" ] || [ "$any_paired_change" -eq 1 ] || die "no changes vs $BASE in any checkout; nothing to review"
}

# Same freeze for a paired repository; its artifacts go under round-N/also/<name>/.
snapshot_also() {
  local repo="$1" name dir mb commit prev
  name="$(repo_name_of "$repo")"
  dir="$ROUND_DIR/also/$name"
  mkdir -p "$dir"
  echo "$repo" > "$dir/path"
  if [ -n "$(git -C "$repo" status --porcelain)" ]; then
    git -C "$repo" add -A
    git -C "$repo" commit --quiet --no-verify -m "wip(o2-loop): round $ROUND"
  fi
  commit="$(git -C "$repo" rev-parse HEAD)"
  echo "$commit" > "$dir/commit"
  mb="$(git -C "$repo" merge-base "$BASE" HEAD)"
  echo "$mb" > "$dir/merge-base"
  git -C "$repo" diff "$mb" "$commit" > "$dir/diff.patch"
  if [ "$ROUND" -gt 1 ]; then
    prev="$(cat "$PREV_DIR/also/$name/commit")"
    git -C "$repo" diff "$prev" "$commit" > "$dir/delta.patch"
  fi
}

# The reviewer works in a throwaway checkout of the commit, so nothing it does can touch the real checkout.
make_review_worktree() {
  REVIEW_DIR="$(mktemp -d "${TMPDIR:-/tmp}/o2-loop-review.XXXXXX")"
  rmdir "$REVIEW_DIR"
  git worktree add --quiet --detach "$REVIEW_DIR" "$COMMIT"
  # Seatbelt matches canonical paths, so symlinked or doubled-slash paths would silently miss the rules.
  REVIEW_DIR="$(realpath_of "$REVIEW_DIR")"
  ALSO_REVIEW_DIRS=()
  trap remove_review_worktree EXIT
  local also name wt
  for also in ${ALSO_REPOS[@]+"${ALSO_REPOS[@]}"}; do
    name="$(repo_name_of "$also")"
    wt="$(mktemp -d "${TMPDIR:-/tmp}/o2-loop-review-$name.XXXXXX")"
    rmdir "$wt"
    git -C "$also" worktree add --quiet --detach "$wt" "$(cat "$ROUND_DIR/also/$name/commit")"
    ALSO_REVIEW_DIRS+=("$(realpath_of "$wt")")
  done
}

# The reviewed tree must still equal COMMIT after each reviewer process; drift means something wrote into it.
check_review_worktree() {
  local who="$1"
  if [ "$(git -C "$REVIEW_DIR" rev-parse HEAD)" != "$COMMIT" ] || [ -n "$(git -C "$REVIEW_DIR" status --porcelain --ignored)" ]; then
    die "the reviewed tree changed during the $who; verdict discarded"
  fi
}

# Deny all writes, then allow only git metadata, temp dirs and claude's own state (list mirrors CLI 2.1.x; revisit if a round fails only sandboxed).
sandbox_profile() {
  local review_gitdir home
  review_gitdir="$(realpath_of "$(git -C "$REVIEW_DIR" rev-parse --path-format=absolute --git-dir)")"
  home="$(realpath_of "$HOME")"
  printf '(version 1)(allow default)(deny file-write*)'
  printf '(allow file-write* (subpath "%s"))' "$review_gitdir" "$(realpath_of "${TMPDIR:-/tmp}")" /private/tmp /dev \
    "$home/.claude/projects" "$home/.claude/shell-snapshots" "$home/.claude/debug" "$home/.claude/todos" \
    "$home/.claude/statsig" "$home/.claude/cache" "$home/.claude/sessions" "$home/.claude/session-env" \
    "$home/.claude/plans" "$home/.claude/file-history" "$home/.claude/paste-cache" "$home/.claude/tasks" \
    "$home/.claude/backups" "$home/.claude/plugins/cache" "$home/.claude/ide" "$home/Library/Caches/claude-cli-nodejs"
  printf '(allow file-write* (literal "%s"))' "$home/.claude.json" "$home/.claude.json.backup" "$home/.claude.json.lock"
  # Denied last so they win even under the temp dirs; the worktree's gitdir sits under the main repo's .git, hence the final re-allow.
  printf '(deny file-write* (subpath "%s"))' "$REVIEW_DIR" "$LEDGER" "$(realpath_of "$REPO")" \
    "$(realpath_of "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")"
  local i
  for i in ${ALSO_REVIEW_DIRS[@]+"${!ALSO_REVIEW_DIRS[@]}"}; do
    printf '(deny file-write* (subpath "%s"))' "${ALSO_REVIEW_DIRS[$i]}" "${ALSO_REPOS[$i]}" \
      "$(realpath_of "$(dirname "$(git -C "${ALSO_REPOS[$i]}" rev-parse --path-format=absolute --git-common-dir)")")"
  done
  printf '(allow file-write* (subpath "%s"))' "$review_gitdir"
  for i in ${ALSO_REVIEW_DIRS[@]+"${!ALSO_REVIEW_DIRS[@]}"}; do
    printf '(allow file-write* (subpath "%s"))' "$(realpath_of "$(git -C "${ALSO_REVIEW_DIRS[$i]}" rev-parse --path-format=absolute --git-dir)")"
  done
}

# No die() here: this runs as a pipeline stage, where an exit would only end the subshell. select_backend gates it.
run_claude_sandboxed() {
  local secs="$1"
  shift
  if command -v sandbox-exec >/dev/null 2>&1; then
    run_with_timeout "$secs" sandbox-exec -p "$(sandbox_profile)" claude "$@"
  else
    run_with_timeout "$secs" claude "$@"
  fi
}

remove_review_worktree() {
  [ -n "${REVIEW_DIR:-}" ] || return 0
  git -C "$REPO" worktree remove --force "$REVIEW_DIR" 2>/dev/null || true
  git -C "$REPO" worktree prune 2>/dev/null || true
  local i
  for i in ${ALSO_REVIEW_DIRS[@]+"${!ALSO_REVIEW_DIRS[@]}"}; do
    git -C "${ALSO_REPOS[$i]}" worktree remove --force "${ALSO_REVIEW_DIRS[$i]}" 2>/dev/null || true
    git -C "${ALSO_REPOS[$i]}" worktree prune 2>/dev/null || true
  done
}

# Every reviewed tree must still equal its commit after each reviewer process.
check_review_worktrees() {
  local who="$1" i
  check_review_worktree "$who"
  for i in ${ALSO_REVIEW_DIRS[@]+"${!ALSO_REVIEW_DIRS[@]}"}; do
    if [ "$(git -C "${ALSO_REVIEW_DIRS[$i]}" rev-parse HEAD)" != "$(cat "$ROUND_DIR/also/$(repo_name_of "${ALSO_REPOS[$i]}")/commit")" ] \
      || [ -n "$(git -C "${ALSO_REVIEW_DIRS[$i]}" status --porcelain --ignored)" ]; then
      die "the reviewed tree of $(repo_name_of "${ALSO_REPOS[$i]}") changed during the $who; verdict discarded"
    fi
  done
}

run_with_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  else
    perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
  fi
}

# Containment is the seatbelt (nothing under --unsandboxed); the allow list only spares approval prompts, and python3/bash may reach the network (accepted).
claude_common_args() {
  printf '%s\n' --restricted --strict-mcp-config --mcp-config '{"mcpServers":{}}' --model "$MODEL" \
    --max-budget-usd "$1"
  # Without a seatbelt the harness's working-directory confinement is the only wall, so the ledger is not opened; paired worktrees are read-only anyway.
  [ "$NO_SANDBOX" -eq 1 ] || printf '%s\n' --add-dir "$ROUND_DIR"
  printf '%s\n' ${ALSO_REVIEW_DIRS[@]+"${ALSO_REVIEW_DIRS[@]/#/--add-dir=}"}
  printf '%s\n' \
    --disallowedTools "Write" "Edit" "NotebookEdit" "WebFetch" "WebSearch" \
    --allowedTools "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git status:*)" "Bash(git rev-parse:*)" "Bash(git merge-base:*)" \
      "Bash(git grep:*)" "Bash(git ls-files:*)" "Bash(git blame:*)" \
      "Bash(head:*)" "Bash(tail:*)" "Bash(cat:*)" "Bash(ls:*)" "Bash(wc:*)" "Bash(nl:*)" \
      "Bash(grep:*)" "Bash(sed:*)" "Bash(awk:*)" "Bash(find:*)" "Bash(diff:*)" "Bash(sort:*)" "Bash(uniq:*)" \
      "Bash(cut:*)" "Bash(tr:*)" "Bash(xargs:*)" "Bash(stat:*)" "Bash(file:*)" "Bash(echo:*)" "Bash(printf:*)" \
      "Bash(python3:*)" "Bash(bash:*)" "Bash(sh:*)" "Bash(cd:*)"
}

claude_reviewer_args() {
  claude_common_args "$1"
  if [ "$NO_SANDBOX" -eq 1 ]; then
    printf '%s\n' --tools "Read,Grep,Glob"
  else
    printf '%s\n' --tools "Read,Grep,Glob,Bash"
  fi
}

# Skill and Agent let /code-review run its verification pass; ReportFindings is how it submits typed findings.
claude_prerun_args() {
  claude_common_args "$1"
  printf '%s\n' --tools "Skill,Agent,Read,Grep,Glob,Bash,ReportFindings"
}

# Runs the code-review pre-run for the claude reviewer; sets REVIEWER_BUDGET and REVIEWER_TIMEOUT for what is left.
gather_candidates() {
  local out="$1"
  REVIEWER_BUDGET="$MAX_BUDGET_USD"
  REVIEWER_TIMEOUT="$TIMEOUT_SECS"
  [ "$CANDIDATES" -eq 1 ] || return 0
  [ "$DRY_RUN" -eq 0 ] || return 0
  if [ "$NO_SANDBOX" -eq 1 ]; then
    echo "(no sandbox; pre-run skipped)" > "$out/candidates.md"
    return 0
  fi
  local range="$MERGE_BASE..$COMMIT" from="$MERGE_BASE"
  if [ "$ROUND" -gt 1 ]; then
    range="$PREV_COMMIT..$COMMIT"
    from="$PREV_COMMIT"
  fi
  if [ -z "$(git diff --name-only "$from" "$COMMIT")" ]; then
    log "candidates: the primary checkout has no diff in $range; skipping the code-review pre-run"
    echo "(no changes in the primary checkout for $range; pre-run skipped)" > "$out/candidates.md"
    return 0
  fi
  # The pre-run gets half the budget and half the timeout; the reviewer gets what the budget leaves.
  local prerun_budget
  prerun_budget="$(python3 -c 'print(round(float(__import__("sys").argv[1]) / 2, 2))' "$MAX_BUDGET_USD")"
  local started=$SECONDS
  log "candidates: running /code-review high $range in $REVIEW_DIR (budget \$$prerun_budget, output $out/candidates.md)"
  local args=()
  while IFS= read -r a; do args+=("$a"); done < <(claude_prerun_args "$prerun_budget")
  set +e
  ( cd "$REVIEW_DIR" && printf '%s' "/code-review high $range" \
      | run_claude_sandboxed $((TIMEOUT_SECS / 2)) -p "${args[@]}" --output-format stream-json --verbose 2> "$out/candidates.err" \
      | python3 "$SKILL_DIR/scripts/candidates.py" "$out/candidates.md" "$out/candidates.cost"
  )
  local status=$?
  set -e
  check_review_worktrees "pre-run"
  REVIEWER_TIMEOUT=$((TIMEOUT_SECS - (SECONDS - started)))
  [ "$REVIEWER_TIMEOUT" -ge 60 ] || die "round timeout ${TIMEOUT_SECS}s exhausted by the pre-run; raise --timeout or use --no-candidates"
  local cost
  cost="$(cat "$out/candidates.cost" 2>/dev/null || true)"
  # A pre-run that died without a result event is charged its whole cap, so the round can never exceed the budget.
  cost="${cost:-$prerun_budget}"
  REVIEWER_BUDGET="$(python3 -c 'print(max(0.0, round(float(__import__("sys").argv[1]) - float(__import__("sys").argv[2]), 2)))' "$MAX_BUDGET_USD" "$cost")" \
    || die "could not compute the reviewer budget from pre-run cost '$cost'"
  if [ "$status" -ne 0 ] || [ ! -s "$out/candidates.md" ]; then
    log "warning: code-review pre-run failed (exit $status, cost \$$cost); the reviewer proceeds without candidates"
    echo "(code-review pre-run produced no output, exit $status)" > "$out/candidates.md"
  else
    log "candidates: done, cost \$$cost, reviewer budget \$$REVIEWER_BUDGET"
  fi
  python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) >= 1 else 1)' "$REVIEWER_BUDGET" \
    || die "round budget \$$MAX_BUDGET_USD exhausted by the pre-run (\$$cost); raise --max-budget-usd or use --no-candidates"
}

# Inlined patches are capped so a large round cannot push the prompt past the model's context.
inline_patch() {
  local title="$1" file="$2" limit=200000 size
  size=$(wc -c < "$file" | tr -d ' ')
  echo "### $title"
  echo '```diff'
  if [ "$size" -gt "$limit" ]; then
    head -c "$limit" "$file"
    echo
    echo "[truncated: $((size - limit)) of $size bytes omitted; run the loop on a host with sandbox-exec to review the rest]"
  else
    cat "$file"
  fi
  echo '```'
}

write_prompt() {
  local backend="$1" out="$2"
  PROMPT="$out/prompt.md"
  {
    if [ "$ROUND" -eq 1 ]; then cat "$SKILL_DIR/prompts/review.md"; else cat "$SKILL_DIR/prompts/verify.md"; fi
    echo
    if [ "$backend" = "claude" ] && [ "$NO_SANDBOX" -eq 1 ]; then
      cat "$SKILL_DIR/prompts/backend-claude-nosandbox.md"
    else
      cat "$SKILL_DIR/prompts/backend-$backend.md"
    fi
    echo
    echo "## Change set"
    echo "- Repository name: $REPO_NAME (use it as the \`repo\` of every finding in this checkout)"
    echo "- Your working directory is a disposable checkout of the commit under review; the real checkout is elsewhere and not yours to touch."
    echo "- Base branch: $BASE (merge-base $MERGE_BASE)"
    echo "- Commit under review: $COMMIT (this is HEAD; the working tree is clean and identical to it)"
    echo "- Full patch: \`$ROUND_DIR/diff.patch\` (absolute path, outside your checkout), or run \`git diff $MERGE_BASE $COMMIT\`"
    if [ -n "$CHANGED_FILES" ]; then
      echo "- Changed files:"
      echo "$CHANGED_FILES" | sed 's/^/  - /'
    else
      echo "- Changed files: none in this checkout; the change lives in the paired repository below"
    fi
    local i name dir
    for i in ${ALSO_REPOS[@]+"${!ALSO_REPOS[@]}"}; do
      name="$(repo_name_of "${ALSO_REPOS[$i]}")"
      dir="$ROUND_DIR/also/$name"
      echo
      echo "## Paired repository: $name"
      echo "- This change spans repositories; review them together and report contract mismatches between them."
      echo "- Repository name: $name (use it as the \`repo\` of findings in this checkout)"
      echo "- Disposable checkout (read-only): ${ALSO_REVIEW_DIRS[$i]}"
      echo "- Commit under review: $(cat "$dir/commit") (merge-base $(cat "$dir/merge-base"))"
      echo "- Full patch: \`$dir/diff.patch\`, or run \`git -C ${ALSO_REVIEW_DIRS[$i]} diff $(cat "$dir/merge-base") $(cat "$dir/commit")\`"
      echo "- Changed files:"
      git -C "${ALSO_REPOS[$i]}" diff --name-only "$(cat "$dir/merge-base")" "$(cat "$dir/commit")" | sed 's/^/  - /'
      if [ -s "$dir/evidence.md" ]; then
        echo
        echo "### Evidence from the $name coder (round $ROUND)"
        cat "$dir/evidence.md"
      fi
      if [ "$ROUND" -gt 1 ] && [ -s "$dir/delta.patch" ]; then
        echo "- Delta since the previous round: \`$dir/delta.patch\` ($(wc -l < "$dir/delta.patch" | tr -d ' ') lines)"
      fi
    done
    if [ -s "$LEDGER/spec.md" ]; then
      echo
      echo "## Spec the change must satisfy"
      echo "File: \`$LEDGER/spec.md\` (content inline below). A finding may be that the change does not do what the spec says, or does more."
      echo
      cat "$LEDGER/spec.md"
    fi
    echo
    echo "## Evidence from the coder (round $ROUND)"
    echo "File: \`$ROUND_DIR/evidence.md\` (content inline below)"
    echo
    cat "$ROUND_DIR/evidence.md"
    if [ "$ROUND" -gt 1 ]; then
      local r
      for r in $(seq 1 $((ROUND - 1))); do
        echo
        echo "## Round $r reviewer findings"
        echo '```json'
        cat "$LEDGER/round-$r/verdict.json"
        echo
        echo '```'
        echo
        echo "## Round $r coder response"
        echo '```json'
        cat "$LEDGER/round-$r/coder-response.json"
        echo
        echo '```'
        for name in "$LEDGER/round-$r"/also/*/; do
          [ -s "$name/coder-response.json" ] || continue
          echo
          echo "## Round $r coder response ($(basename "$name"))"
          echo '```json'
          cat "$name/coder-response.json"
          echo
          echo '```'
        done
      done
      echo
      echo "## Delta since the previous round"
      echo "- Previous round commit: $PREV_COMMIT"
      echo "- Delta: \`$ROUND_DIR/delta.patch\` ($(wc -l < "$ROUND_DIR/delta.patch" | tr -d ' ') lines), or run \`git diff $PREV_COMMIT $COMMIT\`"
    fi
    if [ "$backend" = "claude" ] && [ "$NO_SANDBOX" -eq 1 ]; then
      echo
      echo "## Patches (inline, because ledger files are not readable in this mode)"
      inline_patch "Full patch of the primary checkout" "$ROUND_DIR/diff.patch"
      [ "$ROUND" -le 1 ] || inline_patch "Delta since the previous round" "$ROUND_DIR/delta.patch"
      for name in "$ROUND_DIR"/also/*/; do
        [ -s "$name/diff.patch" ] || continue
        inline_patch "Full patch of the paired repository $(basename "$name")" "$name/diff.patch"
        [ "$ROUND" -le 1 ] || [ ! -f "$name/delta.patch" ] || inline_patch "Delta of the paired repository $(basename "$name") since the previous round" "$name/delta.patch"
      done
    fi
    if [ "$backend" = "claude" ] && [ "$CANDIDATES" -eq 1 ] && [ "$DRY_RUN" -eq 0 ] && [ -s "$out/candidates.md" ]; then
      echo
      echo "## Candidate findings from a separate code-review pre-run"
      echo "Verify each against the code before adopting it; drop what you cannot confirm."
      echo
      cat "$out/candidates.md"
    fi
  } > "$PROMPT"
}

# One reviewer process end to end: pre-run (claude), prompt, run, verdict in $out. Prefix tags progress lines when two run at once.
run_backend() {
  local backend="$1" out="$2"
  PROGRESS_PREFIX="${3:-}"
  mkdir -p "$out"
  if [ "$backend" = "claude" ]; then
    gather_candidates "$out"
  else
    REVIEWER_BUDGET=""
    REVIEWER_TIMEOUT="$TIMEOUT_SECS"
  fi
  write_prompt "$backend" "$out"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "dry run: prompt written to $PROMPT, $backend not invoked"
    return 0
  fi
  local cmd=()
  if [ "$backend" = "codex" ]; then
    cmd=(run_with_timeout "$REVIEWER_TIMEOUT" "$CODEX" exec --sandbox read-only --ephemeral --json -C "$REVIEW_DIR"
         --output-schema "$SKILL_DIR/schema/review.json"
         -o "$out/verdict.json"
         -c "model_reasoning_effort=\"$EFFORT\"")
    [ -z "$MODEL" ] || [ "$BACKEND" = "both" ] || cmd+=(-m "$MODEL")
    cmd+=(-)
  else
    local args=()
    while IFS= read -r a; do args+=("$a"); done < <(claude_reviewer_args "$REVIEWER_BUDGET")
    # stream-json is the only output mode that both streams progress and honours --json-schema.
    cmd=(run_claude_sandboxed "$REVIEWER_TIMEOUT" -p "${args[@]}" --output-format stream-json --verbose
         --json-schema "$(cat "$SKILL_DIR/schema/review.json")")
  fi
  rm -f "$out/verdict.json" "$out/events.jsonl"
  # Both backends need the prompt on stdin; stderr gets its own file so it can never corrupt the parsed stream.
  set +e
  ( cd "$REVIEW_DIR" && "${cmd[@]}" < "$PROMPT" 2> "$out/reviewer.err" ) \
    | python3 -u "$SKILL_DIR/scripts/progress.py" "$backend" "$out/events.jsonl" "$ROUND_DIR/progress.log" "$out/verdict.json" "$PROGRESS_PREFIX" >&2
  local status=${PIPESTATUS[0]}
  set -e
  if [ "$status" -ne 0 ] || [ ! -s "$out/verdict.json" ]; then
    tail -20 "$out/reviewer.err" >&2
    die "$backend failed (exit $status); see $out/reviewer.err and progress.log"
  fi
}

# A verdict only counts for the commits the reviewers were given; drift in any tree discards it.
check_drift() {
  local why="" i
  # Tracked drift only for real checkouts: they legitimately hold ignored files, and the seatbelt denies writes to them.
  if [ "$(git rev-parse HEAD)" != "$COMMIT" ] || [ -n "$(git status --porcelain)" ]; then
    why="checkout changed while reviewing (HEAD or working tree differs from $COMMIT)"
  fi
  for i in ${ALSO_REPOS[@]+"${!ALSO_REPOS[@]}"}; do
    if [ "$(git -C "${ALSO_REPOS[$i]}" rev-parse HEAD)" != "$(cat "$ROUND_DIR/also/$(repo_name_of "${ALSO_REPOS[$i]}")/commit")" ] \
      || [ -n "$(git -C "${ALSO_REPOS[$i]}" status --porcelain)" ]; then
      why="paired checkout ${ALSO_REPOS[$i]} changed while reviewing"
    fi
  done
  if [ "$(git -C "$REVIEW_DIR" rev-parse HEAD)" != "$COMMIT" ] || [ -n "$(git -C "$REVIEW_DIR" status --porcelain --ignored)" ]; then
    why="the reviewed tree changed during the review"
  fi
  for i in ${ALSO_REVIEW_DIRS[@]+"${!ALSO_REVIEW_DIRS[@]}"}; do
    if [ "$(git -C "${ALSO_REVIEW_DIRS[$i]}" rev-parse HEAD)" != "$(cat "$ROUND_DIR/also/$(repo_name_of "${ALSO_REPOS[$i]}")/commit")" ] \
      || [ -n "$(git -C "${ALSO_REVIEW_DIRS[$i]}" status --porcelain --ignored)" ]; then
      why="the reviewed tree of $(repo_name_of "${ALSO_REPOS[$i]}") changed during the review"
    fi
  done
  [ -z "$why" ] && return 0
  local f
  for f in "$ROUND_DIR/verdict.json" "$ROUND_DIR/codex/verdict.json" "$ROUND_DIR/claude/verdict.json"; do
    [ -f "$f" ] && mv "$f" "$f.discarded"
  done
  die "$why; verdict discarded"
}

run_reviewers() {
  echo "$BACKEND" > "$ROUND_DIR/backend"
  log "backend: $BACKEND${CODEX:+ (codex at $CODEX)}"
  case "$BACKEND" in
    codex) log "round $ROUND, effort $EFFORT, base $BASE, commit $COMMIT" ;;
    claude) log "round $ROUND, model $MODEL, budget \$$MAX_BUDGET_USD, base $BASE, commit $COMMIT" ;;
    both) log "round $ROUND, codex effort $EFFORT + claude model $MODEL budget \$$MAX_BUDGET_USD, base $BASE, commit $COMMIT" ;;
  esac
  local paired=""
  [ -z "${ALSO_REVIEW_DIRS[*]+x}" ] || paired="; paired: ${ALSO_REVIEW_DIRS[*]}"
  log "review checkout $REVIEW_DIR (removed on exit)$paired"
  log "ledger $ROUND_DIR (tail -f progress.log to watch)"
  if [ "$BACKEND" != "both" ]; then
    run_backend "$BACKEND" "$ROUND_DIR" ""
    [ "$DRY_RUN" -eq 0 ] || exit 0
    check_drift
    return 0
  fi
  # Both reviewers see the same frozen trees; they run in parallel and only their merged verdict counts.
  local pid_codex pid_claude s_codex s_claude
  run_backend codex "$ROUND_DIR/codex" codex &
  pid_codex=$!
  run_backend claude "$ROUND_DIR/claude" claude &
  pid_claude=$!
  set +e
  wait "$pid_codex"; s_codex=$?
  wait "$pid_claude"; s_claude=$?
  set -e
  [ "$DRY_RUN" -eq 0 ] || exit 0
  [ "$s_codex" -eq 0 ] && [ "$s_claude" -eq 0 ] || die "both mode needs both reviewers to finish (codex exit $s_codex, claude exit $s_claude); see $ROUND_DIR/*/reviewer.err"
  check_drift
  # Merge into a scratch file first so a failed merge never leaves an empty verdict.json behind.
  python3 "$SKILL_DIR/scripts/merge-verdicts.py" "$ROUND" "$ROUND_DIR/codex/verdict.json" "$ROUND_DIR/claude/verdict.json" "$LEDGER" > "$ROUND_DIR/verdict.merging" \
    || { rm -f "$ROUND_DIR/verdict.merging"; die "could not merge the two verdicts; the per-backend verdicts are in $ROUND_DIR/codex and $ROUND_DIR/claude"; }
  mv "$ROUND_DIR/verdict.merging" "$ROUND_DIR/verdict.json"
  echo "$(date +%H:%M:%S) done: both reviewers finished, verdicts merged" >> "$ROUND_DIR/progress.log"
}

summarize() {
  python3 - "$ROUND_DIR/verdict.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    r = json.load(f)
sev = {}
for x in r["findings"]:
    sev[x["severity"]] = sev.get(x["severity"], 0) + 1
prior = {}
for x in r["prior_findings"]:
    prior[x["status"]] = prior.get(x["status"], 0) + 1
print(f"verdict: {r['verdict']}")
print(f"summary: {r['summary']}")
print(f"new findings: {len(r['findings'])} {sev}")
if prior:
    print(f"prior findings: {prior}")
for x in r["findings"]:
    src = f" ({'+'.join(x['sources'])})" if x.get("sources") else ""
    print(f"  [{x['severity']}] {x['id']}{src} {x.get('repo', '')}:{x['file']}:{x['line']} {x['title']}")
for x in r["prior_findings"]:
    print(f"  prior {x['id']} -> {x['status']}: {x['note'][:120]}")
no_line = [x["id"] for x in r["findings"] if x["line"] is None and x["severity"] != "low"]
if no_line:
    print(f"warning: findings without a line number above low severity: {no_line}")
sys.exit(0 if r["verdict"] == "approve" else 10)
PY
}

main() {
  parse_args "$@"
  resolve_paths
  select_backend
  check_inputs
  snapshot
  make_review_worktree
  run_reviewers
  summarize
}

# exit on the same line: bash would otherwise read the next command from the file after main returns.
main "$@"; exit
