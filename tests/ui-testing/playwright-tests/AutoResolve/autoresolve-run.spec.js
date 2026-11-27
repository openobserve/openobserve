// A person runs an AutoResolve end to end on a real enterprise server; the agent is tests/api-testing/helpers/autoresolve_agent_mock.py.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const AutoResolvePage = require('../../pages/autoresolvePages/autoresolvePage.js');
const { uniqueSuffix: uniq } = require('../utils/unique-suffix.js');

test.describe('AutoResolve person run', { tag: ['@autoresolve', '@enterprise'] }, () => {
  let autoresolve;
  let connectionId;
  let savedId;

  let otherConnectionId;

  test.afterEach(async ({ request }) => {
    if (savedId) await autoresolve.deleteSaved(request, savedId);
    if (connectionId) await autoresolve.deleteConnection(request, connectionId);
    if (otherConnectionId) await autoresolve.deleteConnection(request, otherConnectionId);
    savedId = undefined;
    connectionId = undefined;
    otherConnectionId = undefined;
  });

  test('a person runs an AutoResolve end to end', async ({ page, request }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    autoresolve = new AutoResolvePage(page);
    const id = uniq();
    const goal = `Checkout error rate is above its threshold; bring it down (${id})`;
    const connectionName = `pw-autoresolve-${id}`;
    connectionId = await autoresolve.createConnection(request, connectionName);
    await navigateToBase(page);

    await autoresolve.expectMenuEntry();
    await expect(autoresolve.menuItem.locator('[data-test="alpha-badge"]')).toBeVisible();
    const items = await autoresolve.flyoutItemIds();
    expect(items.indexOf('nav-group-item-autoresolve'), items.join(', ')).toBe(
      items.indexOf('nav-group-item-incidentList') + 1,
    );
    await autoresolve.openFromMenu();

    await autoresolve.chooseConnection(connectionName);
    await autoresolve.startRun(goal);
    await expect(autoresolve.options).toHaveCount(2);
    await expect(autoresolve.recommendedTag('A')).toBeVisible();
    await expect(autoresolve.recommendedTag('B')).toHaveCount(0);
    await autoresolve.approve('B');

    await autoresolve.expectOutcome('worked');
    await autoresolve.expectStepsDone(1);

    await autoresolve.openRunsTab();
    const row = autoresolve.runRow(goal);
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(autoresolve.runPage).toBeVisible();
    await expect(autoresolve.steps).toContainText(process.env.ZO_ROOT_USER_EMAIL);
  });

  test('a person saves a finished run as an AutoResolve and runs it from its page', async ({
    page,
    request,
  }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    autoresolve = new AutoResolvePage(page);
    const id = uniq();
    const goal = `Checkout latency is above its threshold; bring it down (${id})`;
    const connectionName = `pw-autoresolve-${id}`;
    connectionId = await autoresolve.createConnection(request, connectionName);
    await navigateToBase(page);

    await autoresolve.expectMenuEntry();
    await autoresolve.openFromMenu();
    await autoresolve.chooseConnection(connectionName);
    await autoresolve.startRun(goal);
    await autoresolve.approve('B');
    await autoresolve.expectOutcome('worked');
    const sourceRunId = await autoresolve.currentRunId();

    savedId = await autoresolve.saveAsAutoResolve();
    const saved = await autoresolve.getSaved(request, savedId);
    expect(saved.goal).toBe(goal);
    expect(saved.trigger.kind).toBe('person');
    expect(saved.from_run_id).toBe(sourceRunId);
    expect(saved.connections.map((c) => c.id)).toEqual([connectionId]);

    const runId = await autoresolve.runNow();
    expect(runId).not.toBe(sourceRunId);

    await autoresolve.openSaved(savedId);
    await expect(autoresolve.lastRunsRows).toHaveCount(1);
    await autoresolve.lastRunsRows.first().click();
    await expect(autoresolve.runPage).toBeVisible();
    expect(await autoresolve.currentRunId()).toBe(runId);
  });

  test('a person corrects a plan, sees the new plan use it and removes it from the AutoResolve', async ({
    page,
    request,
  }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    autoresolve = new AutoResolvePage(page);
    const id = uniq();
    connectionId = await autoresolve.createConnection(request, `pw-autoresolve-${id}`);
    savedId = await autoresolve.createSaved(request, {
      name: `Orders are backing up ${id}`,
      goal: `Orders are backing up; find the cause and fix it (${id})`,
      connectionIds: [connectionId],
    });
    await navigateToBase(page);
    await autoresolve.openSaved(savedId);
    const runId = await autoresolve.runNow();
    await expect(autoresolve.options).toHaveCount(2);

    const note = `Only the checkout service is wrong (${id})`;
    await autoresolve.correctPlan('wrong_fix', note);
    await expect(autoresolve.correctionsUsed).toBeVisible({ timeout: 60000 });
    await expect(autoresolve.correctionsUsed).toContainText('1');
    await expect(autoresolve.options).toHaveCount(1);
    await expect(autoresolve.correctionPanel).toHaveCount(0);
    await expect(autoresolve.approveButton).toBeVisible();
    const plans = await autoresolve.agentTurns(request, runId, 'plan');
    expect(plans.at(-1).corrections).toEqual([{ kind: 'wrong_fix', note, this_run: true }]);

    await autoresolve.correctionsUsed.click();
    await autoresolve.correctionsUsedManage.click();
    await expect(autoresolve.savedDetails).toBeVisible();
    await expect(autoresolve.savedCorrectionRows).toHaveCount(1);
    await expect(autoresolve.savedCorrectionRows.first()).toContainText(note);
    await autoresolve.savedCorrectionRemove.first().click();
    await expect(autoresolve.savedCorrections).toHaveCount(0);
  });

  test('a fix that needs a connection the AutoResolve lacks adds it and plans again with both', async ({
    page,
    request,
  }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    autoresolve = new AutoResolvePage(page);
    const id = uniq();
    const onAutoResolve = `pw-autoresolve-${id}`;
    const needed = `pw-autoresolve-${id}-pg`;
    connectionId = await autoresolve.createConnection(request, onAutoResolve);
    otherConnectionId = await autoresolve.createConnection(request, needed);
    savedId = await autoresolve.createSaved(request, {
      name: `Checkout is slow ${id}`,
      goal: `Checkout is slow; find the cause and fix it [af-needs:${needed}] (${id})`,
      connectionIds: [connectionId],
    });
    await navigateToBase(page);
    await autoresolve.openSaved(savedId);
    const runId = await autoresolve.runNow();

    await expect(autoresolve.missingConnection).toContainText(needed);
    await expect(autoresolve.partialFixTags).toHaveCount(1);
    await expect(autoresolve.recommendedTags).toHaveCount(0);
    await autoresolve.missingConnectionAdd.click();
    await expect(autoresolve.addConnectionDialog).toBeVisible();
    await autoresolve.addConnectionConfirm.click();

    await expect(autoresolve.missingConnection).toHaveCount(0, { timeout: 60000 });
    await expect
      .poll(async () => (await autoresolve.agentTurns(request, runId, 'plan')).length, { timeout: 60000 })
      .toBe(2);
    const plans = await autoresolve.agentTurns(request, runId, 'plan');
    expect([...plans[1].mcps].sort()).toEqual([needed, onAutoResolve].sort());
    await expect(autoresolve.options).toHaveCount(1, { timeout: 60000 });
    await expect(autoresolve.partialFixTags).toHaveCount(0);
    const saved = await autoresolve.getSaved(request, savedId);
    expect(saved.connections.map((c) => c.id).sort()).toEqual([connectionId, otherConnectionId].sort());
  });

  test('a person says a fix did not work and the run plans again beside both verdicts', async ({
    page,
    request,
  }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    autoresolve = new AutoResolvePage(page);
    const id = uniq();
    const connectionName = `pw-autoresolve-${id}`;
    connectionId = await autoresolve.createConnection(request, connectionName);
    await navigateToBase(page);
    await autoresolve.expectMenuEntry();
    await autoresolve.openFromMenu();
    await autoresolve.chooseConnection(connectionName);
    await autoresolve.startRun(`Checkout errors are above their threshold; bring them down (${id})`);
    await autoresolve.approve('B');
    await autoresolve.expectOutcome('worked');
    const runId = await autoresolve.currentRunId();

    await autoresolve.verdictNo.click();
    await expect(autoresolve.rememberCheckbox).toHaveCount(0);
    const note = `Errors are still above the threshold (${id})`;
    await autoresolve.verdictNote.fill(note);
    await autoresolve.verdictPlanAgain.click();

    await expect(autoresolve.personVerdict).toHaveAttribute('data-verdict', 'not_fixed', { timeout: 60000 });
    await expect(autoresolve.agentVerdict).toContainText('Worked');
    await expect(autoresolve.options).toHaveCount(1, { timeout: 60000 });
    await expect(autoresolve.personVerdict).toContainText(note);
    const plans = await autoresolve.agentTurns(request, runId, 'plan');
    expect(plans.at(-1).corrections[0]).toEqual({ kind: 'not_fixed', note, this_run: true });
  });
});
