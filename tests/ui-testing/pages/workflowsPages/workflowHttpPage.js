// Workflow HTTP endpoint page object; OSwitch and OCodeBlock suffix their own ids (`-btn`, `-pre`, `-reveal-btn`, `-copy-btn`).

const { expect } = require('@playwright/test');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
const seed = require('./workflowFolderSeed.js');

const PANEL_TIMEOUT_MS = 25000;
const LIST_TIMEOUT_MS = 45000;
// Rejections are merged into the endpoint row once a minute (rejections.rs MERGE_EVERY).
const REJECTION_MERGE_TIMEOUT_MS = 150000;

const api = () => `${process.env.ZO_BASE_URL}/api`;
const triggerUrl = (id) => `${api()}/${getOrgIdentifier()}/workflows/${id}/http_trigger`;

class WorkflowHttpPage {
  constructor(page) {
    this.page = page;
    this.editorButton = '[data-test="workflow-editor-http-endpoint"]';
    this.editorChip = '[data-test="workflow-editor-http-endpoint-chip"]';
    this.nodeBadge = '[data-test="workflow-trigger-http-badge"]';
    this.panel = '[data-test="workflow-http-panel"]';
    this.panelClose = '[data-test="workflow-http-panel"] [data-test="o-drawer-close-btn"]';
    this.kindNote = '[data-test="workflow-http-kind-note"]';
    this.section = '[data-test="workflow-http-section"]';
    this.toggle = '[data-test="workflow-http-toggle-btn"]';
    this.disableConfirm = '[data-test="workflow-http-disable-confirm"]';
    this.saveAndCreate = '[data-test="workflow-http-save-and-create"]';
    this.draftBanner = '[data-test="workflow-http-draft-banner"]';
    this.reveal = '[data-test="workflow-http-reveal"]';
    this.revealBanner = '[data-test="workflow-http-reveal-banner"]';
    this.revealDone = '[data-test="workflow-http-reveal-done"]';
    this.url = '[data-test="workflow-http-url"]';
    this.tokenPre = '[data-test="workflow-http-token-pre"]';
    this.tokenReveal = '[data-test="workflow-http-token-reveal-btn"]';
    this.tokenCopy = '[data-test="workflow-http-token-copy-btn"]';
    this.sendTest = '[data-test="workflow-http-send-test"]';
    this.sendTestHint = '[data-test="workflow-http-send-test-hint"]';
    this.testResult = '[data-test="workflow-http-test-result"]';
    this.testInput = '[data-test="workflow-http-test-input"]';
    this.runTestInstead = '[data-test="workflow-http-run-test-instead"]';
    this.steady = '[data-test="workflow-http-steady"]';
    this.lastCall = '[data-test="workflow-http-last-call"]';
    this.credentials = '[data-test="workflow-http-credentials"]';
    this.retiringRow = '[data-test="workflow-http-credential-retiring"]';
    this.rotate = '[data-test="workflow-http-rotate"]';
    this.rotatePopover = '[data-test="workflow-http-rotate-popover"]';
    this.rotateOverlap = (s) => `[data-test="workflow-http-rotate-overlap-${s}"]`;
    this.rotateConsequence = '[data-test="workflow-http-rotate-consequence"]';
    this.rotateConfirm = '[data-test="workflow-http-rotate-confirm"]';
    // OTooltip owns its bubble's data-test, so the consumer id never reaches the DOM.
    this.tooltip = '[data-test="o-tooltip-content"]';
    this.credShow = (id) => `[data-test="workflow-http-credential-${id}-show"]`;
    this.credCopy = (id) => `[data-test="workflow-http-credential-${id}-copy"]`;
    this.credValue = (id) => `[data-test="workflow-http-credential-${id}-value"]`;
    this.credRevoke = (id) => `[data-test="workflow-http-credential-${id}-revoke"]`;
    this.credRevokeConfirm = (id) => `[data-test="workflow-http-credential-${id}-revoke-confirm"]`;
    this.revealDenied = '[data-test="workflow-http-credential-reveal-denied"]';
    this.advanced = '[data-test="workflow-http-advanced"]';
    this.runTest = '[data-test="workflow-http-run-test"]';
    this.rejectionsLine = '[data-test="workflow-http-rejections-line"]';
    this.rejectionsShow = '[data-test="workflow-http-rejections-show"]';
    this.rejections = '[data-test="workflow-http-rejections"]';
    this.rejectionRow = (reason) => `[data-test="workflow-http-rejection-${reason}"]`;
    this.testPayloadFrom = '[data-test="workflow-test-payload-from"]';
    this.listHttpTag = '[data-test="workflow-list-http-tag"]';
    this.listMore = (n) => `[data-test="workflow-list-${n}-more-options"]`;
    this.listMenuPanel = (n) => `[data-test="workflow-list-${n}-http-endpoint"]`;
    this.listMenuCopy = (n) => `[data-test="workflow-list-${n}-copy-endpoint"]`;
    this.runsTable = '[data-test="workflow-runs-table"]';
    this.runsHttpFilter = '[data-test="workflow-runs-trigger-filter-http_request"]';
    this.runsSearch = '[data-test="workflow-runs-search-field"]';
  }

  // ---------- API seeding ----------

  /** A published (or draft) Trigger -> Destination workflow; returns { id, name }. */
  async seedWorkflow({ name, kind = 'alert_fired', draft = false }) {
    const destName = await seed.createPipelineDestination(this.page, `${name}_dest`);
    return await seed.createWorkflow(this.page, { name, destName, draft, triggerKind: kind });
  }

  async deleteWorkflow(id) {
    await seed.deleteWorkflow(this.page, id).catch(() => {});
  }

  async deleteDestination(name) {
    await seed.deleteDestination(this.page, `${name}_dest`).catch(() => {});
  }

  /** Turn the endpoint on over REST; the 201 body carries the new token once as `secret`. */
  async enableEndpointApi(id, authMode = 'token') {
    const resp = await this.page.request.put(triggerUrl(id), {
      headers: getAuthHeaders(),
      data: { enabled: true, auth_mode: authMode },
    });
    if (!resp.ok()) throw new Error(`enable endpoint: ${resp.status()} ${(await resp.text()).slice(0, 300)}`);
    return await resp.json();
  }

  async getEndpointApi(id) {
    const resp = await this.page.request.get(triggerUrl(id), { headers: getAuthHeaders() });
    return { status: resp.status(), body: await resp.json().catch(() => null) };
  }

  async revealSecretApi(id, credentialId) {
    const resp = await this.page.request.get(`${triggerUrl(id)}/credentials/${credentialId}/secret`, {
      headers: getAuthHeaders(),
    });
    if (!resp.ok()) throw new Error(`reveal secret: ${resp.status()}`);
    return (await resp.json()).secret;
  }

  /** The active credential's id and value, read through the API the panel uses. */
  async activeSecret(id) {
    const { body } = await this.getEndpointApi(id);
    const active = body.credentials.find((c) => c.state === 'active');
    return { id: active.id, secret: await this.revealSecretApi(id, active.id), url: body.url };
  }

  /** POST to the public hook URL with plain fetch, so no browser cookie reaches the hook route. */
  async invokeHook(url, { token, body = { service: 'checkout', deploy_id: 'd-4821' }, headers = {}, dryRun = false } = {}) {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (dryRun) h['X-O2-Dry-Run'] = 'true';
    const resp = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_e) {
      json = null;
    }
    return { status: resp.status, body: json };
  }

  /** Wait until the once-a-minute merge has recorded `reason` for this endpoint. */
  async waitForRejection(id, reason) {
    await expect
      .poll(async () => Boolean((await this.getEndpointApi(id)).body?.rejections?.[reason]), {
        timeout: REJECTION_MERGE_TIMEOUT_MS,
        intervals: [5000],
        message: `rejection "${reason}" never merged`,
      })
      .toBe(true);
  }

  async waitForHttpRun(workflowId, runId) {
    await expect
      .poll(
        async () => {
          const now = Date.now() * 1000;
          const resp = await this.page.request.get(
            `${api()}/${getOrgIdentifier()}/workflows/${workflowId}/history?start_time=${now - 3600e6}&end_time=${now + 60e6}`,
            { headers: getAuthHeaders() }
          );
          const rows = resp.ok() ? await resp.json() : [];
          return rows.some((r) => r.run_id === runId && r.status !== 'queued' && r.status !== 'running');
        },
        { timeout: 60000, intervals: [2000], message: `HTTP run ${runId} never finished` }
      )
      .toBe(true);
  }

  // ---------- panel ----------

  async grantClipboard() {
    await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(process.env.ZO_BASE_URL).origin,
    });
  }

  async clipboardText() {
    return await this.page.evaluate(() => navigator.clipboard.readText());
  }

  async openFromEditor() {
    await this.page.locator(this.editorButton).click({ timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.panel).waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  }

  async openFromList(name) {
    await this.page.locator(this.listMore(name)).first().click({ timeout: LIST_TIMEOUT_MS });
    await this.page.locator(this.listMenuPanel(name)).first().click({ timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.panel).waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  }

  async copyUrlFromList(name) {
    await this.page.locator(this.listMore(name)).first().click({ timeout: LIST_TIMEOUT_MS });
    await this.page.locator(this.listMenuCopy(name)).first().click({ timeout: PANEL_TIMEOUT_MS });
  }

  async closePanel() {
    await this.page.locator(this.panelClose).click({ timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.panel).waitFor({ state: 'hidden', timeout: PANEL_TIMEOUT_MS });
  }

  async panelText() {
    return (await this.page.locator(this.panel).innerText()).replace(/\s+/g, ' ');
  }

  async turnOn() {
    await this.page.locator(this.toggle).click({ timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.reveal).waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  }

  async tokenOnScreen() {
    return ((await this.page.locator(this.tokenPre).innerText()) || '').trim();
  }

  async revealToken() {
    await this.page.locator(this.tokenReveal).click({ timeout: PANEL_TIMEOUT_MS });
  }

  async copyToken() {
    await this.page.locator(this.tokenCopy).click({ timeout: PANEL_TIMEOUT_MS });
  }

  async urlOnScreen() {
    return ((await this.page.locator(this.url).innerText()) || '').trim();
  }

  /** Send test request (dry run) and return the result box text. */
  async sendDryRun() {
    await this.page.locator(this.sendTest).click({ timeout: PANEL_TIMEOUT_MS });
    const box = this.page.locator(this.testResult);
    await box.waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
    return (await box.innerText()).replace(/\s+/g, ' ');
  }

  async finishReveal() {
    await this.page.locator(this.revealDone).click({ timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.steady).waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  }

  async rotateWithOverlap(seconds) {
    await this.page.locator(this.rotate).click({ timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.rotatePopover).waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.rotateOverlap(seconds)).click({ timeout: PANEL_TIMEOUT_MS });
    const consequence = (await this.page.locator(this.rotateConsequence).innerText()).trim();
    await this.page.locator(this.rotateConfirm).click({ timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.retiringRow).waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
    return consequence;
  }

  async revokeCredential(credentialId) {
    await this.page.locator(this.credRevoke(credentialId)).click({ timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.credRevokeConfirm(credentialId)).click({ timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.credRevoke(credentialId)).waitFor({ state: 'detached', timeout: PANEL_TIMEOUT_MS });
  }

  async showRejections() {
    await this.page.locator(this.rejectionsLine).waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.rejectionsShow).click({ timeout: PANEL_TIMEOUT_MS });
    await this.page.locator(this.rejections).waitFor({ state: 'visible', timeout: PANEL_TIMEOUT_MS });
  }

  // ---------- runs ----------

  async goToRuns(workflowId) {
    const url = `${process.env.ZO_BASE_URL}/web/workflows/runs?id=${workflowId}&org_identifier=${getOrgIdentifier()}`;
    await this.page.goto(url, { timeout: 60000 });
    await this.page.locator(this.runsTable).first().waitFor({ state: 'visible', timeout: LIST_TIMEOUT_MS });
  }

  async filterRunsToHttp() {
    await this.page.locator(this.runsHttpFilter).first().click({ timeout: PANEL_TIMEOUT_MS });
  }

  async runsTableText() {
    return (await this.page.locator(this.runsTable).first().innerText()).replace(/\s+/g, ' ');
  }
}

module.exports = WorkflowHttpPage;
