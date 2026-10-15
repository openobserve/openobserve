#!/usr/bin/env bash
# Usage: selftest.sh — runs every bounty-board self-test offline; exit 0 when all pass.
# shellcheck disable=SC2016 # single-quoted bash -c bodies and fixtures are literal on purpose
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1
SKILL="$(dirname "$HERE")"
FAILED=0
# lib.sh drops inherited GIT_DIR / GIT_WORK_TREE and provides the marker-checked temp dir helpers.
# shellcheck source=SCRIPTDIR/lib.sh
. "$HERE/lib.sh" || exit 1
T="$(bb_mktemp)" || { echo "FAIL could not create a temp dir"; exit 1; }
trap 'bb_rmtemp "$T"' EXIT
# An empty path in `git -C "$W"` would act on the current repo, so the tests run from a directory that is not one.
cd "$T" || exit 1

ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; FAILED=1; }
is() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
expect() { local want="$1" name="$2"; shift 2; "$@" >"$T/out" 2>&1; local got=$?; if [ "$got" -eq "$want" ]; then ok "$name"; else bad "$name (exit $got, want $want): $(head -3 "$T/out")"; fi; }

for f in "$HERE"/*.mjs; do expect 0 "node --check $(basename "$f")" node --check "$f"; done
expect 0 "parse-bug-items fixtures" node "$HERE/parse-bug-items.mjs" --self-test
expect 0 "triage-rules self-test" node "$HERE/triage-rules.mjs" --self-test
expect 0 "reviewers.json shape" jq -e '(.enabled | type == "boolean") and (.ui | length > 0) and (.backend | length > 0)' "$SKILL/reviewers.json"
for f in "$HERE"/*.sh; do expect 0 "bash -n $(basename "$f")" bash -n "$f"; done
if command -v shellcheck >/dev/null; then
  expect 0 "shellcheck" shellcheck -x "$HERE"/*.sh
else
  echo "skip shellcheck (not installed)"
fi

NC="$HERE/no-close-check.sh"
for s in "Fixes #12" "closes openobserve/acme-private#3" "**Resolves** #4" "fix:\n#5" "Closed: \`#6\`" "resolved [#7](x)" "fixes https://github.com/openobserve/openobserve/issues/8"; do
  expect 1 "no-close flags: $s" bash -c 'printf "%b" "$1" | "$2"' _ "$s" "$NC"
done
for s in "Refs openobserve/openobserve#12" "fix(logs): keep the cursor" "prefix #3 is fine" "fixed item 2 and item 3" "hotfixes #9"; do
  expect 0 "no-close passes: $s" bash -c 'printf "%b" "$1" | "$2"' _ "$s" "$NC"
done
printf 'Refs x#1\n' >"$T/clean.txt"; printf 'line\ncloses\n#2\n' >"$T/dirty.txt"
expect 1 "no-close file args, split keyword" "$NC" "$T/clean.txt" "$T/dirty.txt"

mkdir -p "$T/empty/openobserve"
export BB_OSS_DIR="$T/empty/openobserve"
unset BB_PRIVATE_DIR
expect 0 "private-config self-test" node "$HERE/private-config.mjs" --self-test
expect 2 "gate-issue rejects a bad repo" "$HERE/gate-issue.sh" evil 1 "$T"
expect 2 "no config: gate rejects the private repo" "$HERE/gate-issue.sh" acme-private 1 "$T"
is "no config: rejection says why" grep -q "no private-repo config found next to this checkout" "$T/out"
expect 2 "no config: prepare-worktree rejects the private repo" "$HERE/prepare-worktree.sh" openobserve 1 acme-private "$T"
expect 2 "gate-issue rejects a bad issue" "$HERE/gate-issue.sh" openobserve '1;id' "$T"

G=(git -c user.email=t@t -c user.name=t -c init.defaultBranch=main -c commit.gpgsign=false)
"${G[@]}" init -q --bare "$T/origin.git"
"${G[@]}" clone -q "$T/origin.git" "$T/ws/acme-private" 2>/dev/null
R="$T/ws/acme-private"
"${G[@]}" -C "$R" remote set-url origin https://github.com/openobserve/acme-private.git
"${G[@]}" -C "$R" config "url.$T/origin.git.insteadOf" https://github.com/openobserve/acme-private.git
mkdir -p "$R/.claude" && jq -n '{v:1, repo:"acme-private", dir_name:"acme-private", bug_labels:["bug"], issue_template:"t.yaml", edition:"Acme",
  file_here_when:["acme things"], route_prefixes:["acme_ext/"], protected_segments:["acme_secret"], needs_oss_sibling:true}' >"$R/.claude/bounty-board.private.json"
mkdir -p "$R/web/src/a" "$R/src" "$R/acme_ext/src" && echo e >"$R/acme_ext/src/e.rs" && echo a >"$R/web/src/a/A.vue" && echo b >"$R/src/b.rs" && echo c >"$R/Cargo.toml"
for i in 1 2 3; do echo x >"$R/src/x$i.rs"; done
"${G[@]}" -C "$R" add -A && "${G[@]}" -C "$R" commit -qm init && "${G[@]}" -C "$R" push -q origin main
printf 'web/src/a/A.vue\n' >"$T/allowed.txt"

expect 2 "prepare-worktree rejects an unknown repo" env BB_PRIVATE_DIR="$R" "$HERE/prepare-worktree.sh" openobserve 42 other-repo "$R"
expect 5 "prepare-worktree needs ../openobserve for a private target" env BB_PRIVATE_DIR="$R" "$HERE/prepare-worktree.sh" openobserve 42 acme-private "$R"
is "no worktree left behind on refusal" test ! -e "$T/ws/wt-autofix-openobserve-42"
mkdir -p "$T/ws/openobserve/src/config" && echo x >"$T/ws/openobserve/src/config/Cargo.toml" && "${G[@]}" init -q "$T/ws/openobserve"
export BB_OSS_DIR="$T/ws/openobserve"
expect 0 "prepare-worktree creates the worktree" "$HERE/prepare-worktree.sh" openobserve 42 acme-private "$R"
W="$(sed -n 's/^worktree=//p' "$T/out")"
if [ -z "$W" ] || [ ! -d "$W" ]; then bad "prepare-worktree printed no worktree; stopping before git runs anywhere else"; exit 1; fi
LEDGER="$(sed -n 's/^ledger=//p' "$T/out")"
is "worktree on the autofix branch" test "$("${G[@]}" -C "$W" rev-parse --abbrev-ref HEAD 2>/dev/null)" = "autofix/openobserve-issue-42"
PYLEDGER="$(cd "$W" && PYTHONDONTWRITEBYTECODE=1 python3 -B -c 'import importlib.util as u,sys; s=u.spec_from_file_location("ls", sys.argv[1]); m=u.module_from_spec(s); s.loader.exec_module(m); print(m.default_ledger())' "$SKILL/../o2-loop/scripts/loop-state.py" 2>&1)"
is "ledger matches o2-loop default_ledger ($LEDGER vs $PYLEDGER)" test "$LEDGER" = "$PYLEDGER"
expect 0 "prepare-worktree reuses the worktree" "$HERE/prepare-worktree.sh" openobserve 42 acme-private "$R"
is "reuse reported" grep -q '^reused=true' "$T/out"

S="$HERE/scope-check.sh"
expect 1 "scope-check: no change" "$S" "$W" "$T/allowed.txt" main
echo fix >>"$W/web/src/a/A.vue"; echo t >"$W/web/src/a/A.spec.ts"; "${G[@]}" -C "$W" add -A
expect 0 "scope-check: item path + spec" "$S" "$W" "$T/allowed.txt" main
"${G[@]}" -C "$W" commit -qm wip
expect 0 "scope-check: committed WIP counts" "$S" "$W" "$T/allowed.txt" main
echo y >>"$W/Cargo.toml"
expect 1 "scope-check: protected manifest" "$S" "$W" "$T/allowed.txt" main
"${G[@]}" -C "$W" checkout -q -- Cargo.toml
for i in 1 2 3; do echo y >>"$W/src/x$i.rs"; done
expect 1 "scope-check: three extra files" "$S" "$W" "$T/allowed.txt" main
"${G[@]}" -C "$W" checkout -q -- src
"${G[@]}" -C "$W" rm -q src/b.rs
expect 1 "scope-check: deletion" "$S" "$W" "$T/allowed.txt" main
"${G[@]}" -C "$W" reset -q --hard
echo n >"$W/web/src/a/new.ts"
expect 1 "scope-check: untracked file" "$S" "$W" "$T/allowed.txt" main
rm -f "$W/web/src/a/new.ts"

"${G[@]}" -C "$T/ws/openobserve" remote add origin https://github.com/openobserve/openobserve.git
"${G[@]}" -C "$R" remote set-url origin https://github.com/openobserve/acme-private.git
expect 0 "checkouts.sh by discovery" env -u BB_OSS_DIR "$HERE/checkouts.sh" "$T/ws/openobserve"
is "checkouts found OSS" grep -qx "openobserve=$T/ws/openobserve" "$T/out"
is "checkouts found the private checkout, not its autofix worktree" grep -qx "private=$R" "$T/out"
is "checkouts names the private repo" grep -qx "private_repo=acme-private" "$T/out"
mkdir -p "$T/ws/second/.claude" && cp "$R/.claude/bounty-board.private.json" "$T/ws/second/.claude/"
expect 1 "two private configs → error" "$HERE/checkouts.sh"
is "two configs: asks for BB_PRIVATE_DIR" grep -q "set BB_PRIVATE_DIR" "$T/out"
rm -rf "$T/ws/second"

F="$T/fake"; mkdir -p "$F" "$T/bin"
cat >"$T/bin/gh" <<'GH'
#!/usr/bin/env bash
F="$FAKE_GH"
echo "$*" >>"$F/calls.log"
case "$*" in
  "api user"*) echo dev1 ;;
  "api graphql"*) cat "$F/graph.json" ;;
  api\ --paginate\ *comments*) cat "$F/comments.jsonl" ;;
  "api repos/openobserve/"*/issues/*) cat "$F/issue.json" ;;
  "pr list"*) echo "" ;;
  "pr create"*) if [ -e "$F/fail-create" ]; then rm -f "$F/fail-create"; echo "fake gh: create failed" >&2; exit 1; fi; echo "https://github.com/openobserve/acme-private/pull/9" ;;
  "issue comment"*) ;;
  *) echo "fake gh: unexpected $*" >&2; exit 9 ;;
esac
GH
chmod +x "$T/bin/gh"
export FAKE_GH="$F"
printf '### Bug Description\n\n- [ ] **`P3` · Wrong label.** Shows the wrong label.\n\n  <details>\n  <summary>x</summary>\n\n  **Where:** `acme_ext/src/e.rs` — `label()`.\n\n  **Proposed fix:** use the right one.\n  </details>\n' >"$F/body.md"
issue_json() { jq -n --rawfile b "$F/body.md" --argjson labels "$1" --argjson assignees "$2" '{state:"open", user:{login:"author1"}, body:$b, labels:($labels|map({name:.})), assignees:($assignees|map({login:.}))}' >"$F/issue.json"; }
graph_json() { jq -n --arg ed "$1" '{data:{repository:{issue:{lastEditedAt:(if $ed == "" then null else "2026-01-01" end), editor:{login:$ed}, timelineItems:{nodes:[]}}}}}' >"$F/graph.json"; }
node "$HERE/parse-bug-items.mjs" "$F/body.md" >"$F/parsed.json"
node "$HERE/triage-rules.mjs" filter "$F/parsed.json" openobserve >"$F/filter.json"
echo '{"items":[{"index":1,"verdict":"accept","reason":"one-line local change"}]}' >"$F/verdict.json"
node "$HERE/triage-rules.mjs" render "$F/parsed.json" "$F/filter.json" "$F/verdict.json" openobserve 42 dev1 "$F/out" >/dev/null
jq -cn --rawfile b "$F/out/verdict-comment.md" '{user:"dev1", author_association:"MEMBER", created_at:"2026-01-01", body:$b}' >"$F/comments.jsonl"
mkdir -p "$T/g"
issue_json '["bug-me-not","autofix"]' '["author1"]'; graph_json ""
expect 0 "gate --hunt passes an autofix issue" env PATH="$T/bin:$PATH" "$HERE/gate-issue.sh" --hunt openobserve 42 "$T/g"
is "gate wrote comments.jsonl" test -s "$T/g/comments.jsonl"
issue_json '["bug-me-not","autofix","autofix-failed"]' '[]'
expect 10 "gate --hunt skips autofix-failed" env PATH="$T/bin:$PATH" "$HERE/gate-issue.sh" --hunt openobserve 42 "$T/g"
issue_json '["bug-me-not"]' '[]'
expect 10 "gate --hunt skips an issue without autofix" env PATH="$T/bin:$PATH" "$HERE/gate-issue.sh" --hunt openobserve 42 "$T/g"
expect 0 "gate (triage) does not need autofix" env PATH="$T/bin:$PATH" "$HERE/gate-issue.sh" openobserve 42 "$T/g"
issue_json '["bug-me-not","autofix"]' '["author1","dev1","someone"]'
expect 0 "gate ignores who is assigned" env PATH="$T/bin:$PATH" "$HERE/gate-issue.sh" --hunt openobserve 42 "$T/g"
issue_json '["bug-me-not","autofix","Needs-Testing"]' '[]'
expect 10 "gate skips Needs-Testing" env PATH="$T/bin:$PATH" "$HERE/gate-issue.sh" --hunt openobserve 42 "$T/g"
issue_json '["bug-me-not","Test-Assist-Testing-Completed"]' '[]'
expect 10 "gate skips Test-Assist-Testing-Completed" env PATH="$T/bin:$PATH" "$HERE/gate-issue.sh" openobserve 42 "$T/g"
issue_json '["bug-me-not","Test-Assist-Queued"]' '[]'
expect 10 "gate skips any Test-Assist-* label" env PATH="$T/bin:$PATH" "$HERE/gate-issue.sh" openobserve 42 "$T/g"
issue_json '["bug-me-not","QA Test Not Needed"]' '[]'
expect 0 "gate ignores QA Test Not Needed" env PATH="$T/bin:$PATH" "$HERE/gate-issue.sh" openobserve 42 "$T/g"
issue_json '["bug-me-not","autofix"]' '["author1","dev1"]'; graph_json "editor9"
expect 10 "gate skips a third-party body edit" env PATH="$T/bin:$PATH" "$HERE/gate-issue.sh" --hunt openobserve 42 "$T/g"
expect 0 "BB_ALLOW_EDITOR accepts that editor" env PATH="$T/bin:$PATH" BB_ALLOW_EDITOR=editor9 "$HERE/gate-issue.sh" --hunt openobserve 42 "$T/g"
graph_json ""

printf '[user]\n\tname = t\n\temail = t@t\n[commit]\n\tgpgsign = false\n[core]\n\thooksPath = /dev/null\n' >"$T/gitconfig"
GENV=(env PATH="$T/bin:$PATH" GIT_CONFIG_GLOBAL="$T/gitconfig" GIT_CONFIG_NOSYSTEM=1)
"${G[@]}" -C "$R" config "url.$T/origin.git.insteadOf" https://github.com/openobserve/acme-private.git
echo fix >>"$W/acme_ext/src/e.rs"; "${G[@]}" -C "$W" commit -qam "wip(o2-loop): round 1"
echo again >>"$W/acme_ext/src/e.rs"; "${G[@]}" -C "$W" commit -qam "wip(o2-loop): round 2"
printf 'fix(search): show the right label\n' >"$F/title.txt"
printf 'Shows the right label.\n\nRefs openobserve/openobserve#42\n\nOpened via bounty-board from openobserve/openobserve#42\n' >"$F/body-pr.md"
printf 'fix(search): show the right label\n\nRefs openobserve/openobserve#42\n' >"$F/msg.txt"
: >"$F/calls.log"
BEFORE="$("${G[@]}" -C "$W" rev-list --count origin/main..HEAD)"
expect 0 "open-pr --dry-run passes" "${GENV[@]}" "$HERE/open-pr.sh" --dry-run "$W" "$F/title.txt" "$F/body-pr.md" "$F/msg.txt"
is "dry-run omits draft and labels" bash -c '! grep -Eq -- "--draft|--label" "$1" && grep -q -- "--assignee @me" "$1"' _ "$T/out"
is "dry-run makes no write calls" bash -c '! grep -Eq "^(pr create|issue comment)" "$1"' _ "$F/calls.log"
is "dry-run keeps the WIP commits" test "$("${G[@]}" -C "$W" rev-list --count origin/main..HEAD)" = "$BEFORE"
printf 'Fixes openobserve/openobserve#42\n' >"$F/bad-body.md"
expect 1 "open-pr refuses a closing keyword" "${GENV[@]}" "$HERE/open-pr.sh" --dry-run "$W" "$F/title.txt" "$F/bad-body.md" "$F/msg.txt"
issue_json '["bug-me-not","autofix","autofix-failed"]' '["author1"]'
expect 10 "open-pr re-runs the gate" "${GENV[@]}" "$HERE/open-pr.sh" --dry-run "$W" "$F/title.txt" "$F/body-pr.md" "$F/msg.txt"
issue_json '["bug-me-not","autofix"]' '["author1","dev1"]'
echo out >>"$W/src/b.rs"; echo out >>"$W/src/x1.rs"; echo out >>"$W/src/x2.rs"; "${G[@]}" -C "$W" commit -qam "wip(o2-loop): round 3"
expect 1 "open-pr runs the scope check" "${GENV[@]}" "$HERE/open-pr.sh" --dry-run "$W" "$F/title.txt" "$F/body-pr.md" "$F/msg.txt"
"${G[@]}" -C "$W" reset -q --hard HEAD~1
touch "$F/fail-create"
expect 1 "open-pr fails when gh pr create fails" "${GENV[@]}" "$HERE/open-pr.sh" "$W" "$F/title.txt" "$F/body-pr.md" "$F/msg.txt"
is "failure names the saved WIP ref" grep -q "refs/bounty-board/openobserve-issue-42-wip" "$T/out"
is "WIP ref keeps the o2-loop commits" test "$("${G[@]}" -C "$W" rev-list --count origin/main..refs/bounty-board/openobserve-issue-42-wip)" = "$BEFORE"
SQUASH_SHA="$("${G[@]}" -C "$W" rev-parse HEAD)"
is "branch pushed before the failed create" test "$("${G[@]}" --git-dir="$T/origin.git" rev-parse refs/heads/autofix/openobserve-issue-42)" = "$SQUASH_SHA"
expect 0 "open-pr rerun after a failed create" "${GENV[@]}" "$HERE/open-pr.sh" "$W" "$F/title.txt" "$F/body-pr.md" "$F/msg.txt"
is "rerun does not re-squash" test "$("${G[@]}" -C "$W" rev-parse HEAD)" = "$SQUASH_SHA"
is "rerun skips the push" grep -q "branch already pushed" "$T/out"
is "pr_url printed" grep -q "^pr_url=https://github.com/openobserve/acme-private/pull/9" "$T/out"
is "squashed to one commit" test "$("${G[@]}" -C "$W" rev-list --count origin/main..HEAD)" = 1
printf 'fix(search): show the correct label\n\nRefs openobserve/openobserve#42\n' >"$F/msg.txt"
expect 0 "open-pr with a new message re-commits and force-pushes with lease" "${GENV[@]}" "$HERE/open-pr.sh" "$W" "$F/title.txt" "$F/body-pr.md" "$F/msg.txt"
is "remote tip follows the re-commit" test "$("${G[@]}" --git-dir="$T/origin.git" rev-parse refs/heads/autofix/openobserve-issue-42)" = "$("${G[@]}" -C "$W" rev-parse HEAD)"
is "re-commit is still one commit" test "$("${G[@]}" -C "$W" rev-list --count origin/main..HEAD)" = 1
"${G[@]}" clone -q "$T/origin.git" "$T/other" 2>/dev/null
"${G[@]}" -C "$T/other" checkout -q autofix/openobserve-issue-42
echo theirs >>"$T/other/acme_ext/src/e.rs"; "${G[@]}" -C "$T/other" commit -qam "their commit"; "${G[@]}" -C "$T/other" push -q origin HEAD
THEIRS="$("${G[@]}" -C "$T/other" rev-parse HEAD)"
printf 'fix(search): show the proper label\n\nRefs openobserve/openobserve#42\n' >"$F/msg.txt"
expect 1 "open-pr refuses to overwrite someone else's push" "${GENV[@]}" "$HERE/open-pr.sh" "$W" "$F/title.txt" "$F/body-pr.md" "$F/msg.txt"
is "refusal explains the foreign tip" grep -q "did not push" "$T/out"
is "foreign commit survives" test "$("${G[@]}" --git-dir="$T/origin.git" rev-parse refs/heads/autofix/openobserve-issue-42)" = "$THEIRS"
is "WIP ref still holds the original o2-loop chain" test "$("${G[@]}" -C "$W" rev-list --count origin/main..refs/bounty-board/openobserve-issue-42-wip)" = "$BEFORE"
is "pr create targets main without draft" bash -c 'grep "^pr create" "$1" | grep -q -- "--base main" && ! grep "^pr create" "$1" | grep -q -- "--draft"' _ "$F/calls.log"
is "issue got the PR link" grep -q "^issue comment -R openobserve/openobserve 42 --body 🪧 Autofix PR: https://github.com/openobserve/acme-private/pull/9" "$F/calls.log"

"${G[@]}" -C "$R" worktree remove --force "$W"

"${G[@]}" init -q "$T/victim" && echo v >"$T/victim/v.txt" && "${G[@]}" -C "$T/victim" add -A && "${G[@]}" -C "$T/victim" commit -qm victim
snap() { (cd "$1" && find . -type f -print0 | sort -z | xargs -0 shasum); }
snap "$T/victim" >"$T/victim.before"
VICTIM=(env GIT_DIR="$T/victim/.git" GIT_WORK_TREE="$T/victim")
expect 0 "prepare-worktree ignores an inherited GIT_DIR" "${VICTIM[@]}" "$HERE/prepare-worktree.sh" openobserve 43 acme-private "$R"
W2="$(sed -n 's/^worktree=//p' "$T/out")"
is "worktree landed in the target repo" test "$("${G[@]}" -C "$W2" rev-parse --abbrev-ref HEAD 2>/dev/null)" = "autofix/openobserve-issue-43"
echo fix >>"$W2/acme_ext/src/e.rs"; "${G[@]}" -C "$W2" commit -qam "wip(o2-loop): round 1"
node "$HERE/triage-rules.mjs" render "$F/parsed.json" "$F/filter.json" "$F/verdict.json" openobserve 43 dev1 "$F/out43" >/dev/null
jq -cn --rawfile b "$F/out43/verdict-comment.md" '{user:"dev1", author_association:"MEMBER", created_at:"2026-01-02", body:$b}' >>"$F/comments.jsonl"
printf 'fix(search): x\n\nRefs openobserve/openobserve#43\n' >"$F/msg43.txt"; printf 'fix(search): x\n' >"$F/title43.txt"
printf 'x\n\nRefs openobserve/openobserve#43\n' >"$F/body43.md"
expect 0 "open-pr ignores an inherited GIT_DIR" "${GENV[@]}" GIT_DIR="$T/victim/.git" GIT_WORK_TREE="$T/victim" "$HERE/open-pr.sh" "$W2" "$F/title43.txt" "$F/body43.md" "$F/msg43.txt"
is "open-pr squashed in the worktree, not the victim" test "$("${G[@]}" -C "$W2" log -1 --format=%s)" = "fix(search): x"
"${G[@]}" -C "$R" worktree remove --force "$W2"
if [ -z "${BB_SELFTEST_NESTED:-}" ]; then
  expect 0 "the whole self-test under an inherited GIT_DIR" "${VICTIM[@]}" BB_SELFTEST_NESTED=1 "$HERE/selftest.sh"
  mkdir -p "$T/shim" "$T/cwd-sentinel" && echo keep >"$T/cwd-sentinel/keep.txt"
  printf '#!/bin/sh\nexit 1\n' >"$T/shim/mktemp" && chmod +x "$T/shim/mktemp"
  expect 1 "self-test stops when mktemp fails" bash -c 'cd "$1" && PATH="$2:$PATH" BB_SELFTEST_NESTED=1 "$3"' _ "$T/cwd-sentinel" "$T/shim" "$HERE/selftest.sh"
  is "a failing mktemp leaves the cwd alone" test -f "$T/cwd-sentinel/keep.txt"
  expect 1 "bb_rmtemp refuses a dir without its marker" bash -c '. "$1"; bb_rmtemp "$2"; test ! -d "$2"' _ "$HERE/lib.sh" "$T/cwd-sentinel"
fi
snap "$T/victim" >"$T/victim.after"
is "victim repo byte-identical" cmp -s "$T/victim.before" "$T/victim.after"
[ "$FAILED" -eq 0 ] && echo "bounty-board self-test passed" || echo "bounty-board self-test FAILED"
exit "$FAILED"
