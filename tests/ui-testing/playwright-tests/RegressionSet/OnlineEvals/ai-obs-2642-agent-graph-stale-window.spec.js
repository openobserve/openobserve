// ENT#2642: an agent list answered late for an older time range must not replace the list for the range the user picked.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { AiAgentScopePage } = require('../../../pages/onlineEvalsPages/aiAgentScopePage.js');
const { orgIdentifier, isEnterpriseBuild, genAiAgentRecord } = require('../../utils/ai-obs-seed-api.js');

test.describe('Agent Graph keeps the latest window\'s agents (ENT#2642)', { tag: ['@aiObservability', '@regression', '@P2', '@enterprise'] }, () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!(await isEnterpriseBuild()), 'AI observability is enterprise-only');
    await navigateToBase(page);
  });

  test('a late answer for the old range does not overwrite the new range\'s agents', async ({ page }) => {
    const stamp = `${Date.now()}`;
    const stale = genAiAgentRecord(`ovnc_stale_${stamp}`, `staleenv${stamp}`);
    const fresh = genAiAgentRecord(`ovnc_fresh_${stamp}`, `freshenv${stamp}`);
    let release;
    const held = new Promise((r) => { release = r; });
    const windows = [];
    let heldRequest = null;
    await page.route(/\/api\/[^/]+\/gen_ai\/agents(\?|$)/, async (route) => {
      const url = new URL(route.request().url());
      windows.push(`${url.searchParams.get('start_time')}-${url.searchParams.get('end_time')}`);
      if (windows.length === 1) {
        heldRequest = route.request();
        await held;
        return route.fulfill({ json: { agents: [stale], total: 1 } });
      }
      return route.fulfill({ json: { agents: [fresh], total: 1 } });
    });

    const scope = new AiAgentScopePage(page);
    await scope.gotoView('agent-graph', { org: orgIdentifier(), type: 'agent' });
    await expect.poll(() => windows.length, { timeout: 30000 }).toBe(1);

    await new PageManager(page).dateTimePickerPage.pickRelativePeriodAndClose('1-h');
    await expect.poll(() => windows.length, { timeout: 30000, message: 'the new range must ask for its own agents' }).toBeGreaterThan(1);
    expect(new Set(windows).size, 'the two requests cover different windows').toBeGreaterThan(1);

    const agentSel = scope.agentSelection('agent-graph');
    await expect(agentSel).toHaveAttribute('data-test-selected-value', fresh.name, { timeout: 30000 });

    const staleAnswered = page.waitForResponse((r) => r.request() === heldRequest, { timeout: 15000 });
    release();
    await staleAnswered;
    // the stale list lands in a later tick than the response event
    await page.waitForTimeout(1500);
    await expect(agentSel, 'the stale answer must not take over').toHaveAttribute('data-test-selected-value', fresh.name);
    await expect(scope.envSelection('agent-graph')).toHaveAttribute('data-test-selected-value', fresh.env);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
