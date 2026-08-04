// Cross-platform known bugs (o2-enterprise#2289) captured as skipped/xfail tests so they turn
// green automatically when fixed. Kept out of the per-platform suites because they are not
// platform-specific.
const { test } = require('@playwright/test');

test.describe('Known dashboard bugs (o2-enterprise#2289)', () => {
  // Error Tracking tab shows 0 errors (placeholder query + HTTP 429) for BOTH web and mobile.
  test.fixme('Error Tracking lists ingested errors', { tag: ['@known-bug', '@error-tracking'] }, async () => {});

  // Session-detail breadcrumbs panel is intermittently empty despite events existing.
  test.fixme('session breadcrumbs render for a session with events', { tag: ['@known-bug', '@breadcrumbs'] }, async () => {});

  // Session Replay is inconsistently missing ("No session replay available") on valid sessions.
  test.fixme('session replay is available for a recorded session', { tag: ['@known-bug', '@replay'] }, async () => {});
});
