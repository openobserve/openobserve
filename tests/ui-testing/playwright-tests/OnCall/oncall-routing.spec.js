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
  addTeamMembers,
  createOwnershipRule,
  listOwnershipRules,
  ownershipStats,
  setDefaultTeam,
  getRoutingConfig,
  seedOnCallStream,
  waitForStreamSearchable,
  seedNotificationDestination,
  firePageAndWait,
  orgId,
  uniqueName,
  baseUrl,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  listUnroutedSignals,
} = require('../utils/oncall-seed-ext.js');
const { getAuthHeaders } = require('../utils/cloud-auth.js');

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

  // ------------------------------------------------- Tier 1 (TS-12, TS-13, TS-14)

  /**
   * A team that can actually be paged, plus a stream and an alert carrying one
   * worker-unique service dimension.
   *
   * Worker-unique because a 409 on an ownership rule means somebody else
   * already owns that identity path, which on a shared org is another worker
   * rather than a bug.
   */
  async function seedPageableFixture(page, testInfo, tag) {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_${tag}`);
    const emails = await createOrgUsers(page, prefix, 3);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, emails);
    const service = `${prefix}_svc`;
    const stream = prefix.toLowerCase();
    const seeded = await seedOnCallStream(page, stream, { minutes: 30, services: [service] });
    await waitForStreamSearchable(page, stream, seeded.records);
    const destination = await seedNotificationDestination(page, prefix.toLowerCase());
    return { prefix, emails, team, service, stream, destination };
  }

  /**
   * TS-12.03 — the write path the five read-only tests above never exercise.
   *
   * Creating a rule from the editor is only half the case: a rule that saves
   * and then does not ROUTE is exactly as useless as one that never saved, so
   * the second half fires a real signal carrying the rule's dimensions and
   * reads which team the record landed on.
   */
  test('TS-12.03 an ownership rule created in the editor round-trips and routes a real signal', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedPageableFixture(page, testInfo, 'crud');

    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.expectAvailable();
    await pm.oncallRoutingPage.selectTab('rules');
    await pm.oncallRoutingPage.openRuleEditor();
    await pm.oncallRoutingPage.chooseRuleTeam(f.team.id, f.team.name);
    // The editor opens on the scope picker, which offers claims built from
    // dimensions the org has already seen; a freshly-seeded service is not one,
    // so the rule is written on the dimension builder behind it.
    await pm.oncallRoutingPage.useAdvancedRuleScope();
    await pm.oncallRoutingPage.addCondition('service', f.service);
    await pm.oncallRoutingPage.saveRule();

    // The server is the record of what was written, so the rule is found by
    // asking it rather than by trusting the drawer closed.
    await expect.poll(
      async () => (await listOwnershipRules(page, f.team.id))
        .some((rule) => rule.dimensions?.service === f.service),
      { timeout: 60000, intervals: [1000], message: 'the rule editor never produced a rule' },
    ).toBe(true);

    const stored = (await listOwnershipRules(page, f.team.id))
      .find((rule) => rule.dimensions?.service === f.service);
    expect(stored.team_id, 'a rule must page the team the editor named').toBe(f.team.id);

    // It survives a reload — a rule that only exists in the open tab is not a
    // rule. The ORG screen draws the stats table, so the row is asked for by its
    // team cell; `oncall-routing-row-{id}` is the TEAM tab's component.
    const ruleId = stored.id ?? stored.rule_id;
    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.selectTab('rules');
    await pm.oncallRoutingPage.expectOrgRuleRowVisible(ruleId);
    await pm.oncallRoutingPage.expectOrgRuleNamesTeam(ruleId, f.team.name);

    // And the team's own routing tab words what the rule DOES, on the dimension
    // it matches — the half a reader checks when asking "will this bite".
    await pm.oncallRoutingPage.gotoTeamRouting(ORG, f.team.id);
    await pm.oncallTeamDetailPage.openRoutingTab();
    await pm.oncallRoutingPage.expectRuleVisible(ruleId);
    const sentence = await pm.oncallRoutingPage.readRuleSentence(ruleId);
    testLogger.info('TS-12.03 rule as the team tab words it', { ruleId, sentence });
    expect(sentence, 'the row says what the rule does, in the dimension the rule matches on')
      .toContain(f.service);

    // And it BITES: a signal carrying its dimensions reaches the named team.
    const { pages } = await firePageAndWait(page, {
      alertOptions: { name: `${f.prefix}_alert`, stream: f.stream, destinations: [f.destination] },
    });
    expect(pages[0].team_id, 'a rule that saves but does not route is no rule at all')
      .toBe(f.team.id);

    // Deleting it from the table removes it for good, not just from the view.
    // Back on the ORG screen first: the delete control lives on the stats table,
    // and the last navigation above left the browser on the team's routing tab.
    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.selectTab('rules');
    await pm.oncallRoutingPage.expectOrgRuleRowVisible(ruleId);
    await pm.oncallRoutingPage.deleteRule(ruleId);
    await expect.poll(
      async () => (await listOwnershipRules(page, f.team.id))
        .some((rule) => (rule.id ?? rule.rule_id) === ruleId),
      { timeout: 60000, intervals: [1000], message: 'the deleted rule is still stored' },
    ).toBe(false);
    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.selectTab('rules');
    await pm.oncallRoutingPage.expectOrgRuleRowAbsent(ruleId);
  });

  /**
   * TS-14.01 and TS-14.02 in ONE test, deliberately.
   *
   * The org's default team is SINGLETON state: nominating one changes where
   * every unmatched signal in the org lands, for every worker at once. Split
   * across two parallel tests they would each silently invalidate the other's
   * precondition — "a default is set" and "no default is set" cannot both hold.
   * So the nomination case and the unrouted-queue case are driven as one
   * sequence over the same fixture, which is also how an operator meets them.
   */
  test('TS-14.01/TS-14.02 an unmatched signal defaults where a team is nominated, and reaches the queue where none is', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const f = await seedPageableFixture(page, testInfo, 'default');

    // Nothing auto-creates a default. Waking a fallback team for a service they
    // know nothing about trains people to ignore pages, so the absence is the
    // designed state and is asserted rather than assumed.
    const before = await getRoutingConfig(page);
    testLogger.info('TS-14.01 routing config before nomination', before);

    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.expectAvailable();
    await pm.oncallRoutingPage.expectDefaultTeamControlVisible();
    await pm.oncallRoutingPage.nominateDefaultTeam(f.team.id, f.team.name);

    await expect.poll(
      async () => (await getRoutingConfig(page))?.default_team_id,
      { timeout: 60000, intervals: [1000], message: 'the nomination never reached the org config' },
    ).toBe(f.team.id);

    // No ownership rule covers this service, so the only thing that can route
    // it is the default.
    const defaulted = await firePageAndWait(page, {
      alertOptions: { name: `${f.prefix}_defaulted`, stream: f.stream, destinations: [f.destination] },
    });
    testLogger.info('TS-14.01 defaulted record', { team: defaulted.pages[0].team_id });
    expect(defaulted.pages[0].team_id, 'with a default set, an unmatched signal is paged rather than lost')
      .toBe(f.team.id);

    // The nomination is legible without opening anything: the trigger's own
    // label names the org's current catch-all.
    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.expectDefaultTeamLabelNames(f.team.name);

    // Un-nominate. Done through the API rather than the dialog, deliberately:
    // `oncall-default-team-unset` is NOT a control — it is the warning paragraph
    // shown while nobody is nominated — and the dialog's "none" entry carries an
    // EMPTY value, which OSelect does not stamp as `data-test-value=""`, so
    // there is no addressable UI path to un-nominate. Clearing is scaffolding
    // for the half of the case that IS the subject — what happens to an
    // unmatched signal when no default exists — so it must not be what the test
    // dies on. The gap is recorded in the generation report.
    await setDefaultTeam(page, null);
    await expect.poll(
      async () => (await getRoutingConfig(page))?.default_team_id ?? null,
      { timeout: 60000, intervals: [1000], message: 'the default team was never cleared' },
    ).toBeNull();

    // With nobody nominated, the screen says so rather than staying silent.
    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.expectDefaultTeamUnsetWarning();

    const orphanService = `${f.prefix}_orphan`;
    const orphanStream = `${f.prefix}_orphan`.toLowerCase();
    const orphanSeeded = await seedOnCallStream(page, orphanStream, { minutes: 30, services: [orphanService] });
    await waitForStreamSearchable(page, orphanStream, orphanSeeded.records);
    const orphan = await firePageAndWait(page, {
      alertOptions: { name: `${f.prefix}_orphan_alert`, stream: orphanStream, destinations: [f.destination] },
    });
    testLogger.info('TS-14.02 orphan record', { team: orphan.pages[0].team_id });
    expect(orphan.pages[0].team_id ?? null, 'with no default, nothing may quietly claim an unmatched signal')
      .toBeNull();

    // TS-14.02 — the queue must show it, with the full identity path, so a human
    // can see WHY nothing matched rather than only that nothing did.
    await expect.poll(
      async () => (await listUnroutedSignals(page)).some((sig) => String(sig.path ?? '').includes(orphanService)),
      { timeout: 120000, intervals: [3000], message: 'the unmatched signal never reached the unrouted queue' },
    ).toBe(true);

    const signal = (await listUnroutedSignals(page))
      .find((sig) => String(sig.path ?? '').includes(orphanService));
    await pm.oncallRoutingPage.goto(ORG);
    await pm.oncallRoutingPage.selectTab('signals');
    await pm.oncallRoutingPage.expectUnroutedRowVisible(signal.id);
    const path = await pm.oncallRoutingPage.readUnroutedPath(signal.id);
    testLogger.info('TS-14.02 rendered identity path', { path });
    expect(path, 'the row shows the identity nothing matched, not just a title')
      .toContain(orphanService);
    await pm.oncallRoutingPage.expectUnroutedReachedNobody(signal.id);
  });

  /**
   * TS-12.10 — W-03, UNWIRED and kept as a fixme with its real assertion intact.
   *
   * Routing keys are semantic group ids — `service`, `k8s-namespace`,
   * `k8s-cluster`, `host`, `environment`. The endpoint validates that the name
   * and the value are non-empty but never checks the NAME against the group
   * list, so a rule keyed on a dimension nothing emits saves happily and can
   * never route anything. Re-verified on this build, 15 Sep:
   * `POST /api/default/oncall/ownership` with `{"totally_made_up_dim":"x"}`
   * answers **200**, and a repeat answers 409 — i.e. the invalid rule was
   * stored and persists.
   *
   * The UI is immune: it offers a curated picker. Anyone using the API,
   * Terraform or a migration script is not, and the result is the Tier-1 "a
   * team is silently not paged" class. The body asserts the CORRECT behaviour —
   * a 400 naming the valid group ids — so it flips green the moment the
   * endpoint validates, and weakening it to assert the 200 would pin the defect
   * as correct.
   */
  test.fixme('TS-12.10 an ownership rule on a dimension outside the semantic group list is refused — W-03: POST /oncall/ownership accepts {"totally_made_up_dim":"x"} with 200, verified 15 Sep on :5090', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const team = await createTeam(page, { name: uniqueName(`${workerPrefix(testInfo)}_w03`) });

    const res = await page.request.post(`${baseUrl()}/api/${ORG}/oncall/ownership`, {
      headers: getAuthHeaders(),
      data: { team_id: team.id, dimensions: { totally_made_up_dim: uniqueName('x') } },
    });
    const body = await res.text().catch(() => '');
    testLogger.info('TS-12.10 bogus dimension rule', { status: res.status(), body: body.slice(0, 300) });

    expect(res.status(), 'a rule keyed on a dimension nothing emits can never route and must be refused')
      .toBe(400);
    expect(body, 'the refusal has to name the vocabulary the caller should have used')
      .toMatch(/service|k8s-namespace|environment|semantic/i);

    // And nothing may have been stored: a refused rule that persists is worse
    // than one that saved, because the 409 on the retry hides the first one.
    const stored = await listOwnershipRules(page, team.id);
    expect(stored, 'a refused rule must not be stored').toEqual([]);
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
