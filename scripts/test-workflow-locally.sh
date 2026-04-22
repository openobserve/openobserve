#!/bin/bash
# Local test script for issue-audit workflow
# Usage: ./scripts/test-workflow-locally.sh <issue_number>

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <issue_number>"
    echo "Example: $0 1234"
    exit 1
fi

ISSUE_NUMBER=$1
OWNER="openobserve"
REPO="openobserve"

echo "🔍 Testing workflow logic for issue #${ISSUE_NUMBER}"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ gh CLI not found. Install it with: brew install gh"
    exit 1
fi

# Fetch issue details
echo "📥 Fetching issue #${ISSUE_NUMBER}..."
ISSUE_JSON=$(gh api "/repos/${OWNER}/${REPO}/issues/${ISSUE_NUMBER}" 2>/dev/null || echo "")

if [ -z "$ISSUE_JSON" ]; then
    echo "❌ Could not fetch issue #${ISSUE_NUMBER}"
    exit 1
fi

ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
ISSUE_STATE=$(echo "$ISSUE_JSON" | jq -r '.state')
ISSUE_CREATED=$(echo "$ISSUE_JSON" | jq -r '.created_at')
IS_PR=$(echo "$ISSUE_JSON" | jq -r '.pull_request != null')

echo "  Title: $ISSUE_TITLE"
echo "  State: $ISSUE_STATE"
echo "  Created: $ISSUE_CREATED"

# Check age (2 months = 60 days)
CREATED_TIMESTAMP=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$ISSUE_CREATED" "+%s" 2>/dev/null || echo "0")
TWO_MONTHS_AGO=$(date -v-60d "+%s")
AGE_DAYS=$(( ($(date "+%s") - CREATED_TIMESTAMP) / 86400 ))

echo "  Age: ${AGE_DAYS} days"
echo ""

if [ "$IS_PR" = "true" ]; then
    echo "⚠️  This is a PR, not an issue. Workflow only processes issues."
    exit 0
fi

if [ "$ISSUE_STATE" != "open" ]; then
    echo "⚠️  Issue is ${ISSUE_STATE}. Workflow only processes open issues."
    exit 0
fi

if [ "$CREATED_TIMESTAMP" -gt "$TWO_MONTHS_AGO" ]; then
    echo "⚠️  Issue is only ${AGE_DAYS} days old (< 60 days). Workflow only processes issues older than 2 months."
    exit 0
fi

echo "✅ Issue qualifies for age filter (${AGE_DAYS} days old, > 60 days required)"

# Check for bug label
LABELS=$(echo "$ISSUE_JSON" | jq -r '.labels[].name')
if ! echo "$LABELS" | grep -q "bug"; then
    echo "⚠️  Issue doesn't have 'bug' label. Workflow only audits bug issues."
    exit 0
fi

echo "✅ Issue qualifies for audit (open + bug label + older than 2 months)"
echo ""

# Step 1: Check for merged PR that fixes this issue
echo "🔎 Step 1: Checking for merged PR that fixes this issue..."
HAS_FIX=false
FIX_PR_NUMBER=""
FIX_PR_TITLE=""
FIX_PR_URL=""

# Fetch timeline events
TIMELINE=$(gh api "/repos/${OWNER}/${REPO}/issues/${ISSUE_NUMBER}/timeline" --paginate 2>/dev/null || echo "[]")

# Look for cross-referenced PRs
CROSS_REFS=$(echo "$TIMELINE" | jq -r '.[] | select(.event == "cross-referenced" and .source.issue.pull_request != null) | .source.issue.number')

for PR_NUM in $CROSS_REFS; do
    echo "  Checking PR #${PR_NUM}..."

    PR_DATA=$(gh api "/repos/${OWNER}/${REPO}/pulls/${PR_NUM}" 2>/dev/null || echo "{}")
    PR_MERGED=$(echo "$PR_DATA" | jq -r '.merged')
    PR_BODY=$(echo "$PR_DATA" | jq -r '.body // ""' | tr '[:upper:]' '[:lower:]')

    if [ "$PR_MERGED" = "true" ]; then
        # Check if PR body mentions this issue with closing keywords
        if echo "$PR_BODY" | grep -qE "(closes|fixes|resolves|fixed|close|resolve) #${ISSUE_NUMBER}|(:) #${ISSUE_NUMBER}"; then
            HAS_FIX=true
            FIX_PR_NUMBER=$PR_NUM
            FIX_PR_TITLE=$(echo "$PR_DATA" | jq -r '.title')
            FIX_PR_URL=$(echo "$PR_DATA" | jq -r '.html_url')
            echo "  ✅ Found fix: PR #${PR_NUM} - ${FIX_PR_TITLE}"
            break
        fi
    fi
done

if [ "$HAS_FIX" = false ]; then
    echo "  ❌ No merged PR found that fixes this issue"
fi
echo ""

# Step 2: Check for test with @bug-{issue#} tag
echo "🧪 Step 2: Checking for test coverage..."
HAS_TEST=false
TEST_FILE=""

TEST_DIR="tests/ui-testing/playwright-tests/"
if [ -d "$TEST_DIR" ]; then
    TAG="@bug-${ISSUE_NUMBER}"
    SEARCH_RESULT=$(grep -r "$TAG" "$TEST_DIR" --include="*.spec.js" -l 2>/dev/null || true)

    if [ -n "$SEARCH_RESULT" ]; then
        HAS_TEST=true
        TEST_FILE=$(echo "$SEARCH_RESULT" | head -n 1)
        echo "  ✅ Found test: $TEST_FILE"
    else
        echo "  ❌ No test found with tag ${TAG}"
    fi
else
    echo "  ⚠️  Test directory not found: $TEST_DIR"
fi
echo ""

# Step 3: Categorize and show what would happen
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 AUDIT RESULT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$HAS_FIX" = true ] && [ "$HAS_TEST" = true ]; then
    echo "Category: ✅ READY TO CLOSE"
    echo ""
    echo "The workflow would:"
    echo "  1. Add label: 'Ready to Close'"
    echo "  2. Post comment:"
    echo ""
    echo "---"
    echo "## ✅ Ready to Close - Human Confirmation Required"
    echo ""
    echo "This issue appears to be resolved with proper test coverage:"
    echo "- ✅ **Fix merged**: PR #${FIX_PR_NUMBER} (${FIX_PR_URL})"
    echo "- ✅ **Test coverage**: \`${TEST_FILE}\` (tagged \`@bug-${ISSUE_NUMBER}\`)"
    echo ""
    echo "**Action Required**: Please verify the fix resolves this issue, then close it manually."
    echo "---"

elif [ "$HAS_FIX" = true ] && [ "$HAS_TEST" = false ]; then
    echo "Category: ⚠️  NEEDS TEST"
    echo ""
    echo "The workflow would:"
    echo "  1. Analyze PR #${FIX_PR_NUMBER} files (code vs doc)"
    echo "  2. If code files changed:"
    echo "     - Add label: 'Needs Automation'"
    echo "     - Post comment requesting E2E test"
    echo "  3. If only doc/config files changed:"
    echo "     - Add label: 'Review Needed'"
    echo "     - Post comment for human review"
    echo ""
    echo "Run this to see what files were changed:"
    echo "  gh pr view ${FIX_PR_NUMBER} --json files"

elif [ "$HAS_FIX" = false ] && [ "$HAS_TEST" = true ]; then
    echo "Category: ⚠️  NEEDS FIX (has test but no merged PR)"
    echo ""
    echo "The workflow would:"
    echo "  - Include in report only (no action taken)"
    echo "  - Test exists at: ${TEST_FILE}"

else
    echo "Category: ❌ NEEDS BOTH (no fix, no test)"
    echo ""
    echo "The workflow would:"
    echo "  - Include in report only (no action taken)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
