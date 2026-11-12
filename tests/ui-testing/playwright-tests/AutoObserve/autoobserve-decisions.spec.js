// Dismiss, Mark as intended report and Undo on Alert calibration through the decision route; needs an enterprise server with O2_AUTOOBSERVE_DECISIONS_ENABLED and open findings in AO_ORG (default demo-org).
const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const { AutoObserveDecisionsPage, BASE } = require('../../pages/autoobservePages/autoobserveDecisionsPage.js');

const ORG = process.env.AO_ORG || 'demo-org';
const READER = process.env.AO_READER_EMAIL || '';
const READER_PASSWORD = process.env.AO_READER_PASSWORD || '';

const auth = () =>
  `Basic ${Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`).toString('base64')}`;

// Decisions this spec wrote, so a failed step never leaves a finding hidden for the next run.
const written = new Set();
const remember = (result) => {
  if (result.body && result.body.decision) written.add(result.body.decision.decision_id);
  for (const item of (result.body && result.body.results) || []) {
    if (item.result) written.add(item.result.decision.decision_id);
  }
};

test.describe.configure({ mode: 'serial' });

test.describe('AutoObserve decisions on Alert calibration', { tag: ['@autoobserve', '@enterprise'] }, () => {
  test.afterAll(async ({ playwright }) => {
    if (!written.size) return;
    const request = await playwright.request.newContext();
    const headers = { Authorization: auth() };
    const res = await request.get(`${BASE()}/api/v2/${ORG}/autoobserve/decisions?state=active&limit=50&offset=0`, { headers });
    for (const d of (await res.json()).decisions || []) {
      if (!written.has(d.decision_id)) continue;
      await request.post(`${BASE()}/api/v2/${ORG}/autoobserve/decisions/${encodeURIComponent(d.decision_id)}/undo`, {
        headers,
        data: { expected_revision: d.revision },
      });
    }
    await request.dispose();
  });

  test('planned work hides the finding until its end, and the toast Undo brings it back', async ({ page }) => {
    const ao = new AutoObserveDecisionsPage(page);
    await ao.open(ORG);
    const before = await ao.dismissButtons.count();
    expect(before).toBeGreaterThan(0);

    await ao.openDismiss();
    await ao.chosen(() => ao.reason('planned_work').click());
    await expect(ao.durationOption('90')).toBeDisabled();
    const saved = await ao.save();
    remember(saved);
    expect(saved.status).toBe(200);
    expect(saved.sent).toMatchObject({ family: 'alert_finding', reason: 'planned_work', until: expect.any(Number) });
    expect(saved.sent).not.toHaveProperty('duration_days');
    await expect(ao.dialog).toBeHidden();
    await expect(ao.dismissButtons).toHaveCount(before - 1);

    expect(await ao.undo(ao.toastUndo.first())).toBe(200);
    await expect(ao.dismissButtons).toHaveCount(before, { timeout: 30000 });
  });

  test('not needed is saved for the chosen length and reads the same in both dismissed lists', async ({ page }) => {
    const ao = new AutoObserveDecisionsPage(page);
    await ao.open(ORG);
    const before = await ao.dismissButtons.count();
    expect(before).toBeGreaterThan(0);

    await ao.openDismiss();
    await expect(ao.duration).toBeVisible();
    await ao.chosen(() => ao.reason('not_needed').click());
    await ao.chosen(() => ao.durationOption('30').click());
    await ao.note.fill('Checked by the e2e run');
    const saved = await ao.save();
    remember(saved);
    expect(saved.status).toBe(200);
    expect(saved.sent).toMatchObject({ reason: 'not_needed', duration_days: 30, note: 'Checked by the e2e run' });
    await expect(ao.notice).toHaveCount(0);
    await expect(ao.dialog).toBeHidden();
    await expect(ao.dismissButtons).toHaveCount(before - 1);

    await ao.open(ORG, 'findings=dismissed');
    await expect(ao.decidedRows).toHaveCount(1, { timeout: 30000 });
    await expect(ao.decidedSummaries.first()).toContainText('Not needed ·');
    await expect(ao.decidedSummaries.first()).not.toContainText('for these sources');
    await expect(ao.oldTable).toContainText('Not needed');
    await expect(ao.oldTable).not.toContainText('Another reason');

    expect(await ao.undo(ao.decidedUndo.first())).toBe(200);
    await expect(ao.decidedRows).toHaveCount(0, { timeout: 30000 });
    await ao.open(ORG);
    await expect(ao.dismissButtons).toHaveCount(before, { timeout: 30000 });
  });

  test('a finding marked as an intended report says it is a mark, and Undo restores it', async ({ page }) => {
    const ao = new AutoObserveDecisionsPage(page);
    await ao.open(ORG);
    await expect(ao.evidence.first()).toBeVisible();
    await ao.evidence.first().click();
    await expect(ao.markButtons.first()).toBeVisible({ timeout: 60000 });

    await ao.markButtons.first().click();
    await expect(ao.markDialog).toBeVisible();
    await expect(ao.markChecks.first()).toBeVisible({ timeout: 15000 });
    const marked = await ao.save(ao.markSubmit);
    remember(marked);
    expect(marked.status).toBe(200);
    expect(marked.body.failed).toBe(0);
    await expect(ao.markDialog).toBeHidden();
    await expect(ao.findingBadge.first()).toHaveText('Intended report');
    await expect(ao.findingFold.first()).toContainText('Marked as intended report by');
    await expect(ao.findingFold.first()).not.toContainText('Another reason');

    expect(await ao.undo(ao.toastUndo.first())).toBe(200);
    await expect(ao.findingBadge).toHaveCount(0, { timeout: 30000 });
    await expect(ao.markButtons.first()).toBeVisible();
  });

  test('a reader who may not dismiss sees the locked line and cannot save', async ({ browser }) => {
    test.skip(!READER || !READER_PASSWORD, 'set AO_READER_EMAIL and AO_READER_PASSWORD to a folder-only user');
    const context = await browser.newContext({ viewport: { width: 1500, height: 1024 } });
    const page = await context.newPage();
    await page.goto(`${BASE()}/web/login`);
    await page.locator('[data-test="login-user-id-field"]').fill(READER);
    await page.locator('[data-test="login-password-field"]').fill(READER_PASSWORD);
    await page.locator('[data-test="login-sign-in"]').click();
    await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 60000 });

    const ao = new AutoObserveDecisionsPage(page);
    let posted = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/autoobserve/decisions')) posted += 1;
    });
    await ao.open(ORG);
    await ao.openDismiss();
    await expect(ao.locked).toBeVisible();
    await expect(ao.submit).toBeDisabled();
    expect(posted).toBe(0);
    await context.close();
  });
});
