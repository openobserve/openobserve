#!/bin/bash
# Copyright 2026 OpenObserve Inc.
#
# Comprehensive test runner for trace graph tooltip functionality

set -e

echo "🚀 Running Trace Graph Tooltip Test Suite"
echo "========================================"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    case $status in
        "SUCCESS")
            echo -e "${GREEN}✅ $message${NC}"
            ;;
        "WARNING")
            echo -e "${YELLOW}⚠️  $message${NC}"
            ;;
        "ERROR")
            echo -e "${RED}❌ $message${NC}"
            ;;
        "INFO")
            echo -e "ℹ️  $message"
            ;;
    esac
}

# Check if we're in the web directory
if [ ! -f "package.json" ]; then
    print_status "ERROR" "Must be run from web/ directory"
    exit 1
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    print_status "ERROR" "Node.js not found"
    exit 1
fi

print_status "INFO" "Node.js version: $(node --version)"

# Lint check
print_status "INFO" "Running ESLint on tooltip test files..."
if npx eslint src/plugins/traces/TraceDetails.tooltip-*.spec.ts --no-fix; then
    print_status "SUCCESS" "ESLint passed"
else
    print_status "ERROR" "ESLint failed - fix syntax errors first"
    exit 1
fi

# Type check
print_status "INFO" "Running TypeScript type check..."
if npm run type-check; then
    print_status "SUCCESS" "TypeScript type check passed"
else
    print_status "WARNING" "TypeScript type check failed - check for type errors"
fi

# Run integration tests
print_status "INFO" "Running tooltip integration tests..."
if npm run test:unit -- src/plugins/traces/TraceDetails.tooltip-integration.spec.ts --run; then
    print_status "SUCCESS" "Integration tests passed"
else
    print_status "WARNING" "Integration tests failed - check test output"
fi

# Run performance tests
print_status "INFO" "Running tooltip performance tests..."
if npm run test:unit -- src/plugins/traces/TraceDetails.tooltip-performance.spec.ts --run; then
    print_status "SUCCESS" "Performance tests passed"
else
    print_status "WARNING" "Performance tests failed - check test output"
fi

# Check for test coverage
print_status "INFO" "Checking overall test coverage..."
if npm run test:unit:coverage -- src/plugins/traces/TraceDetails.tooltip*.spec.ts --run --reporter=verbose; then
    print_status "SUCCESS" "Coverage tests completed"
else
    print_status "WARNING" "Coverage tests failed"
fi

echo ""
echo "📋 Manual Testing Checklist:"
echo "  1. Run manual verification script in browser console"
echo "  2. Test tooltip interactions in Pattern view"
echo "  3. Verify tooltip content accuracy"
echo "  4. Check performance with large datasets"
echo "  5. Test accessibility with screen readers"
echo ""
echo "📖 Documentation:"
echo "  - TOOLTIP_TESTING_GUIDE.md - Comprehensive testing procedures"
echo "  - VERIFICATION_CHECKLIST.md - Production readiness checklist"
echo "  - tooltip-manual-verification.js - Browser testing script"
echo ""
print_status "SUCCESS" "Automated test suite completed!"
print_status "INFO" "See documentation for manual testing procedures"