#!/usr/bin/env python3
"""
Assertion-integrity analyzer for the E2E Council pipeline (deterministic — no LLM).

Two modes:
  fingerprint <spec.js>                         -> print a JSON fingerprint of the spec's assertions
  check <spec.js> [--baseline <fingerprint.json>] [--allow-weakening]
                                                -> static anti-pattern scan + (optional) diff-aware
                                                   heal-weakening check; writes nothing, prints a JSON
                                                   verdict, exits 2 if any CRITICAL finding.

Conservative by design: only HIGH-CONFIDENCE patterns are flagged as critical, because a gate with
false positives gets disabled by humans (the same trap that made mutation-testing a poor fit).
"""
import sys, re, json

NEG_MATCHERS = re.compile(r'\.not\.|\.toBeHidden\(|\.toBeFalsy\(')
TAUTOLOGIES = [
    (re.compile(r'toBeGreaterThanOrEqual\(\s*0\s*\)'), 'count >= 0 is always true'),
    (re.compile(r'toBeGreaterThan\(\s*-1\s*\)'), 'count > -1 is always true'),
    (re.compile(r'toBeLessThan\(\s*Infinity\s*\)'), '< Infinity is always true'),
    (re.compile(r'expect\(\s*true\s*\)\.toBe(Truthy)?\('), 'expect(true) asserts nothing'),
    (re.compile(r'expect\(\s*1\s*\)\.toBe\(\s*1\s*\)'), 'expect(1).toBe(1) asserts nothing'),
    (re.compile(r'expect\(\s*false\s*\)\.toBe(Falsy)?\('), 'expect(false) asserts nothing'),
]
EXPECT = re.compile(r'\bexpect\(')
TEST_START = re.compile(r'\b(test|it)(\.skip|\.fixme|\.only)?\s*\(')
SKIP_FIXME = re.compile(r'\b(test|it)\.(skip|fixme)\s*\(|\btest\.skip\(\s*\)|\.fixme\(')


def strip_noise(line):
    """Blank out comments + string literals so matchers don't fire inside them (best-effort,
    line-local). Handles `//` line comments and single-line `/* */` blocks; multi-line `/* */`
    blocks are rare in generated specs and not tracked across lines."""
    line = re.sub(r'/\*.*?\*/', '', line)   # single-line block comment
    line = re.sub(r'//.*$', '', line)        # line comment
    line = re.sub(r'`[^`]*`', '``', line)
    line = re.sub(r"'[^']*'", "''", line)
    line = re.sub(r'"[^"]*"', '""', line)
    return line


def fingerprint(src):
    """Return counts that summarize a spec's assertion shape: total expect()s, negative matchers,
    skip/fixme, and test blocks. Compared before vs. after heal to detect weakening."""
    code = '\n'.join(strip_noise(l) for l in src.split('\n'))
    return {
        'expects': len(EXPECT.findall(code)),
        'negatives': len(NEG_MATCHERS.findall(code)),
        'skips': len(re.findall(r'\.(skip|fixme)\s*\(', code)),
        'tests': len(TEST_START.findall(code)),
    }


def find_test_blocks(lines):
    """Yield (name_line_idx, start_idx, end_idx) for each test()/it() block by matching the block's
    braces. Ends exactly when the brace depth returns to 0 (== 0, not <= 0, so a stray nested
    structure can't terminate the block early)."""
    blocks = []
    i, n = 0, len(lines)
    while i < n:
        if TEST_START.search(strip_noise(lines[i])):
            depth, j, started = 0, i, False
            while j < n:
                for ch in strip_noise(lines[j]):
                    if ch == '{':
                        depth += 1; started = True
                    elif ch == '}':
                        depth -= 1
                if started and depth == 0:
                    break
                j += 1
            blocks.append((i, i, j))
            i = j + 1
        else:
            i += 1
    return blocks


# `if (...)` / `else` that directly precedes a statement on the SAME line with NO opening brace —
# i.e. a braceless single-statement conditional like `if (x) await expect(y).toBeVisible();`.
BRACELESS_GUARD = re.compile(r'(?:\bif\s*\([^{}]*\)|\belse)\s*(?:await\s+)?$')


def conditional_only_tests(lines):
    """A test where EVERY expect() sits inside an if/else block (so the test can end asserting nothing).
    Scans `{`, `}` and `expect(` events in POSITIONAL order so a single-line `if(){expect}else{}` is
    judged with the correct brace stack (not after all braces on the line are processed)."""
    flagged = []
    for name_i, s, e in find_test_blocks(lines):
        total, conditional = 0, 0
        stack = []  # frame value = True if introduced by if/else
        for raw in lines[s:e + 1]:
            line = strip_noise(raw)
            events = sorted(
                [(m.start(), m.group()) for m in re.finditer(r'[{}]', line)] +
                [(m.start(), 'E') for m in EXPECT.finditer(line)]
            )
            for pos, kind in events:
                if kind == '{':
                    stack.append(bool(re.search(r'\b(if|else)\b', line[:pos])))
                elif kind == '}':
                    if stack:
                        stack.pop()
                else:  # an expect(
                    total += 1
                    # conditional if inside a braced if/else frame OR guarded by a braceless
                    # single-statement `if (...)` / `else` immediately before it on this line
                    if any(stack) or BRACELESS_GUARD.search(line[:pos]):
                        conditional += 1
        if total > 0 and conditional == total:
            flagged.append((name_i + 1, total))
    return flagged


# Assertion-ish calls whose failure should surface — if these sit in a try{} whose catch swallows
# (no throw), the test passes even when the assertion fails.
ASSERT_TOKEN = re.compile(r'\bexpect\s*\(|\.waitFor\s*\(|\.toBe(Visible|Hidden|Truthy|Falsy)\b|\.toContainText\b|\.toHaveText\b')


def _match_brace(text, open_idx):
    """Index of the '}' matching the '{' at open_idx (-1 if unbalanced)."""
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return i
    return -1


def swallowed_assertion_tests(lines):
    """A test where an assertion sits inside a `try {}` whose matching `catch {}` does NOT re-throw —
    the catch swallows the failure (logs/returns), so the test passes even when the assertion fails.
    A `catch` that `throw`s, or a try/catch with no assertion inside the try (e.g. cleanup), is fine."""
    flagged = []
    for name_i, s, e in find_test_blocks(lines):
        block = '\n'.join(strip_noise(l) for l in lines[s:e + 1])
        for m in re.finditer(r'\bcatch\b\s*(\([^)]*\))?\s*\{', block):
            co = block.index('{', m.start())
            cc = _match_brace(block, co)
            if cc < 0:
                continue
            if re.search(r'\bthrow\b', block[co + 1:cc]):
                continue  # catch re-throws → the failure surfaces → fine
            pre = block[:m.start()]
            tclose = pre.rstrip().rfind('}')
            if tclose < 0:
                continue
            depth, topen = 0, -1
            for i in range(tclose, -1, -1):
                if pre[i] == '}':
                    depth += 1
                elif pre[i] == '{':
                    depth -= 1
                    if depth == 0:
                        topen = i
                        break
            if topen < 0 or not re.search(r'\btry\s*$', pre[:topen]):
                continue
            if ASSERT_TOKEN.search(pre[topen + 1:tclose]):
                flagged.append(name_i + 1)
                break
    return flagged


def check(spec_path, baseline=None, allow_weakening=False):
    """Run the static anti-pattern scan (tautologies, conditional-only assertions) and, when a
    baseline is given, the diff-aware heal-weakening guard. Returns a verdict dict; never raises on
    a malformed/partial baseline — missing baseline keys fall back to the current value (skip that
    comparison) rather than crashing the gate."""
    src = open(spec_path, encoding='utf-8').read()
    lines = src.split('\n')
    findings = []

    # --- static anti-patterns ---
    for idx, raw in enumerate(lines, 1):
        line = strip_noise(raw)
        for pat, why in TAUTOLOGIES:
            if pat.search(line):
                findings.append({'severity': 'critical', 'rule': 'tautology', 'line': idx, 'detail': why})

    for line_no, total in conditional_only_tests(lines):
        findings.append({'severity': 'critical', 'rule': 'conditional-only-assertions', 'line': line_no,
                         'detail': f'all {total} expect() in this test are inside if/else — the test can pass asserting nothing'})

    for line_no in swallowed_assertion_tests(lines):
        findings.append({'severity': 'critical', 'rule': 'swallowed-assertion', 'line': line_no,
                         'detail': 'an assertion sits in a try{} whose catch swallows the failure (no throw) — the test passes even when the assertion fails'})

    # No real coverage: a spec with tests where EVERY one is skip/fixme is a green run that ran
    # nothing (e.g. "fixme everything" to dodge a gap). A genuinely feature-incomplete spec should
    # be blocked anyway — so flag it here too. (Applies even with --allow-weakening: this is static.)
    fp0 = fingerprint(src)
    if fp0['tests'] > 0 and fp0['skips'] >= fp0['tests']:
        findings.append({'severity': 'critical', 'rule': 'no-runnable-tests',
                         'detail': f"every test is skip/fixme ({fp0['skips']} skip/fixme vs {fp0['tests']} tests) — the spec asserts nothing at runtime"})

    # --- diff-aware heal-weakening guard ---
    fp = fingerprint(src)
    if isinstance(baseline, dict) and not allow_weakening:
        base_expects = baseline.get('expects', fp['expects'])
        base_negatives = baseline.get('negatives', fp['negatives'])
        base_skips = baseline.get('skips', fp['skips'])
        if fp['expects'] < base_expects:
            findings.append({'severity': 'critical', 'rule': 'heal-removed-assertions',
                             'detail': f"expect() count dropped {base_expects} -> {fp['expects']} during heal"})
        if fp['negatives'] > base_negatives:
            findings.append({'severity': 'critical', 'rule': 'heal-inverted-assertions',
                             'detail': f"negative matchers rose {base_negatives} -> {fp['negatives']} during heal (positive flipped to negative?)"})
        if fp['skips'] > base_skips:
            findings.append({'severity': 'critical', 'rule': 'heal-skipped-tests',
                             'detail': f"skip/fixme rose {base_skips} -> {fp['skips']} during heal (use the feature-incomplete path, not silent skipping)"})

    critical = [f for f in findings if f['severity'] == 'critical']
    return {'verdict': 'FAIL' if critical else 'PASS', 'critical_count': len(critical),
            'fingerprint': fp, 'findings': findings}


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ('fingerprint', 'check'):
        sys.stderr.write(__doc__); sys.exit(64)
    mode, spec = sys.argv[1], sys.argv[2]
    if mode == 'fingerprint':
        print(json.dumps(fingerprint(open(spec, encoding='utf-8').read())))
        return
    baseline, allow = None, False
    args = sys.argv[3:]
    if '--baseline' in args:
        baseline = json.load(open(args[args.index('--baseline') + 1]))
    if '--allow-weakening' in args:
        allow = True
    result = check(spec, baseline, allow)
    print(json.dumps(result, indent=2))
    sys.exit(2 if result['verdict'] == 'FAIL' else 0)


if __name__ == '__main__':
    main()
