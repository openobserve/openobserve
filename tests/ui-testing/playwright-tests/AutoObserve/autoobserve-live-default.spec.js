// AutoObserve opens live with no URL flag and lists real incidents; needs AO_ORG (default demo-org) to hold some.
const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const { AutoObserveLivePage, BASE } = require('../../pages/autoobservePages/autoobserveLivePage.js');

const ORG = process.env.AO_ORG || 'demo-org';
const READER = process.env.AO_READER_EMAIL || '';
const READER_PASSWORD = process.env.AO_READER_PASSWORD || '';

const auth = () =>
  `Basic ${Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`).toString('base64')}`;

// The newest page of the org's AutoObserve incidents, straight from the API the views read.
async function incidents(playwright) {
  const request = await playwright.request.newContext();
  const res = await request.get(`${BASE()}/api/v2/${ORG}/autoobserve/incidents?limit=100&offset=0`, {
    headers: { Authorization: auth() },
  });
  const body = await res.json();
  await request.dispose();
  return body.items;
}

test.describe.configure({ mode: 'serial' });

test.describe('AutoObserve is live by default', { tag: ['@autoobserve', '@enterprise'] }, () => {
  let items = [];

  test.beforeAll(async ({ playwright }) => {
    items = await incidents(playwright);
  });

  test('the home with no live flag shows the paged card, never the fixture', async ({ page }) => {
    const ao = new AutoObserveLivePage(page);
    await ao.open(ORG);
    await expect(ao.paged).toBeVisible({ timeout: 30000 });
    await expect(ao.topbarSearch).toBeVisible();
    await expect(ao.footerChanges).toBeVisible();
    await expect(ao.scenarioLive).toBeVisible();
    await ao.expectNoFixture();
    await ao.expectPagedReasonOnce();
  });

  test('a failed refresh keeps the shared analysis reason on the home card and the Issues page', async ({ page }) => {
    await page.clock.install();
    const ao = new AutoObserveLivePage(page);
    await ao.open(ORG);
    await expect(ao.paged).toBeVisible({ timeout: 30000 });
    await ao.expectPagedReasonOnce();
    await ao.goInApp({ org_identifier: ORG, page: 'issues' });
    await expect(ao.issueRows).toHaveCount(items.length, { timeout: 30000 });
    await ao.expectAnalysisReasonsOnce();

    await ao.failRefreshes();
    await ao.goInApp({ org_identifier: ORG });
    await expect(ao.pagedRefreshFailed).toBeVisible({ timeout: 30000 });
    await ao.expectPagedReasonOnce();
    await ao.goInApp({ org_identifier: ORG, page: 'issues' });
    await expect(ao.issuesRefreshFailed).toBeVisible({ timeout: 30000 });
    await expect(ao.issueRows).toHaveCount(items.length);
    await ao.expectAnalysisReasonsOnce();
  });

  test('History and Settings stay, with honest empty states and a next step', async ({ page }) => {
    const ao = new AutoObserveLivePage(page);
    await ao.open(ORG);
    await expect(ao.paged).toBeVisible({ timeout: 30000 });
    await ao.settings.click();
    await expect(ao.liveEmpty('settings')).toBeVisible();
    await ao.liveEmptyAction('settings').click();
    await expect(ao.howItWorksDrawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ao.howItWorksDrawer).toBeHidden();
    await ao.history.click();
    await expect(ao.liveEmpty('history')).toBeVisible();
    await ao.expectNoFixture();
    await ao.liveEmptyAction('history').click();
    await expect(page).toHaveURL(/page=issues/);
    await expect(ao.liveIssues).toBeVisible({ timeout: 30000 });
  });

  test('the Issues page lists the org incidents and a row opens the incident page', async ({ page }) => {
    expect(items.length).toBeGreaterThan(0);
    const ao = new AutoObserveLivePage(page);
    await ao.open(ORG, 'page=issues');
    await expect(ao.liveIssues).toBeVisible({ timeout: 30000 });
    await expect(ao.issueRows).toHaveCount(items.length, { timeout: 30000 });
    await ao.expectNoFixture();
    await ao.expectAnalysisReasonsOnce();
    await ao.issueRows.first().click();
    await expect(page).toHaveURL(new RegExp(`/web/incidents/${items[0].incident.id}`), { timeout: 30000 });
  });

  test('a Changes page link opens the Changes page with an honest empty state', async ({ page }) => {
    const ao = new AutoObserveLivePage(page);
    await ao.open(ORG, 'page=activity');
    await expect(ao.changesPage).toBeVisible({ timeout: 30000 });
    await expect(ao.liveEmpty('changes')).toBeVisible();
    await expect(page).toHaveURL(/page=activity/);
    await ao.expectNoFixture();
    await ao.liveEmptyAction('changes').click();
    await expect(ao.suggestionsDrawer).toBeVisible();
  });

  test('the Nerd view keeps all four tabs and lists the same incidents', async ({ page }) => {
    const ao = new AutoObserveLivePage(page);
    await ao.open(ORG, 'view=nerd&tab=policy');
    await expect(ao.tabs).toBeVisible({ timeout: 30000 });
    expect(await ao.tabNames()).toEqual(['issues', 'coverage', 'activity', 'policy']);
    await expect(page).toHaveURL(/tab=policy/);
    await expect(ao.liveEmpty('settings')).toBeVisible();
    await ao.tab('activity').click();
    await expect(ao.liveEmpty('changes')).toBeVisible();
    await ao.expectNoFixture();
    await ao.tab('issues').click();
    await expect(ao.liveIssues).toBeVisible();
    const open = items.filter((i) => i.incident.status !== 'resolved').length;
    await expect(ao.issueRows).toHaveCount(open, { timeout: 30000 });
    await ao.expectNoFixture();
  });

  test('the range and the search narrow the live list', async ({ page }) => {
    const ao = new AutoObserveLivePage(page);
    await ao.open(ORG, 'page=issues&issuesRange=90d');
    await expect(ao.issueRows).toHaveCount(items.length, { timeout: 30000 });
    await ao.pickRange('7d');
    await expect(page).toHaveURL(/issuesRange=7d/);
    const week = items.filter((i) => i.finding.first_seen_at >= (Date.now() - 7 * 86400000) * 1000);
    await expect(ao.issueRows).toHaveCount(week.length, { timeout: 30000 });
    const stream = items.find((i) => i.finding.stream_name)?.finding.stream_name;
    await ao.search.fill(stream);
    await expect(page).toHaveURL(new RegExp(`q=${stream}`));
    const hits = week.filter((i) => i.finding.stream_name === stream).length;
    await expect(ao.issueRows).toHaveCount(hits);
    await ao.search.fill('no-such-stream-anywhere');
    await expect(ao.noMatch).toBeVisible();
  });
});

test.describe('AutoObserve for a folder-scoped reader', { tag: ['@autoobserve', '@enterprise'] }, () => {
  test.beforeEach(() => {
    test.skip(!READER || !READER_PASSWORD, 'set AO_READER_EMAIL and AO_READER_PASSWORD');
  });

  test('the paged card and suggestions render, and coverage shows the red denial', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1024 } });
    const page = await context.newPage();
    await page.goto(`${BASE()}/web/?org_identifier=${ORG}`, { waitUntil: 'domcontentloaded' });
    const internal = page.locator('[data-test="login-as-internal-user"]');
    if (await internal.isVisible().catch(() => false)) await internal.click();
    await page.locator('[data-test="login-user-id-field"]').fill(READER);
    await page.locator('[data-test="login-password-field"]').fill(READER_PASSWORD);
    await page.locator('[data-test="login-sign-in"]').click();
    await page.locator('[data-test="navbar-main-nav"]').waitFor({ timeout: 60000 });

    const ao = new AutoObserveLivePage(page);
    await ao.open(ORG);
    await expect(ao.paged).toBeVisible({ timeout: 30000 });
    await expect(ao.suggestions).toBeVisible();
    await ao.expectNoFixture();
    await ao.open(ORG, 'page=coverage');
    await expect(ao.coverageDenied).toBeVisible({ timeout: 30000 });
    await expect(ao.coverageDenied).toHaveAttribute('role', 'alert');
    await context.close();
  });
});
