#!/bin/bash
# Validation script for issue-audit workflow fixes
# Run this before deploying to verify all fixes are in place

set -e

WORKFLOW_FILE=".github/workflows/issue-audit.yml"
ERRORS=0

echo "🔍 Validating issue-audit workflow fixes..."
echo ""

# Check 1: No duplicate fs require
echo "✓ Checking for duplicate fs require..."
FS_COUNT=$(grep -c "const fs = require('fs')" "$WORKFLOW_FILE" || true)
if [ "$FS_COUNT" -ne 6 ]; then
    echo "  ❌ Found $FS_COUNT fs require statements (expected: 6)"
    echo "     Each github-script step should have exactly one fs require"
    echo "     Steps: audit, auto-close, ready-to-close, analyze-files, process-needs-test, generate-report"
    ERRORS=$((ERRORS + 1))
else
    echo "  ✅ Found $FS_COUNT fs require statements (correct)"
fi

# Check 2: No execSync usage
echo "✓ Checking for execSync removal..."
if grep -q "execSync" "$WORKFLOW_FILE"; then
    echo "  ❌ execSync still present (should use spawnSync)"
    ERRORS=$((ERRORS + 1))
else
    echo "  ✅ execSync removed"
fi

# Check 3: spawnSync with args array
echo "✓ Checking for spawnSync with args array..."
if grep -q "spawnSync('grep', \[" "$WORKFLOW_FILE"; then
    echo "  ✅ spawnSync uses args array (shell-safe)"
else
    echo "  ❌ spawnSync not found or not using args array"
    ERRORS=$((ERRORS + 1))
fi

# Check 4: File-based passing for audit-results.json
echo "✓ Checking for file-based audit results..."
if grep -q "audit-results.json" "$WORKFLOW_FILE"; then
    echo "  ✅ audit-results.json file-based passing detected"
else
    echo "  ❌ audit-results.json not found"
    ERRORS=$((ERRORS + 1))
fi

# Check 5: File-based passing for enriched-needs-test.json
echo "✓ Checking for file-based enriched results..."
if grep -q "enriched-needs-test.json" "$WORKFLOW_FILE"; then
    echo "  ✅ enriched-needs-test.json file-based passing detected"
else
    echo "  ❌ enriched-needs-test.json not found"
    ERRORS=$((ERRORS + 1))
fi

# Check 6: No RESULTS_JSON env var in steps that read results
echo "✓ Checking for removed RESULTS_JSON env var..."
RESULTS_JSON_COUNT=$(grep -c "RESULTS_JSON: \${{ steps.audit.outputs.results }}" "$WORKFLOW_FILE" || true)
if [ "$RESULTS_JSON_COUNT" -gt 0 ]; then
    echo "  ❌ Found $RESULTS_JSON_COUNT RESULTS_JSON env var references (should be 0)"
    ERRORS=$((ERRORS + 1))
else
    echo "  ✅ RESULTS_JSON env var removed from consuming steps"
fi

# Check 7: Rate limit estimate is 20, not 5
echo "✓ Checking rate limit estimate..."
if grep -q "issues.length \* 20" "$WORKFLOW_FILE"; then
    echo "  ✅ Rate limit estimate is 20 calls per issue"
else
    echo "  ❌ Rate limit estimate not set to 20"
    ERRORS=$((ERRORS + 1))
fi

# Check 8: Dedup guard in ready-to-close step
echo "✓ Checking for dedup guard..."
if grep -q "alreadyCommented = comments.some" "$WORKFLOW_FILE"; then
    echo "  ✅ Dedup guard detected"
else
    echo "  ❌ Dedup guard not found"
    ERRORS=$((ERRORS + 1))
fi

# Check 9: paginate.iterator for early break
echo "✓ Checking for paginate.iterator..."
if grep -q "github.paginate.iterator" "$WORKFLOW_FILE"; then
    echo "  ✅ paginate.iterator detected for early break"
else
    echo "  ❌ paginate.iterator not found"
    ERRORS=$((ERRORS + 1))
fi

# Check 10: Rate limit check in analyze-files loop
echo "✓ Checking for rate limit check in analyze-files..."
if grep -q "processedCount % 10 === 0" "$WORKFLOW_FILE"; then
    echo "  ✅ Periodic rate limit checks detected"
else
    echo "  ❌ No periodic rate limit checks in analyze-files"
    ERRORS=$((ERRORS + 1))
fi

# Check 11: Age filter (2 months)
echo "✓ Checking for 2-month age filter..."
if grep -q "setDate.*- 60" "$WORKFLOW_FILE" && grep -q "issues older than 2 months" "$WORKFLOW_FILE"; then
    echo "  ✅ Age filter detected (60 days / 2 months)"
else
    echo "  ❌ Age filter not found or incorrect"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$ERRORS" -eq 0 ]; then
    echo "✅ All validations passed!"
    echo ""
    echo "Next steps:"
    echo "  1. Test with dry run: gh workflow run issue-audit.yml -f dry_run=true -f test_mode=all"
    echo "  2. Test with single issue: gh workflow run issue-audit.yml -f test_mode=<issue#>"
    echo "  3. Monitor workflow logs for file creation and rate limit checks"
    exit 0
else
    echo "❌ Found $ERRORS error(s)"
    echo "Please review the workflow file and fix the issues above"
    exit 1
fi
