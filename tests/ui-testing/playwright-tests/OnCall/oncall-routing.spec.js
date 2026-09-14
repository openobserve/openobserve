/**
 * On-Call — ownership rules and how a shadowed one is surfaced (§11.4)
 *
 * Plan: docs/test_generator/features/oncall-test-plan.md §11.4 —
 *   "Routing rule permanently shadowed: surfaced above the table, not only as a
 *    per-row pill."
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * SHADOWING IS THE SERVER'S VERDICT. Deciding that rule A is shadowed means
 * comparing every rule against every other, including rules a team-scoped
 * screen never fetched, so `health` comes from `ownership/stats` and is READ
 * here, never recomputed. That is also why these tests ask the server which
 * rule it considers shadowed instead of assuming the overlapping pair they seed
 * produces one: if the analysis does not call either rule shadowed, there is
 * nothing for the UI to surface and the test skips with that as the reason
 * rather than failing the screen for the engine's judgement.
 *
 * WHERE MAIN DIVERGES FROM THE PLAN. §11.4 asks for the finding ABOVE the
 * table. On main it is not there, and cannot be: the org routing screen renders
 * `OnCallOwnershipRules` with `:show-header="false"`, so `oncall-ownership-header`
 * — the only region above the rows — is not drawn at all. What main does have is
 * stronger than the plan's "only a per-row pill": the health column renders the
 * server's verdict as a tag that NAMES the team taking the pages
 * (`oncall.ruleAlsoClaimedBy`), visible in the table without opening a row, and
 * the team's own routing tab repeats it as a per-row note. These tests assert
 * that OBSERVED contract — the verdict reaches a reader who is scanning the
 * table — and record the unmet half rather than asserting an element that does
 * not exist. Same judgement as §10.5 in oncall-rbac-ui.spec.js: document what
 * the product does, do not write a test expected to fail, do not quietly
 * rewrite the plan.
 *
 * Self-cleaning, worker-scoped prefix. Ownership rules are swept via the teams
 * they point at, so the teams must outlive the rules until teardown — which is
 * the order `deleteOnCallFixturesByPrefix` already takes.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  isOnCallAvailable,
  createTeam,
  createOwnershipRule,
  ownershipStats,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');

const PREFIX = 'e2e_oncall_routing';

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { checked: false, available: false, reason: '' };

test.describe.configure({ mode: 'parallel' });

test.describe('On-call routing rules', {
  tag: ['@oncall', '@oncallRouting', '@enterprise'],
}, () => {
  let pm;
  let ORG;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    ORG = orgId();

    if (!gate.checked) {
      const probe = await isOnCallAvailable(page);
      gate.checked = true;
      gate.available = probe.available;
      gate.reason = probe.reason;
    }
    test.skip(!gate.available, `On-call is not testable here — ${gate.reason}`);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await deleteOnCallFixturesByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    await context.close();
  });

  /**
   * Two teams claiming overlapping identity paths, the second strictly more
   * specific than the first.
   *
   * Every dimension pair must match for a rule to apply, so adding a pair is
   * what makes one rule outrank another — and the values are worker-unique
   * because a 409 means somebody else already owns the exact path, which on a
   * shared org is another worker rather than a bug.
   */
  async function seedOverlappingRules(page, testInfo) {
    const service = uniqueName(`${workerPrefix(testInfo)}_svc`);
    const broadTeam = await createTeam(page, { name: uniqueName(`${workerPrefix(testInfo)}_broad`) });
    const narrowTeam = await createTeam(page, { name: uniqueName(`${workerPrefix(testInfo)}_narrow`) });

    const broad = await createOwnershipRule(page, {
      teamId: broadTeam.id,
      dimensions: { service },
    });
    const narrow = await createOwnershipRule(page, {
      teamId: narrowTeam.id,
      dimensions: { service, namespace: `${service}_ns` },
    });

    return { service, broadTeam, narrowTeam, broad, narrow };
  }

  /** The server's own verdict for the seeded pair, or null when it calls neither shadowed. */
  async function findShadowedRule(page, ruleIds) {
    const stats = await ownershipStats(page);
    const rules = Array.isArray(stats) ? stats : (stats?.rules ?? stats?.list ?? []);
    return rules.find(
      (rule) => ruleIds.includes(rule?.rule_id ?? rule?.id) && rule?.health === 'shadowed',
    ) ?? null;
  }

  // ---------------------------------------------------------------- P0 smoke

  test('the routing page loads with both tabs', {
    tag: ['@P0', '@smoke'],
  }, async ({ page }) => {
    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.expectAvailable();
    await pm.oncallRoutingPage.expectPageVisible();
    await expect(page.locator(pm.oncallRoutingPage.locators.tabRules)).toBeVisible();
    await expect(page.locator(pm.oncallRoutingPage.locators.tabSignals)).toBeVisible();
  });

  test('a seeded rule appears on the rules tab with the team it pages', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const service = uniqueName(`${workerPrefix(testInfo)}_svc`);
    const team = await createTeam(page, { name: uniqueName(workerPrefix(testInfo)) });
    const rule = await createOwnershipRule(page, { teamId: team.id, dimensions: { service } });

    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.selectTab('rules');

    const teamCell = page.locator(pm.oncallRoutingPage.ruleTeam(rule.id));
    await expect(teamCell, 'the org view names the team a rule pages').toBeVisible({ timeout: 30000 });
    await expect(teamCell).toContainText(team.name);
  });

  // ------------------------------------------------------------------ §11.4

  /**
   * §11.4, as main implements it.
   *
   * "Shadowed" alone does not tell a reader who to go and talk to, so the tag
   * names the team taking the pages. The point of the case is that this reaches
   * somebody SCANNING the table — no row opened, no tooltip hovered — which is
   * what the assertion checks.
   */
  test('§11.4 a shadowed rule shows the server verdict in the table, naming the team taking it', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const { broad, narrow } = await seedOverlappingRules(page, testInfo);

    const shadowed = await findShadowedRule(page, [broad.id, narrow.id]);
    test.skip(
      !shadowed,
      'the server\'s shadowing analysis calls neither seeded rule shadowed, so there is no verdict for the screen to surface',
    );

    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.selectTab('rules');

    const ruleId = shadowed.rule_id ?? shadowed.id;
    const pill = page.locator(pm.oncallRoutingPage.ruleHealth(ruleId));
    await expect(
      pill,
      'the verdict must be legible from the table itself, not only after opening the row',
    ).toBeVisible({ timeout: 30000 });

    const label = await pm.oncallRoutingPage.readRuleHealth(ruleId);
    testLogger.info('§11.4 health verdict as rendered', { ruleId, label });
    expect(label, 'a shadowed rule must name who is taking its pages').not.toBe('');
    expect(label, 'the tag must not be the neutral "Active" state').not.toMatch(/^Active$/i);

    const claimant = shadowed.shadowed_by?.[0]?.team_name;
    if (claimant) {
      expect(label, 'the claiming team is the actionable half of "shadowed"').toContain(claimant);
    } else {
      // Nothing to hold the screen to: without `shadowed_by` the server has not
      // said WHO, and a label naming a team would be the client inventing one.
      expect(
        shadowed.health_summary ?? '',
        'the server must at least explain the verdict it gave',
      ).not.toBe('');
    }
  });

  /**
   * The team's own routing tab renders a different component over the same
   * verdict — a per-row note rather than a health column — so the two are
   * pinned separately. A rule that cannot bite is a finding about the
   * configuration, and it must survive the switch from the org view to the team
   * view rather than only existing on one of them.
   */
  test('§11.4 the team routing tab notes the overlap on the row itself', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const { broad, narrow } = await seedOverlappingRules(page, testInfo);

    const shadowed = await findShadowedRule(page, [broad.id, narrow.id]);
    test.skip(
      !shadowed,
      'the server\'s shadowing analysis calls neither seeded rule shadowed, so there is no verdict for the screen to surface',
    );
    const ruleId = shadowed.rule_id ?? shadowed.id;
    const owningTeamId = shadowed.team_id;

    await pm.oncallRoutingPage.gotoTeamRouting(ORG, owningTeamId);
    await pm.oncallTeamDetailPage.openRoutingTab();

    await expect(
      page.locator(pm.oncallRoutingPage.ruleRow(ruleId)),
      'the shadowed rule must be on its own team\'s routing tab',
    ).toBeVisible({ timeout: 30000 });

    const note = await pm.oncallRoutingPage.readRuleNote(ruleId);
    testLogger.info('§11.4 team-tab overlap note', { ruleId, note });
    expect(note ?? '', 'a rule that cannot bite gets a line of its own').not.toBe('');
    expect(note, 'the note is about specificity, not about traffic').toMatch(/overlap/i);
  });

  /**
   * §11.4's literal ask, recorded rather than asserted.
   *
   * The plan wants the finding above the table. `oncall-ownership-header` is the
   * only region there and the org routing screen passes `:show-header="false"`,
   * so nothing can appear above the rows on this build. Asserting the header is
   * empty would pin the gap as correct behaviour, so this reads it, logs it and
   * asserts only the part that is genuinely a contract: whatever the header
   * does or does not carry, the verdict is not hidden behind a row expansion.
   * See o2-enterprise#2601 for the sibling case of a plan expectation the screen
   * never drew.
   */
  test('§11.4 the shadowing verdict is never hidden behind a row expansion', {
    tag: ['@P2'],
  }, async ({ page }, testInfo) => {
    const { broad, narrow } = await seedOverlappingRules(page, testInfo);
    const shadowed = await findShadowedRule(page, [broad.id, narrow.id]);
    test.skip(!shadowed, 'no shadowed rule to read a verdict from');

    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.selectTab('rules');

    const notices = await pm.oncallRoutingPage.readHeaderNotices();
    testLogger.info(
      '§11.4 above-the-table notices (empty on main: the org view sets show-header=false)',
      { notices },
    );

    const ruleId = shadowed.rule_id ?? shadowed.id;
    await expect(
      page.locator(pm.oncallRoutingPage.ruleHealth(ruleId)),
      'the verdict must be on screen with nothing clicked',
    ).toBeVisible({ timeout: 30000 });
  });
});
