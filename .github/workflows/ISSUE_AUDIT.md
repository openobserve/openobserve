# Issue Audit Workflow

Automated retrospective audit of open bug issues to ensure they have both fix + test coverage.

## What It Does

This workflow audits all open issues labeled with `bug` and categorizes them:

1. **✅ Ready to Close**: Has merged fix PR + test with `@bug-{issue#}` tag → **Auto-closes**
2. **⚠️ Needs Test**: Has merged fix PR but no test → **Comments asking for test**
3. **⚠️ Needs Fix**: Has test but no merged PR → **Reports** (weird case)
4. **❌ Needs Both**: No fix and no test → **Reports only**

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│ Trigger: Manual or Weekly (Monday)                     │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 1. Fetch All Open Bug Issues                           │
│    - Only issues with "bug" label                      │
│    - Excludes PRs                                       │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 2. For Each Issue:                                      │
│    a) Check for merged PR with closing keywords        │
│       - Searches timeline for "Closes #X", "Fixes #X"  │
│       - Verifies PR is merged                          │
│    b) Check for test with @bug-{issue#} tag            │
│       - Greps test directory                           │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Categorize and Take Action:                         │
│                                                         │
│  ✅ Fix + Test → Auto-close with comment               │
│  ⚠️  Fix only → Post comment asking for test           │
│  ⚠️  Test only → Report (no action)                    │
│  ❌ Neither → Report (no action)                       │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Generate Report                                      │
│    - Summary table                                      │
│    - Details for each category                         │
│    - Saved as downloadable artifact                    │
└─────────────────────────────────────────────────────────┘
```

## Triggers

### Manual Trigger
```bash
# Via GitHub UI
Go to: Actions → Issue Audit → Run workflow

# Via gh CLI
gh workflow run issue-audit.yml
```

### Scheduled Trigger
- **When**: Every Monday at midnight UTC
- **Frequency**: Weekly
- **Customize**: Edit `cron:` in the workflow file

## Example Outputs

### Auto-Closed Issue Comment
```markdown
## ✅ Issue Resolved - Auto-Closed by Issue Audit

This issue has been automatically closed because:
- ✅ **Fix merged**: PR #11357 (https://github.com/.../pull/11357)
- ✅ **Test coverage**: `tests/ui-testing/playwright-tests/RegressionSet/dashboards-11357.spec.js`

The fix has been implemented and proper test coverage exists with the `@bug-11357` tag.

---
🤖 Automated by Issue Audit Workflow
```

### Needs Test Comment
```markdown
## ⚠️  Missing Test Coverage

**Status**: This issue has been fixed but lacks E2E test coverage.

- ✅ **Fix merged**: PR #11234 (https://github.com/.../pull/11234)
- ❌ **No test found**: Missing `@bug-11234` tag

**Action needed**:
Please add an E2E test with proper tags:
```javascript
test("Test description @bug-11234 @regression", async ({ page }) => {
  // Test implementation
});
```

Place the test in `tests/ui-testing/playwright-tests/RegressionSet/`

---
🤖 Detected by Issue Audit Workflow
```

### Audit Report
```markdown
# Issue Audit Report

**Run ID**: 123456789
**Date**: 2026-04-21T18:00:00.000Z

---

## Summary

| Category | Count |
|----------|-------|
| ✅ Auto-closed (fix + test) | 5 |
| ⚠️  Needs test | 12 |
| ⚠️  Needs fix | 2 |
| ❌ Needs both | 23 |
| **Total audited** | **42** |

## ✅ Auto-Closed Issues (5)

- #11357: Dashboard table chart copy cell format
  - Fix: PR #11358
  - Test: `tests/ui-testing/playwright-tests/RegressionSet/dashboards-11357.spec.js`

...

## ⚠️  Issues Needing Tests (12)

- #11234: Fix dashboard filter bug
  - Fix: PR #11235 (merged 2026-04-15)
  - Missing test with @bug-11234 tag

...
```

## Configuration

### Change Schedule
Edit `.github/workflows/issue-audit.yml`:

```yaml
schedule:
  - cron: '0 0 * * 1'  # Weekly on Monday
  # Examples:
  # - cron: '0 0 * * *'  # Daily at midnight
  # - cron: '0 0 1 * *'  # Monthly on 1st
```

### Change Issue Label
```yaml
labels: 'bug',  # Only audit bug issues
# Or use multiple labels:
# labels: ['bug', 'regression']
```

### Disable Auto-Closing
Remove or comment out the "Auto-close issues" step.

## Requirements

- **GitHub Token**: Auto-provided (`GITHUB_TOKEN`)
- **Permissions**:
  - `issues: write` - To close issues and post comments
  - `pull-requests: read` - To check PR status
  - `contents: read` - To search test files

## Monitoring

### View Run Results
```
GitHub → Actions → Issue Audit → Click run
```

### Download Report
1. Go to completed workflow run
2. Scroll to "Artifacts"
3. Download `issue-audit-report`

### Check Logs
Each step shows detailed logs:
- Issue fetching
- PR checking
- Test coverage checking
- Categorization results

## Benefits

### For QA
✅ **Automatic cleanup** - Issues with fix + test auto-close
✅ **Missing test alerts** - Proactive comments on issues
✅ **Coverage visibility** - Weekly reports

### For Developers
✅ **Clear action items** - Know which issues need tests
✅ **Reduced manual checking** - Automated audit
✅ **Audit trail** - All actions logged in GitHub

### For Project
✅ **Test coverage enforcement** - Can't close without test
✅ **Issue hygiene** - Automatic cleanup of resolved issues
✅ **Quality metrics** - Track test coverage over time

## Troubleshooting

### Issue: Workflow doesn't find merged PRs

**Check**:
1. PR body uses closing keywords: "Closes #1234", "Fixes #1234", "Resolves #1234"
2. PR is actually merged (not just closed)
3. PR references the issue correctly

### Issue: Test not detected

**Check**:
1. Test file has `@bug-{issue#}` tag
2. Test file is in `tests/ui-testing/playwright-tests/` directory
3. File extension is `.spec.js`

### Issue: Too many issues audited

**Solution**:
Add more specific labels or date filters:
```yaml
# Only recent issues
const cutoffDate = new Date();
cutoffDate.setMonth(cutoffDate.getMonth() - 3);  // Last 3 months
const issues = allIssues.filter(i => new Date(i.created_at) > cutoffDate);
```

## Customization Examples

### Only Auto-Close Issues Older Than 30 Days
```javascript
if (hasFix && hasTest) {
  const issueAge = Date.now() - new Date(issue.created_at);
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  if (issueAge > thirtyDays) {
    results.ready_to_close.push(result);
  }
}
```

### Require Specific Test Location
```javascript
const hasTest = searchResult && searchResult.includes('RegressionSet/');
```

### Send Slack Notification
Add a step:
```yaml
- name: Send Slack notification
  if: steps.audit.outputs.ready_to_close_count > 0
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "Issue Audit: Closed ${{ steps.audit.outputs.ready_to_close_count }} issues"
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

## Next Steps

1. ✅ Workflow is created and committed
2. ⏳ Trigger manual run to test
3. ⏳ Review first audit report
4. ⏳ Adjust settings as needed

---

*Issue Audit Workflow - Retrospective test coverage enforcement* 🔍
