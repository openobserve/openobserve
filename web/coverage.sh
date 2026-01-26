#!/usr/bin/env bash
set -eu -o pipefail

# Default coverage thresholds - you can override these with environment variables
export FRONTEND_COVERAGE_LINES=${FRONTEND_COVERAGE_LINES:-55}
export FRONTEND_COVERAGE_FUNCTIONS=${FRONTEND_COVERAGE_FUNCTIONS:-43.5}
export FRONTEND_COVERAGE_BRANCHES=${FRONTEND_COVERAGE_BRANCHES:-45}
export FRONTEND_COVERAGE_STATEMENTS=${FRONTEND_COVERAGE_STATEMENTS:-54}

usage() {
    cat <<EOF
Usage: $0 [-h | --help] [<command>]

Commands:
  check             Run frontend tests with coverage and verify thresholds
  html              Generate coverage report in HTML format
  show-env          Show the coverage thresholds
  test              Run tests with coverage
  help              Show this help and exit

Omitted <command> defaults to 'check'.
EOF
}

cmd_test() {
    npm run test:unit:coverage
}

cmd_html() {
    npm run test:unit:coverage
    echo "Coverage report generated in coverage/ directory"
    if command -v open >/dev/null 2>&1; then
        open coverage/index.html
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open coverage/index.html
    else
        echo "Open coverage/index.html in your browser to view the report"
    fi
}

cmd_show_env() {
    cat <<EOF
FRONTEND_COVERAGE_LINES=$FRONTEND_COVERAGE_LINES
FRONTEND_COVERAGE_FUNCTIONS=$FRONTEND_COVERAGE_FUNCTIONS
FRONTEND_COVERAGE_BRANCHES=$FRONTEND_COVERAGE_BRANCHES
FRONTEND_COVERAGE_STATEMENTS=$FRONTEND_COVERAGE_STATEMENTS
EOF
}

cmd_check() {
    echo "Running frontend tests with coverage..."
    npm run test:unit:coverage
    
    if [ -f "coverage/coverage-summary.json" ]; then
        echo "Checking coverage thresholds..."
        python3 <(
            cat <<'EOF'
import json
import os
import sys

thresholds = {
    'lines': float(os.environ['FRONTEND_COVERAGE_LINES']),
    'functions': float(os.environ['FRONTEND_COVERAGE_FUNCTIONS']),
    'branches': float(os.environ['FRONTEND_COVERAGE_BRANCHES']),
    'statements': float(os.environ['FRONTEND_COVERAGE_STATEMENTS']),
}

try:
    with open('coverage/coverage-summary.json') as f:
        report = json.load(f)
    
    totals = report['total']
    
    exit_status = 0
    for metric, threshold in thresholds.items():
        actual = totals[metric]['pct']
        metric_name = metric.capitalize()
        if actual >= threshold:
            print(f'✅ {metric_name} coverage: {actual:.2f}%', file=sys.stderr)
        else:
            print(
                f'❌ {metric_name} coverage is below threshold: {actual:.2f}% < {threshold}%',
                file=sys.stderr,
            )
            exit_status = 1
    
    if exit_status == 0:
        print('🎉 All coverage thresholds met!', file=sys.stderr)
    else:
        print('💥 Some coverage thresholds not met. Please add more tests.', file=sys.stderr)
    
    sys.exit(exit_status)
    
except FileNotFoundError:
    print('❌ Coverage summary file not found. Make sure tests ran successfully.', file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f'❌ Error checking coverage: {e}', file=sys.stderr)
    sys.exit(1)
EOF
        )
    else
        echo "❌ Coverage summary not found. Tests may have failed."
        exit 1
    fi
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
    test)
        shift
        cmd_test "$@"
        ;;
    html)
        shift
        cmd_html "$@"
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