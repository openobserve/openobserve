# Bug Checker Agent

Automated agent that identifies open bug issues that may have already been fixed by merged PRs.

## What it does

1. Scans all open issues labeled `bug`
2. Searches for merged PRs that reference each issue (using patterns like `fixes #123`, `closes #123`, etc.)
3. Comments on issues that appear to have been fixed, requesting human verification
4. Skips issues that were already commented on within the last 30 days (to avoid spam)

## Schedule

Runs automatically every Monday at 9 AM UTC.

## Manual Trigger

You can manually trigger the workflow from GitHub Actions with options:

- **dry_run**: Set to `true` to only report findings without commenting on issues
- **days_threshold**: Only check issues older than N days (default: 7)

## Workflow File

Located at: `.github/workflows/bug-checker.yml`

## Customization

To adapt this for other repositories:

1. Copy the workflow file to your repo's `.github/workflows/` directory
2. Modify the label filter if you use different labels for bugs
3. Adjust the schedule cron expression as needed
4. Update the patterns array if your team uses different PR conventions

## Permissions Required

- `issues: write` - To post comments on issues
- `pull-requests: read` - To search merged PRs

## Example Output

When the agent finds a potentially fixed bug, it posts a comment like:

```
## Bug Checker Agent Report

This issue appears to have been addressed by the following merged PR(s):

- #456: Fix authentication timeout issue
- #478: Additional fix for edge case

**Action requested:** Please verify if this bug has been fixed and close this issue if appropriate.
```
