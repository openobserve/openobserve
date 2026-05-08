#!/usr/bin/env bash
set -eu -o pipefail
# set -x
export PS4='+ [${BASH_SOURCE[0]##*/}:${LINENO}${FUNCNAME[0]:+:${FUNCNAME[0]}}] '

export COVERAGE_FUNCTIONS=${COVERAGE_FUNCTIONS:-65}
export COVERAGE_LINES=${COVERAGE_LINES:-65}
export COVERAGE_REGIONS=${COVERAGE_REGIONS:-65}

usage() {
    cat <<EOF
Usage: $0 [-h | --help] [<command>]

Commands:
  check [TESTNAME]  Run 'cargo llvm-cov test' and verify that code coverage statistics
                    are greater than or equal to the thresholds. Test name filtering
                    is supported.
  help              Show this help and exit.
  html              Generate coverage report in HTML format and open it in the default
                    browser.
  show-env          Show the coverage thresholds.

Omitted <command> defaults to 'check'.
EOF
}

_cov_test() {
    cargo llvm-cov --version >/dev/null || cargo install cargo-llvm-cov
    cargo nextest --version >/dev/null || cargo install cargo-nextest
    cargo run -- init-db
    cargo llvm-cov nextest \
        --workspace \
        --verbose \
        --no-cfg-coverage \
        --no-cfg-coverage-nightly \
        --ignore-filename-regex 'job|.*generated.*' \
        --test-threads=16 \
        --no-fail-fast \
        --retries 1 \
        "$@"
}

cmd_html() {
    _cov_test --html "$@"
    open target/llvm-cov/html/index.html # HACK: `open` is not portable
}

cmd_show_env() {
    cat <<EOF
COVERAGE_FUNCTIONS=$COVERAGE_FUNCTIONS
COVERAGE_LINES=$COVERAGE_LINES
COVERAGE_REGIONS=$COVERAGE_REGIONS
EOF
}

cmd_check() {
    python3 <(
        cat <<'EOF'
import json
import os
import subprocess
import sys

thresholds = {
    'functions': float(os.environ['COVERAGE_FUNCTIONS']),
    'lines': float(os.environ['COVERAGE_LINES']),
    'regions': float(os.environ['COVERAGE_REGIONS']),
}

with open('report.json') as f:
    report = json.load(f)

totals = report['data'][0]['totals']

exit_status = 0
failing_metrics = []
for k, threshold in thresholds.items():
    actual = totals[k]['percent']
    label = k.capitalize()
    if actual >= threshold:
        print(f'✅ {label} coverage: {actual:.2f}%', file=sys.stderr)
    else:
        print(
            f'❌ {label} coverage is below threshold: {actual:.2f}% < {threshold}%',
            file=sys.stderr,
        )
        failing_metrics.append(k)
        exit_status = 1

if failing_metrics:
    # Fetch per-file data from the existing profdata — no tests re-run
    result = subprocess.run(
        ['cargo', 'llvm-cov', 'report', '--json',
         '--ignore-filename-regex', 'job|.*generated.*'],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        full = json.loads(result.stdout)
        files = full['data'][0].get('files', [])
        metrics_label = ', '.join(failing_metrics)
        print(f'\n── Worst files by {metrics_label} coverage (top 20) ──', file=sys.stderr)
        scored = []
        for entry in files:
            fname = entry.get('filename', '')
            summary = entry.get('summary', {})
            for metric in failing_metrics:
                m = summary.get(metric, {})
                covered = m.get('covered', 0)
                total = m.get('count', 0)
                if total == 0:
                    continue
                pct = covered / total * 100
                missed = total - covered
                scored.append((pct, missed, total, metric, fname))
        # lowest coverage first, then most missed
        scored.sort(key=lambda x: (x[0], -x[1]))
        seen = set()
        count = 0
        for pct, missed, total, metric, fname in scored:
            key = (metric, fname)
            if key in seen:
                continue
            seen.add(key)
            short = fname.split('/src/', 1)[-1] if '/src/' in fname else fname
            print(f'  {metric:10s} {pct:5.1f}%  ({missed} uncovered / {total} total)  {short}', file=sys.stderr)
            count += 1
            if count >= 20:
                break
    else:
        print(f'(could not fetch per-file breakdown: {result.stderr.strip()})', file=sys.stderr)

sys.exit(exit_status)
EOF
    )
}

main() {
    case "${1:-}" in
    '')
        cmd_check
        ;;
    check)
        shift
        cmd_check "$@"
        ;;
    html)
        shift
        cmd_html "$@"
        ;;
    run-cov)
        shift
        _cov_test --json --summary-only --output-path report.json "$@"
        ;;
    show-env)
        cmd_show_env
        ;;
    -h | --help | help)
        usage
        ;;
    *)
        echo >&2 "Invalid argument: $1"
        echo >&2 "Type '$0 --help' for usage"
        exit 1
        ;;
    esac
}

main "$@"
