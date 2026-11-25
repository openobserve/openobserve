// AutoResolve page object: the Response menu entry, the goal box, the approval request, the run page, the runs list and saved AutoResolves.

const { expect } = require('@playwright/test');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

// The scripted agent answers at once; the slack covers the live stream's reconnect on a slow runner.
const RUN_TIMEOUT_MS = 60000;

const RUN_URL = /\/autoresolve\/runs\/([^/?#]+)/;
const SAVED_URL = /\/autoresolve\/saved\/(?!new(?:[/?#]|$))([^/?#]+)/;

const api = () => `${process.env.ZO_BASE_URL}/api`;
const savedBase = () => `${api()}/v2/${getOrgIdentifier()}/autoresolve/saved`;
const savedApi = (id) => `${savedBase()}/${id}`;
// The e2e / AutoResolve shard starts tests/api-testing/helpers/autoresolve_agent_mock.py on this port.
const AGENT_MOCK = () => process.env.AUTORESOLVE_AGENT_MOCK_URL || 'http://127.0.0.1:5098';

class AutoResolvePage {
  constructor(page) {
    this.page = page;
    this.reliabilityGroup = page.locator('[data-test="nav-group-reliability"]');
    this.flyout = page.locator('[data-test="nav-group-flyout-reliability"]');
    this.flyoutItems = this.flyout.locator("a[data-test^='nav-group-item-']");
    this.menuItem = this.flyout.locator('[data-test="nav-group-item-autoresolve"]');
    this.homePage = page.locator('[data-test="autoresolve-home-page"]');
    this.goalBox = page.locator('[data-test="autoresolve-goal-box"]');
    this.goalInput = page.locator('[data-test="autoresolve-goal-box-input-field"]');
    this.startButton = page.locator('[data-test="autoresolve-goal-box-start"]');
    this.runPage = page.locator('[data-test="autoresolve-run-page"]');
    this.approvalRequest = page.locator('[data-test="autoresolve-approval-request"]');
    this.options = page.locator('[data-test="autoresolve-approval-option"]');
    this.approveButton = page.locator('[data-test="autoresolve-approval-approve"]');
    this.steps = page.locator('[data-test="autoresolve-run-steps"]');
    this.stepsToggle = this.steps.locator('button[aria-expanded]').first();
    this.stepCards = this.steps.locator('[data-test="autoresolve-step-card"]');
    this.outcome = page.locator('[data-test="autoresolve-outcome"]');
    this.runsTab = page.locator('[data-test="autoresolve-home-tab-runs"]');
    this.runsTable = page.locator('[data-test="autoresolve-runs-table"]');
    this.saveAsButton = page.locator('[data-test="autoresolve-run-save-as"]');
    this.savedForm = page.locator('[data-test="autoresolve-saved-form"]');
    this.savedFormAlert = page.locator('[data-test="autoresolve-saved-form-alert"]');
    this.savedFormSave = page.locator('[data-test="autoresolve-saved-form-save"]');
    this.savedDetails = page.locator('[data-test="autoresolve-saved-details"]');
    this.runNowButton = page.locator('[data-test="autoresolve-saved-run-now"]');
    this.lastRunsRows = page.locator('[data-test="autoresolve-runs-recent-table"] tr[data-test^="o2-table-row-"]');
    this.correctButton = page.locator('[data-test="autoresolve-approval-correct"]');
    this.correctionPanel = page.locator('[data-test="autoresolve-correction-panel"]');
    this.correctionNote = page.locator('[data-test="autoresolve-correction-note"] textarea');
    this.correctionSend = page.locator('[data-test="autoresolve-correction-send"]');
    this.rememberCheckbox = page.locator('[data-test="autoresolve-remember-checkbox"]');
    this.correctionsUsed = page.locator('[data-test="autoresolve-corrections-used"]');
    this.correctionsUsedManage = page.locator('[data-test="autoresolve-corrections-used-manage"]');
    this.savedCorrections = page.locator('[data-test="autoresolve-saved-corrections"]');
    this.savedCorrectionRows = page.locator('[data-test="autoresolve-saved-correction"]');
    this.savedCorrectionRemove = page.locator('[data-test="autoresolve-saved-correction-remove"]');
    this.partialFixTags = page.locator('[data-test="autoresolve-approval-partial-fix"]');
    this.recommendedTags = page.locator('[data-test="autoresolve-approval-recommended"]');
    this.missingConnection = page.locator('[data-test="autoresolve-missing-connection"]');
    this.missingConnectionAdd = page.locator('[data-test="autoresolve-missing-connection-add"]');
    this.addConnectionDialog = page.locator('[data-test="autoresolve-add-connection-dialog"]');
    this.addConnectionConfirm = page.locator('[data-test="autoresolve-add-connection-confirm"]');
    this.verdictNo = page.locator('[data-test="autoresolve-verdict-no"]');
    this.verdictNote = page.locator('[data-test="autoresolve-verdict-note"] input');
    this.verdictPlanAgain = page.locator('[data-test="autoresolve-verdict-plan-again"]');
    this.agentVerdict = page.locator('[data-test="autoresolve-verdicts-agent"]');
    this.personVerdict = page.locator('[data-test="autoresolve-verdicts-person"]');
  }

  async createConnection(request, name) {
    const res = await request.post(`${api()}/${getOrgIdentifier()}/ai/toolsets`, {
      headers: getAuthHeaders(),
      data: {
        name,
        kind: 'mcp',
        description: 'Scripted connection for the AutoResolve e2e',
        data: { url: 'https://mcp.autoresolve-e2e.test/mcp', headers: {} },
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()).id;
  }

  async deleteConnection(request, id) {
    await request.delete(`${api()}/${getOrgIdentifier()}/ai/toolsets/${id}`, { headers: getAuthHeaders() });
  }

  // Hover-driven with an open delay and a close-on-scroll, so the open is retried as a unit (commonActions.openNavFlyoutChild).
  async openResponseMenu() {
    await this.reliabilityGroup.waitFor({ state: 'visible', timeout: 30000 });
    await expect(async () => {
      await this.page.mouse.move(0, 0);
      await this.reliabilityGroup.hover();
      await expect(this.flyout).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30000 });
  }

  // A missing entry means the server runs with the AutoResolve gate closed: that is a broken shard, not a skip.
  async expectMenuEntry() {
    await this.openResponseMenu();
    await expect(
      this.menuItem,
      'AutoResolve menu entry (needs O2_AUTORESOLVE_ENABLED, keys and O2_AI_INTERNAL_SECRET)',
    ).toBeVisible();
  }

  async flyoutItemIds() {
    return this.flyoutItems.evaluateAll((els) => els.map((el) => el.getAttribute('data-test')));
  }

  async openFromMenu() {
    await this.menuItem.click({ force: true });
    await expect(this.homePage).toBeVisible();
    await expect(this.goalBox).toBeVisible();
  }

  async startRun(goal) {
    await this.goalInput.fill(goal);
    await this.startButton.click();
    await expect(this.runPage).toBeVisible();
    await expect(this.approvalRequest).toBeVisible({ timeout: RUN_TIMEOUT_MS });
  }

  option(id) {
    return this.options.and(this.page.locator(`[data-test-value="${id}"]`));
  }

  // The option's card is the <label> around its radio; the Recommended tag sits in that label, not in the radio.
  optionCard(id) {
    return this.page.locator('label[data-variant="card"]', { has: this.option(id) });
  }

  recommendedTag(id) {
    return this.optionCard(id).locator('[data-test="autoresolve-approval-recommended"]');
  }

  async approve(id) {
    await this.option(id).click();
    await expect(this.option(id)).toHaveAttribute('data-state', 'checked');
    await this.approveButton.click();
  }

  // A run that worked folds its steps behind the outcome, so they are unfolded before they are read.
  async expectStepsDone(count) {
    await expect(this.stepsToggle).toBeVisible({ timeout: RUN_TIMEOUT_MS });
    if ((await this.stepsToggle.getAttribute('aria-expanded')) !== 'true') await this.stepsToggle.click();
    await expect(this.stepsToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(this.stepCards).toHaveCount(count, { timeout: RUN_TIMEOUT_MS });
    for (let i = 0; i < count; i++) {
      await expect(this.stepCards.nth(i)).toHaveAttribute('data-state', 'done', { timeout: RUN_TIMEOUT_MS });
    }
  }

  async expectOutcome(verdict) {
    await expect(this.outcome).toHaveAttribute('data-verdict', verdict, { timeout: RUN_TIMEOUT_MS });
  }

  async openRunsTab() {
    await this.page.goto(`${process.env.ZO_BASE_URL}/web/autoresolve?org_identifier=${getOrgIdentifier()}`);
    await expect(this.homePage).toBeVisible();
    await this.runsTab.click();
    await expect(this.runsTable).toBeVisible();
  }

  runRow(goal) {
    return this.runsTable.locator('tr', { hasText: goal });
  }

  async currentRunId() {
    await expect(this.page).toHaveURL(RUN_URL);
    return this.page.url().match(RUN_URL)[1];
  }

  // Runs when stays on its default for a person's run, so the alert picker never shows.
  async saveAsAutoResolve() {
    await this.saveAsButton.click();
    await expect(this.savedForm).toBeVisible();
    await expect(this.savedFormAlert).toHaveCount(0);
    await this.savedFormSave.click();
    await expect(this.page).toHaveURL(SAVED_URL);
    await expect(this.savedDetails).toBeVisible();
    return this.page.url().match(SAVED_URL)[1];
  }

  async runNow() {
    await this.runNowButton.click();
    await expect(this.runPage).toBeVisible();
    await expect(this.approvalRequest).toBeVisible({ timeout: RUN_TIMEOUT_MS });
    return this.currentRunId();
  }

  correctionKind(kind) {
    return this.page.locator(`[data-test="autoresolve-correction-kind-${kind}"]`);
  }

  // The kind fills a draft note; the person's own words replace it.
  async correctPlan(kind, note) {
    await this.correctButton.click();
    await this.correctionKind(kind).click();
    await expect(this.correctionNote).not.toHaveValue('');
    await this.correctionNote.fill(note);
    await this.correctionSend.click();
  }

  // A person-started saved AutoResolve, made through the API so a test starts from its page.
  async createSaved(request, { name, goal, connectionIds }) {
    const res = await request.post(savedBase(), {
      headers: getAuthHeaders(),
      data: {
        name,
        goal,
        connection_ids: connectionIds,
        trigger_kind: 'person',
        trigger_alert_id: null,
        from_run_id: null,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).id;
  }

  // Every turn the scripted agent saw for one run, oldest first.
  async agentTurns(request, runId, phase) {
    const res = await request.get(`${AGENT_MOCK()}/_mock/requests`);
    expect(res.status(), await res.text()).toBe(200);
    const { turns } = await res.json();
    return turns.filter((turn) => turn.run_id === runId && (!phase || turn.phase === phase));
  }

  async openSaved(id) {
    await this.page.goto(`${process.env.ZO_BASE_URL}/web/autoresolve/saved/${id}?org_identifier=${getOrgIdentifier()}`);
    await expect(this.savedDetails).toBeVisible();
  }

  async getSaved(request, id) {
    const res = await request.get(savedApi(id), { headers: getAuthHeaders() });
    expect(res.status(), await res.text()).toBe(200);
    return res.json();
  }

  async deleteSaved(request, id) {
    await request.delete(savedApi(id), { headers: getAuthHeaders() });
  }
}

module.exports = AutoResolvePage;
