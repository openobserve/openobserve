// Workflows HTTP endpoint RBAC (HTTP-08): a viewer sees the endpoint read-only; needs OpenFGA to enforce it.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const crypto = require('crypto');

// The suffix ends up in the viewer password, so it must not come from Math.random.
const uniq = () => `${Date.now().toString(36).slice(-5)}${crypto.randomBytes(2).toString('hex').slice(0, 3)}`;

test.describe(
  'Workflows HTTP endpoint RBAC',
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
        if (id) await http.deleteWorkflow(id);
        else await http.deleteWorkflowNamed(name);
        await http.deleteDestination(name);
      }
    });

    const seeded = async (opts) => {
      const wf = await http.seedWorkflow(opts);
      cleanup.push(wf);
      return wf;
    };

    test('HTTP-08: a viewer sees the endpoint read-only', async ({ browser }) => {
      const wf = await seeded({ name: `wf_auto_http_v_${uniq()}` });
      await http.enableEndpointApi(wf.id);
      const { email, password } = await http.createViewer(uniq());
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      try {
        const vp = await http.loginInContext(ctx, email, password);
        const vpm = new PageManager(vp);
        const vhttp = vpm.workflowHttpPage;
        await vpm.workflowsPage.goToList();
        await vpm.workflowsPage.search(wf.name);
        await vhttp.openFromList(wf.name);
        await vp.locator(vhttp.steady).waitFor({ state: 'visible', timeout: 25000 });
        await expect(vp.locator(vhttp.toggle)).toBeDisabled();
        await expect(vp.locator(vhttp.rotate)).toHaveCount(0);
        await expect(vp.locator(vhttp.advanced)).toHaveCount(0);
        await expect(vp.locator(vhttp.credentialShowAny)).toHaveCount(0);
        await expect(vp.locator(vhttp.credentialRevokeAny)).toHaveCount(0);
        await expect(vp.locator(vhttp.url)).toBeVisible();
      } finally {
        await ctx.close();
        await http.deleteUser(email);
      }
    });
  }
);
