// Workflows HTTP endpoint (HTTP-01..08): panel from the editor and the list, reveal, dry run, drafts, rotate, rejections, runs, viewer.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
const seed = require('../../pages/workflowsPages/workflowFolderSeed.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
const MASK = '•';

test.describe(
  'Workflows HTTP endpoint',
  { tag: ['@workflows', '@workflowsHttp', '@enterprise', '@all'] },
  () => {
    let pm;
    let http;
    const cleanup = [];

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
      http = pm.workflowHttpPage;
      await pm.workflowsPage.assertEnabled();
      await http.grantClipboard();
    });

    test.afterEach(async () => {
      while (cleanup.length) {
        const { id, name } = cleanup.pop();
        await http.deleteWorkflow(id);
        await http.deleteDestination(name);
      }
    });

    const seeded = async (opts) => {
      const wf = await http.seedWorkflow(opts);
      cleanup.push(wf);
      return wf;
    };

    test('HTTP-01: alert workflow gets an endpoint from the editor header, reveal, copy and dry run', async ({ page }) => {
      const wf = await seeded({ name: `wf_auto_http_a_${uniq()}` });
      await pm.workflowsPage.goToList();
      await pm.workflowsPage.openEdit(wf.name);

      await expect(page.locator(http.editorButton)).toBeVisible();
      await expect(page.locator(http.editorChip)).toHaveCount(0);
      await expect(page.locator(http.nodeBadge)).toHaveCount(0);

      await http.openFromEditor();
      await expect(page.locator(http.kindNote)).toContainText('Alert Fired');
      expect(await http.panelText()).toContain(wf.name);

      await http.turnOn();
      const { secret, url } = await http.activeSecret(wf.id);
      const masked = await http.tokenOnScreen();
      expect(masked).toContain(MASK);
      expect(masked).not.toContain(secret);
      expect(await http.urlOnScreen()).toContain(url);

      await http.revealToken();
      await expect.poll(() => http.tokenOnScreen()).toBe(secret);
      await http.copyToken();
      await expect.poll(() => http.clipboardText()).toBe(secret);

      const result = await http.sendDryRun();
      expect(result).toContain('200');
      await expect(page.locator(http.testInput)).toContainText('"trigger_source": "http"');

      await http.finishReveal();
      await http.closePanel();
      await expect(page.locator(http.editorChip)).toBeVisible();
      await expect(page.locator(http.nodeBadge)).toBeVisible();

      // The dry run never started a run, so the endpoint still has no last call.
      const { body } = await http.getEndpointApi(wf.id);
      expect(body.last_call).toBeNull();
      testLogger.info('endpoint created from the editor', { id: wf.id });
    });

    test('HTTP-02: incident workflow gets an endpoint from the list row menu', async ({ page }) => {
      const wf = await seeded({ name: `wf_auto_http_i_${uniq()}`, kind: 'incident_event' });
      await pm.workflowsPage.goToList();
      await pm.workflowsPage.search(wf.name);
      await pm.workflowsPage.rowByName(wf.name).first().waitFor({ state: 'visible', timeout: 45000 });
      await expect(page.locator(http.listHttpTag)).toHaveCount(0);

      await http.openFromList(wf.name);
      await expect(page.locator(http.kindNote)).toContainText('Incident Event');
      expect(await http.panelText()).toContain('Incident Event workflow');
      await http.turnOn();
      await http.finishReveal();
      await expect(page.locator(http.runTest)).toHaveCount(0);
      await http.closePanel();

      await pm.workflowsPage.refreshList();
      await pm.workflowsPage.search(wf.name);
      await expect(page.locator(http.listHttpTag).first()).toBeVisible();

      await pm.workflowsPage.openEdit(wf.name);
      await expect(page.locator(http.editorChip)).toBeVisible();
      await expect(page.locator(http.nodeBadge)).toBeVisible();
      await page.locator(http.nodeBadge).click();
      await page.locator(http.steady).waitFor({ state: 'visible', timeout: 25000 });
    });

    test('HTTP-03: unsaved workflow saves a draft with its endpoint, is refused until published', async ({ page }) => {
      const id = uniq();
      const name = `wf_auto_http_d_${id}`;
      const destName = await seed.createPipelineDestination(page, `${name}_dest`);
      await pm.workflowsPage.goToAdd('alert_fired');
      await pm.workflowsPage.setName(name);
      await pm.workflowsPage.addNodeFromPalette('destination');
      await pm.workflowsPage.pickExistingDestination(destName);
      await pm.workflowsPage.saveNodeDrawer();

      await http.openFromEditor();
      await expect(page.locator(http.toggle)).toHaveCount(0);
      await page.locator(http.saveAndCreate).click();
      await page.locator(http.reveal).waitFor({ state: 'visible', timeout: 25000 });
      await expect(page.locator(http.draftBanner)).toBeVisible();
      await expect(page.locator(http.sendTestHint)).toContainText('Drafts refuse the call');

      const result = await http.sendDryRun();
      expect(result).toContain('403');
      expect(result).toContain('Credentials valid');
      await expect(page.locator(http.runTestInstead)).toBeVisible();

      await http.finishReveal();
      await http.closePanel();
      await expect(page.locator(http.editorChip)).toBeVisible();
      await pm.workflowsPage.expectDraftTagInEditor();

      const rows = await seed.listWorkflows(page);
      const draft = rows.find((r) => r.name === name);
      expect(draft, 'draft row saved with the endpoint').toBeTruthy();
      cleanup.push({ id: draft.id, name });
      const { secret, url } = await http.activeSecret(draft.id);
      expect((await http.invokeHook(url, { token: secret })).status).toBe(403);

      await pm.workflowsPage.publishAndExpectAccepted();
      await pm.workflowsPage.skipLinkAlerts();
      await pm.workflowsPage.goToList();
      expect(await pm.workflowsPage.isPresent(name)).toBeTruthy();
      await expect(page.locator(http.listHttpTag).first()).toBeVisible();

      const published = await http.invokeHook(url, { token: secret });
      expect(published.status).toBe(202);
      testLogger.info('draft endpoint answers 202 after publish', { run: published.body?.run_id });
    });

    test('HTTP-04: rotate keeps the old token for the overlap, revoke ends it', async ({ page }) => {
      const wf = await seeded({ name: `wf_auto_http_r_${uniq()}` });
      await http.enableEndpointApi(wf.id);
      const old = await http.activeSecret(wf.id);
      await pm.workflowsPage.goToList();
      await pm.workflowsPage.openEdit(wf.name);
      await http.openFromEditor();
      await page.locator(http.steady).waitFor({ state: 'visible', timeout: 25000 });

      const consequence = await http.rotateWithOverlap(3600);
      expect(consequence.length).toBeGreaterThan(0);
      await expect(page.locator(http.revealBanner)).toBeVisible();
      await expect(page.locator(http.rotate)).toHaveAttribute('aria-disabled', 'true');
      await page.locator(http.rotate).hover();
      await expect(page.locator(http.tooltip).filter({ hasText: 'Revoke the retiring' })).toBeVisible();

      // Both tokens stay viewable from their rows while the old one retires.
      await page.locator(http.credShow(old.id)).click();
      await expect(page.locator(http.credValue(old.id))).toContainText(old.secret);

      const fresh = await http.activeSecret(wf.id);
      expect(fresh.secret).not.toBe(old.secret);
      expect((await http.invokeHook(old.url, { token: old.secret, dryRun: true })).status).toBe(200);
      expect((await http.invokeHook(old.url, { token: fresh.secret, dryRun: true })).status).toBe(200);

      await http.revokeCredential(old.id);
      await expect(page.locator(http.retiringRow)).toHaveCount(0);
      expect((await http.invokeHook(old.url, { token: old.secret, dryRun: true })).status).toBe(401);
      expect((await http.invokeHook(old.url, { token: fresh.secret, dryRun: true })).status).toBe(200);
      await expect(page.locator(http.rotate)).not.toHaveAttribute('aria-disabled', 'true');
    });

    test('HTTP-05: rejected calls show their reasons in the panel', async ({ page }) => {
      test.setTimeout(5 * 60 * 1000);
      const wf = await seeded({ name: `wf_auto_http_x_${uniq()}` });
      const view = await http.enableEndpointApi(wf.id);
      expect((await http.invokeHook(view.url, { token: 'o2wh_not_a_real_token' })).status).toBe(401);
      const inUrl = await http.invokeHook(`${view.url}?token=${view.secret}`, { token: view.secret });
      expect(inUrl.status).toBe(400);
      expect(inUrl.body?.error_detail).toBe('credential_in_url');
      await http.waitForRejection(wf.id, 'invalid_token');
      await http.waitForRejection(wf.id, 'credential_in_url');

      await pm.workflowsPage.goToList();
      await pm.workflowsPage.openEdit(wf.name);
      await http.openFromEditor();
      await http.showRejections();
      await expect(page.locator(http.rejectionRow('invalid_token'))).toBeVisible();
      await expect(page.locator(http.rejectionRow('credential_in_url'))).toBeVisible();
    });

    test('HTTP-06: list row carries the HTTP tag and copies the endpoint URL', async ({ page }) => {
      const wf = await seeded({ name: `wf_auto_http_l_${uniq()}` });
      const view = await http.enableEndpointApi(wf.id);
      await pm.workflowsPage.goToList();
      await pm.workflowsPage.search(wf.name);
      await pm.workflowsPage.rowByName(wf.name).first().waitFor({ state: 'visible', timeout: 45000 });
      await expect(page.locator(http.listHttpTag).first()).toBeVisible();

      await http.copyUrlFromList(wf.name);
      await expect.poll(() => http.clipboardText()).toBe(view.url);

      await http.openFromList(wf.name);
      await page.locator(http.steady).waitFor({ state: 'visible', timeout: 25000 });
      await expect(page.locator('[data-test="workflow-http-run-test-list-hint"]')).toBeVisible();
    });

    test('HTTP-07: an HTTP-sourced run shows in the runs view under the HTTP filter', async ({ page }) => {
      const wf = await seeded({ name: `wf_auto_http_h_${uniq()}` });
      const view = await http.enableEndpointApi(wf.id);
      const key = `wf-auto-${uniq()}`;
      const call = await http.invokeHook(view.url, { token: view.secret, headers: { 'Idempotency-Key': key } });
      expect(call.status).toBe(202);
      const runId = call.body.run_id;
      await http.waitForHttpRun(wf.id, runId);

      await http.goToRuns(wf.id);
      await expect.poll(() => http.runsTableText(), { timeout: 30000 }).toContain('HTTP request');
      await http.filterRunsToHttp();
      await expect.poll(() => http.runsTableText(), { timeout: 30000 }).toContain(key);
      expect(await http.runsTableText()).toContain(runId.slice(0, 8));
    });

    test('HTTP-08: a viewer sees the endpoint read-only', async ({ page, browser }) => {
      const wf = await seeded({ name: `wf_auto_http_v_${uniq()}` });
      await http.enableEndpointApi(wf.id);
      const email = `wf_auto_viewer_${uniq()}@example.com`;
      const password = `Vw#${uniq()}Pass2026!`;
      const users = `${process.env.ZO_BASE_URL}/api/${getOrgIdentifier()}/users`;
      const created = await page.request.post(users, {
        headers: getAuthHeaders(),
        data: { email, password, role: 'viewer', first_name: 'wf', last_name: 'viewer' },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      try {
        const vp = await ctx.newPage();
        await vp.goto(`${process.env.ZO_BASE_URL}/web/login?org_identifier=${getOrgIdentifier()}`);
        const internal = vp.locator('[data-test="login-as-internal-user"]');
        if (await internal.isVisible().catch(() => false)) await internal.click();
        await vp.locator('[data-test="login-user-id-field"]').fill(email);
        await vp.locator('[data-test="login-password-field"]').fill(password);
        await vp.locator('[data-test="login-sign-in"]').click();
        await vp.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 });

        const vpm = new PageManager(vp);
        const vhttp = vpm.workflowHttpPage;
        await vpm.workflowsPage.goToList();
        await vpm.workflowsPage.search(wf.name);
        await vhttp.openFromList(wf.name);
        await vp.locator(vhttp.steady).waitFor({ state: 'visible', timeout: 25000 });
        await expect(vp.locator(vhttp.toggle)).toBeDisabled();
        await expect(vp.locator(vhttp.rotate)).toHaveCount(0);
        await expect(vp.locator(vhttp.advanced)).toHaveCount(0);
        await expect(vp.locator(`${vhttp.credentials} [data-test$="-show"]`)).toHaveCount(0);
        await expect(vp.locator(`${vhttp.credentials} [data-test$="-revoke"]`)).toHaveCount(0);
        await expect(vp.locator(vhttp.url)).toBeVisible();
      } finally {
        await ctx.close();
        await page.request.delete(`${users}/${encodeURIComponent(email)}`, { headers: getAuthHeaders() });
      }
    });
  }
);
