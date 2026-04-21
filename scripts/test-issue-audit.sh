#!/bin/bash

# Local test script for Issue Audit workflow
# Tests the core logic without running the full GitHub Action

set -e

echo "=========================================="
echo "Issue Audit - Local Test"
echo "=========================================="
echo ""

# Test a specific issue number or default to a known issue
TEST_ISSUE="${1:-11357}"

echo "Testing issue #$TEST_ISSUE"
echo ""

# Step 1: Check if issue has a merged PR with closing keywords
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1: Check for Merged Fix PR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HAS_FIX=false
FIX_PR=""

# Search git log for merged commits mentioning this issue
MERGED_COMMITS=$(git log --all --grep="#${TEST_ISSUE}" --oneline --no-merges | head -5)

if [ -n "$MERGED_COMMITS" ]; then
  echo "Found commits mentioning issue #${TEST_ISSUE}:"
  echo "$MERGED_COMMITS"
  echo ""

  # Check if any commit message has closing keywords
  while IFS= read -r line; do
    COMMIT_MSG=$(echo "$line" | cut -d' ' -f2-)
    if echo "$COMMIT_MSG" | grep -qiE "(closes|close|fixed|fixes|fix|resolved|resolves|resolve)( |:)#${TEST_ISSUE}"; then
      HAS_FIX=true
      FIX_PR=$(echo "$line" | grep -oE "\(#[0-9]+\)" | grep -oE "[0-9]+" || echo "unknown")
      echo "✓ Found fix: Commit mentions 'closes/fixes/resolves #${TEST_ISSUE}'"
      break
    fi
  done <<< "$MERGED_COMMITS"
fi

if [ "$HAS_FIX" = false ]; then
  echo "✗ No merged fix found for issue #${TEST_ISSUE}"
fi

echo ""

# Step 2: Check for test with @bug-{issue#} tag
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2: Check for Test Coverage"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HAS_TEST=false
TEST_FILE=""

# Search for @bug-{issue#} tag in test files
if grep -r "@bug-${TEST_ISSUE}" tests/ui-testing/playwright-tests/ --include="*.spec.js" -l 2>/dev/null | head -1 | read -r found_file; then
  HAS_TEST=true
  TEST_FILE="$found_file"
  echo "✓ Found test: $TEST_FILE"

  # Show the test description
  echo ""
  echo "Test content preview:"
  grep -A 2 "@bug-${TEST_ISSUE}" "$TEST_FILE" | head -5
else
  echo "✗ No test found with @bug-${TEST_ISSUE} tag"
fi

echo ""

# Step 3: Categorize the issue
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 3: Categorize Issue"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$HAS_FIX" = true ] && [ "$HAS_TEST" = true ]; then
  echo "Category: ✅ READY TO CLOSE"
  echo ""
  echo "Action: Would auto-close with comment:"
  echo "┌─────────────────────────────────────────────────────┐"
  echo "│ ## ✅ Issue Resolved - Auto-Closed by Issue Audit  │"
  echo "│                                                     │"
  echo "│ This issue has been automatically closed because:  │"
  echo "│ - ✅ Fix merged: PR #${FIX_PR}                      │"
  echo "│ - ✅ Test coverage: ${TEST_FILE}                    │"
  echo "└─────────────────────────────────────────────────────┘"

elif [ "$HAS_FIX" = true ] && [ "$HAS_TEST" = false ]; then
  echo "Category: ⚠️  NEEDS TEST"
  echo ""
  echo "Action: Would post comment asking for test:"
  echo "┌─────────────────────────────────────────────────────┐"
  echo "│ ## ⚠️  Missing Test Coverage                        │"
  echo "│                                                     │"
  echo "│ Status: Issue has been fixed but lacks E2E test.   │"
  echo "│ - ✅ Fix merged: PR #${FIX_PR}                      │"
  echo "│ - ❌ No test found: Missing @bug-${TEST_ISSUE} tag │"
  echo "│                                                     │"
  echo "│ Action needed: Add E2E test with proper tags       │"
  echo "└─────────────────────────────────────────────────────┘"

elif [ "$HAS_FIX" = false ] && [ "$HAS_TEST" = true ]; then
  echo "Category: ⚠️  NEEDS FIX (has test but no merged PR)"
  echo ""
  echo "Action: Would report only (weird case)"
  echo "  - Test exists: $TEST_FILE"
  echo "  - No merged PR found"

else
  echo "Category: ❌ NEEDS BOTH"
  echo ""
  echo "Action: Would report only"
  echo "  - No fix found"
  echo "  - No test found"
fi

echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Issue #${TEST_ISSUE}:"
echo "  Has Fix: $HAS_FIX"
echo "  Has Test: $HAS_TEST"
echo ""
echo "To test other issues, run:"
echo "  $0 <issue-number>"
echo ""
echo "Examples:"
echo "  $0 11357  # Test issue #11357"
echo "  $0 10769  # Test issue #10769"
echo ""
