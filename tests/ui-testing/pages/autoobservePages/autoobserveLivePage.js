// AutoObserve in live mode: the Standard home, its Issues page and the Nerd view, by data-test only.
const { expect } = require('@playwright/test');

const BASE = () => (process.env.ZO_BASE_URL || '').replace(/\/$/, '');

class AutoObserveLivePage {
  constructor(page) {
    this.page = page;
    this.paged = page.locator('[data-test="autoobserve2-paged"]');
    this.pagedRows = page.locator('[data-test^="autoobserve2-paged-row-"]');
    this.suggestions = page.locator('[data-test="autoobserve2-suggestions"]');
    this.scenarioPicker = page.locator('[data-test="autoobserve2-scenario"]');
    this.topbarSearch = page.locator('[data-test="autoobserve2-nav-search"]');
    this.history = page.locator('[data-test="autoobserve2-nav-history"]');
    this.settings = page.locator('[data-test="autoobserve2-nav-settings"]');
    this.issuesPage = page.locator('[data-test="autoobserve2-issues-page"]');
    this.liveIssues = page.locator('[data-test="autoobserve-live-issues"]');
    this.fixtureIssues = page.locator('[data-test="autoobserve-issues-table"]');
    this.issueRows = this.liveIssues.locator('[data-test^="o2-table-row-"]');
    this.sentences = this.liveIssues.locator('[data-test="autoobserve-live-issues-sentence"]');
    this.count = page.locator('[data-test="autoobserve-live-issues-count"]');
    this.empty = page.locator('[data-test="autoobserve-live-issues-empty"]');
    this.noMatch = page.locator('[data-test="autoobserve-live-issues-no-match"]');
    this.search = page.locator('[data-test="autoobserve-live-issues-search"] input');
    this.rangeButton = page.locator('[data-test="autoobserve2-issues-range"]');
    this.tabs = page.locator('[data-test="autoobserve-tabs"]');
    this.coverageDenied = page.locator('[data-test="autoobserve-coverage-denied"]');
    this.changesPage = page.locator('[data-test="autoobserve2-activity-page"]');
    this.footerChanges = page.locator('[data-test="autoobserve2-footer-activity"]');
    this.suggestionsDrawer = page.locator('[data-test="autoobserve2-suggestions-drawer"]');
    this.howItWorksDrawer = page.locator('[data-test="autoobserve2-how-it-works-drawer"]');
    this.scenarioLive = page.locator('[data-test="autoobserve2-scenario-live"]');
    this.sharedAnalysis = page.locator('[data-test="autoobserve-live-issues-shared-analysis"]');
    this.analysisDetails = page.locator('[data-test="autoobserve-live-issues-analysis-detail"]');
    this.issuesRefreshFailed = page.locator('[data-test="autoobserve-live-issues-refresh-failed"]');
    this.pagedShared = page.locator('[data-test="autoobserve2-paged-shared-analysis"]');
    this.pagedDetails = page.locator('[data-test="autoobserve2-paged-analysis-detail"]');
    this.pagedRefreshFailed = page.locator('[data-test="autoobserve2-paged-refresh-failed"]');
  }

  // The honest empty state a live surface shows until it has a backend: changes, history or settings.
  liveEmpty(surface) {
    return this.page.locator(`[data-test="autoobserve-live-empty-${surface}"]`);
  }

  liveEmptyAction(surface) {
    return this.page.locator(`[data-test="autoobserve-live-empty-${surface}-action"]`);
  }

  tab(name) {
    return this.tabs.locator(`[data-test="autoobserve-tab-${name}"]`);
  }

  url(org, query = '') {
    return `${BASE()}/web/autoobserve?org_identifier=${org}${query ? `&${query}` : ''}`;
  }

  // The how-it-works drawer opens on a first visit and would cover the page under test.
  async open(org, query = '') {
    await this.page.addInitScript(() => localStorage.setItem('autoobserve2.howItWorksSeen', '1'));
    await this.page.goto(this.url(org, query), { waitUntil: 'domcontentloaded' });
  }

  async expectNoFixture() {
    await expect(this.scenarioPicker).toHaveCount(0);
    await expect(this.fixtureIssues).toHaveCount(0);
    const body = this.page.locator('body');
    await expect(body).not.toContainText('Sunday, October 11');
    await expect(body).not.toContainText('search-2');
    await expect(body).not.toContainText('INC-1051');
  }

  // The demo org's incidents share one analysis reason, so it is stated once and no row repeats it.
  async expectAnalysisReasonsOnce() {
    await expect(this.sharedAnalysis).toHaveCount(1);
    await expect(this.analysisDetails).toHaveCount(0);
  }

  async expectPagedReasonOnce() {
    await expect(this.pagedShared).toHaveCount(1);
    await expect(this.pagedDetails).toHaveCount(0);
  }

  // In-app navigation keeps the query cache, so a remount past the stale time is a refresh, not a first load.
  async goInApp(query) {
    await this.page.evaluate((q) => {
      const router = document.querySelector('#app').__vue_app__.config.globalProperties.$router;
      return router.push({ path: router.currentRoute.value.path, query: q });
    }, query);
  }

  // Ages the cached lists past their stale time and fails the incidents API, so the next remount's refresh fails.
  async failRefreshes() {
    await this.page.route('**/autoobserve/incidents**', (route) => route.fulfill({ status: 500, body: '{}' }));
    await this.page.clock.fastForward('02:00');
  }

  async pickRange(range) {
    await this.rangeButton.click();
    await this.page.locator(`[data-test="autoobserve2-issues-range-${range}"]`).click();
  }

  tabNames() {
    return this.tabs
      .locator('[data-test^="autoobserve-tab-"]:not([data-test$="-badge"])')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-test').replace('autoobserve-tab-', '')));
  }
}

module.exports = { AutoObserveLivePage, BASE };
