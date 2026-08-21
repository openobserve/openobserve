#!/usr/bin/env python3
"""PostToolUse hook: incremental Rust style checks on files Claude edits.

Enforces the "Rust code organization" and "Comments" rules from CLAUDE.md.
Only lines added relative to git HEAD are checked (except test-module
placement, which CI's clippy pass keeps off main anyway), so pre-existing
style debt in a touched file does not nag.

Exit 2 feeds stderr back to Claude, which must address it.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

MAX_PLAIN_COMMENT_RUN = 2
MAX_DOC_COMMENT_RUN = 5

ITEM_RE = re.compile(
    r'^(?:#\[|(?:pub(?:\([^)]*\))?\s+)?'
    r'(?:const|static|fn|struct|enum|trait|type|impl|mod|use|unsafe|async|extern|macro_rules!)\b)'
)
FN_RE = re.compile(
    r'^(pub(?:\([^)]*\))?\s+)?(?:default\s+)?(?:const\s+)?(?:async\s+)?'
    r'(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+\w+'
)
CONST_RE = re.compile(
    r'^(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(?!(?:unsafe\s+|async\s+)*fn\b)\w'
)
CFG_TEST_RE = re.compile(r'^#\[cfg\(test\)\]')
# Inline modules only ({ on the same line, guaranteed by rustfmt); a
# `#[cfg(test)] mod foo;` declaration keeps its items in a separate file.
MOD_RE = re.compile(r'^(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{')


def added_lines(path):
    """1-based line numbers added vs HEAD, or None meaning 'treat all as added'."""
    try:
        d, name = str(path.parent), path.name
        tracked = subprocess.run(
            ["git", "-C", d, "ls-files", "--error-unmatch", name],
            capture_output=True,
        ).returncode == 0
        if not tracked:
            return None
        diff = subprocess.run(
            ["git", "-C", d, "diff", "HEAD", "-U0", "--", name],
            capture_output=True, text=True,
        ).stdout
    except Exception:
        return None
    out = set()
    for m in re.finditer(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', diff, re.M):
        start, count = int(m.group(1)), int(m.group(2) or "1")
        out.update(range(start, start + count))
    return out


def check_test_module_last(lines, is_added):
    attrs = [i for i, l in enumerate(lines) if CFG_TEST_RE.match(l)]
    if not attrs:
        return []
    a = attrs[-1]
    mod_idx = next(
        (j for j in range(a + 1, min(a + 4, len(lines))) if MOD_RE.match(lines[j])),
        None,
    )
    if mod_idx is None:
        return []
    for k in range(mod_idx + 1, len(lines)):
        if ITEM_RE.match(lines[k]):
            if is_added(a + 1) or is_added(mod_idx + 1) or is_added(k + 1):
                return [(k + 1,
                         "item after the #[cfg(test)] mod tests block; "
                         "the tests module must be the LAST item in the file")]
            return []
    return []


def check_const_after_fn(lines, is_added):
    viols = []
    fns = [i for i, l in enumerate(lines) if FN_RE.match(l)]
    consts = [i for i, l in enumerate(lines) if CONST_RE.match(l)]
    for c in consts:
        fns_above = [f for f in fns if f < c]
        if fns_above and (is_added(c + 1) or any(is_added(f + 1) for f in fns_above)):
            viols.append((c + 1,
                          "const/static declared below a function; constants go above "
                          "functions (order: mod > use > const/static > types > impls > fns)"))
    return viols


def check_visibility_sandwich(lines, is_added):
    fns = []
    for i, l in enumerate(lines):
        m = FN_RE.match(l)
        if m:
            fns.append((i, bool(m.group(1))))
    viols = []
    for idx in range(1, len(fns) - 1):
        line, is_pub = fns[idx]
        prev_pub, next_pub = fns[idx - 1][1], fns[idx + 1][1]
        if is_added(line + 1) and prev_pub == next_pub and is_pub != prev_pub:
            kind = "pub" if is_pub else "private"
            other = "private" if is_pub else "pub"
            viols.append((line + 1,
                          f"{kind} fn inserted inside a run of {other} functions; "
                          "keep pub and private functions grouped"))
    return viols


def check_comment_runs(lines, is_added):
    viols = []
    run_start, run_kind = None, None
    for i, raw in enumerate(lines + [""]):
        s = raw.strip()
        if s.startswith("///") or s.startswith("//!"):
            kind = "doc"
        elif s.startswith("//"):
            kind = "plain"
        else:
            kind = None
        if kind != run_kind:
            if run_kind is not None:
                length = i - run_start
                limit = MAX_DOC_COMMENT_RUN if run_kind == "doc" else MAX_PLAIN_COMMENT_RUN
                text = "\n".join(lines[run_start:i])
                touched = any(is_added(n + 1) for n in range(run_start, i))
                if (length > limit and touched and run_start > 0
                        and "SAFETY" not in text):
                    msg = (
                        f"{length}-line doc comment; keep it to a summary sentence "
                        "plus real caveats"
                        if run_kind == "doc"
                        else f"{length}-line comment; compress to one line or delete "
                        "(comments are only for non-obvious constraints)"
                    )
                    viols.append((run_start + 1, msg))
            run_start, run_kind = i, kind
    return viols


def main():
    data = json.load(sys.stdin)
    tool_input = data.get("tool_input") or {}
    fp = tool_input.get("file_path") or tool_input.get("notebook_path")
    if not fp or not fp.endswith(".rs"):
        return 0
    path = Path(fp)
    if "generated" in path.parts or not path.is_file():
        return 0
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()

    added = added_lines(path)
    is_added = (lambda _n: True) if added is None else (lambda n: n in added)

    viols = (
        check_test_module_last(lines, is_added)
        + check_const_after_fn(lines, is_added)
        + check_visibility_sandwich(lines, is_added)
        + check_comment_runs(lines, is_added)
    )
    if not viols:
        return 0
    for line, msg in sorted(viols):
        print(f"{fp}:{line}: {msg}", file=sys.stderr)
    print("(rules: CLAUDE.md 'Rust code organization' / 'Comments'; "
          "if a flagged comment documents a genuinely non-obvious constraint, "
          "keep it and continue)", file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
