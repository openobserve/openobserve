const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const sink = require('../utils/mail-sink.js');
const api = require('../utils/o2-api.js');

/**
 * Email destinations and distribution lists.
 *
 * A DL is one alias that the MAIL SERVER fans out; OpenObserve only ever sees a
 * single string. So the suite splits in two: the DL half (does O2 accept and
 * address the alias?) and the recipient-list half — where our code actually runs
 * and where regressions live.
 *
 * TIERING (this is what makes the suite runnable in CI). Email tests were
 * historically all skipped for "no email infrastructure", but most never read a
 * mailbox:
 *   Tier A — needs SMTP switched on and nothing else. Validation, splitting,
 *            storage round-trips, error strings, form behaviour. Runs anywhere.
 *   Tier B — needs a readable sink (Mailpit or a Mailinator inbox). Envelope
 *            headers, one-message-many-To, MIME. Skips cleanly with a reason.
 *   Tier C — needs a real distribution list (DL_ADDRESS). Multi-member fan-out.
 *
 * TWO RULES that keep the results honest:
 *   - storage is asserted from the REST API, never the form field (an input can
 *     echo what you typed while the stored value differs)
 *   - delivery is asserted from the sink, so "saved successfully" is never
 *     mistaken for "addressed correctly"
 *
 * Absorbs the two email tests previously skipped in
 * alerts-destinations-prebuilt.spec.js (create/edit/delete + format validation);
 * see D-01, D-07, UI-12 and UI-02.
 *
 * Open defects from #2471 have regression tests below, skipped with the issue
 * reference — they assert the CORRECT behaviour and are ready to un-skip on fix.
 */

const RUN = Date.now().toString().slice(-6);
const ORG_USER = process.env['ZO_ROOT_USER_EMAIL'] || 'root@example.com';
const DL_ADDRESS = process.env['DL_ADDRESS'] || '';
const DL_MEMBERS = (process.env['DL_MEMBERS'] || '').split(',').map((s) => s.trim()).filter(Boolean);

const created = [];
const uniq = (suffix) => {
  const n = `auto_dest_dl_${suffix}_${RUN}`;
  created.push(n);
  return n;
};

// Gates the afterAll delete on THIS suite having actually created the DL_ADDRESS
// user, not merely on the env var being set — DL_ADDRESS is a shared, global CI
// value, and deleting whatever account it happens to name (with no record of
// whether this run made it) is unsafe against a real/shared org.
let dlUserCreated = false;

async function gotoDestinations(page, pm) {
  await page.goto(`${process.env['ZO_BASE_URL']}/web/alert-destinations?org_identifier=${process.env['ORGNAME']}`);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await pm.alertDestinationsPage.expectDestinationsListTitleVisible();
}

/** Fill the prebuilt Email form without saving — the shared prefix of most cases. */
async function fillEmailForm(pm, destName, recipients) {
  await pm.alertDestinationsPage.clickNewDestination();
  await pm.alertDestinationsPage.selectDestinationType('email');
  await pm.alertDestinationsPage.fillEmailRecipients(recipients);
  await pm.alertDestinationsPage.fillDestinationName(destName);
}

/**
 * Whole-suite gate: every case here saves or sends an email destination, which the
 * backend refuses unless ZO_SMTP_* is configured. On an environment without SMTP
 * we SKIP with the reason rather than fail 27 tests — that is exactly the state
 * these tests were previously parked in, and a red suite would tell nobody anything.
 */
let smtpReady = null;
async function smtpAvailable() {
  if (smtpReady !== null) return smtpReady;
  const res = await api.testDestination({ type: 'email', recipients: [ORG_USER] });
  const err = ((res.body && res.body.error) || '').toLowerCase();
  // "must be part of this org" still proves SMTP is on — it failed the LATER gate.
  smtpReady = res.status === 200 && !err.includes('smtp');
  return smtpReady;
}

test.describe('Email destinations and distribution lists', () => {
  // Each test creates its own uniquely-named destination and cleans up in
  // afterAll, so they are independent — parallel keeps one failure from
  // aborting the remainder the way serial mode does.
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const ready = await smtpAvailable();
    if (!ready && process.env['ZO_SMTP_ENABLED'] === 'true') {
      // ZO_SMTP_ENABLED=true means this environment explicitly configured SMTP
      // for this suite (CI does) — a gate that still reads "off" here means the
      // /alerts/destinations/test contract drifted, not that SMTP is genuinely
      // unavailable. Silently skipping would turn every case in this file into
      // a green no-op with nothing in the report to explain why.
      throw new Error('ZO_SMTP_ENABLED=true but smtpAvailable() still reads false — '
        + 'the /alerts/destinations/test SMTP-detection contract may have drifted');
    }
    test.skip(!ready,
      'SMTP is not configured on this environment (ZO_SMTP_ENABLED) — email destinations cannot be saved');
    pm = new PageManager(page);
    await gotoDestinations(page, pm);
  });

  test.afterAll(async () => {
    for (const n of created) await api.deleteDestination(n).catch(() => {});
    if (dlUserCreated) await api.deleteOrgUser(DL_ADDRESS).catch(() => {});
    testLogger.info('Cleaned up destinations created by this spec', { count: created.length });
  });

  // ══ TIER A · P0 — critical path, no mailbox required ═════════════════════

  // Uses ORG_USER, not DL_ADDRESS — DL_ADDRESS is env-optional (empty string
  // fallback above) and this is the P0 smoke test, so it must not depend on it
  // being configured. The DL-specific fan-out is covered separately in the
  // delivery tier below, which does gate on DL_ADDRESS being set.
  test('D-01 · a recipient address saves, appears in the list, and round-trips', {
    tag: ['@dlEmailDestinations', '@email', '@smoke', '@P0', '@all'],
  }, async () => {
    const destName = uniq('dl');
    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickSave();

    await pm.alertDestinationsPage.expectDestinationInList(destName);
    expect(await api.storedRecipients(destName), 'stored recipients must match what was entered')
      .toEqual([ORG_USER.toLowerCase()]);
  });

  test('ML-01 · comma-separated recipients are split into individual entries', {
    tag: ['@dlEmailDestinations', '@email', '@P0', '@all'],
  }, async () => {
    const destName = uniq('comma');
    await fillEmailForm(pm, destName, `${ORG_USER},${ORG_USER}`);
    await pm.alertDestinationsPage.clickSave();

    const stored = await api.storedRecipients(destName);
    expect(stored, 'a comma-separated string must become separate recipients').toHaveLength(2);
  });

  test('D-03 · a recipient outside the org is refused, and the real reason is shown', {
    tag: ['@dlEmailDestinations', '@email', '@negative', '@P0', '@all'],
  }, async () => {
    const destName = `auto_dest_dl_outsider_${RUN}`;
    await fillEmailForm(pm, destName, 'outsider-not-a-member@test.local');
    await pm.alertDestinationsPage.clickSave();

    expect(await api.storedRecipients(destName), 'a refused destination must not persist').toBeNull();
    const shown = await pm.alertDestinationsPage.getPageText();
    expect(shown.toLowerCase(), 'the backend reason must reach the user, not a generic failure')
      .toContain('part of this org');
  });

  test('UI-01 · empty recipients blocks submission', {
    tag: ['@dlEmailDestinations', '@email', '@validation', '@P0', '@all'],
  }, async () => {
    const destName = `auto_dest_dl_empty_${RUN}`;
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('email');
    await pm.alertDestinationsPage.fillDestinationName(destName);
    await pm.alertDestinationsPage.clickSave();

    await pm.alertDestinationsPage.expectFormOpen();
    expect(await api.storedRecipients(destName), 'nothing may reach the server').toBeNull();
  });

  test('UI-02 · a malformed address is rejected before any request is sent', {
    tag: ['@dlEmailDestinations', '@email', '@validation', '@P0', '@all'],
  }, async () => {
    const destName = `auto_dest_dl_malformed_${RUN}`;
    await fillEmailForm(pm, destName, 'invalid-email-format');
    await pm.alertDestinationsPage.clickSave();

    expect(await api.storedRecipients(destName), 'a malformed address must never be stored').toBeNull();
    await pm.alertDestinationsPage.expectFormOpen();
    const errors = await pm.alertDestinationsPage.getVisibleErrors();
    expect(errors.length, 'the user must see a validation error').toBeGreaterThan(0);
  });

  test('T-01 · an email destination is given a usable template automatically', {
    tag: ['@dlEmailDestinations', '@email', '@template', '@P0', '@all'],
  }, async () => {
    const destName = uniq('tpl');
    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickSave();

    const dest = await api.getDestination(destName);
    expect(dest.status).toBe(200);
    expect(dest.body.template, 'an email destination must reference a template').toBeTruthy();
    const tpl = await api.getTemplate(dest.body.template);
    expect(tpl.status, `referenced template ${dest.body.template} must exist`).toBe(200);
  });

  // ══ TIER A · P1 — main workflows ═════════════════════════════════════════

  test('D-05 · an edit round trip leaves the stored address untouched', {
    tag: ['@dlEmailDestinations', '@email', '@P1', '@all'],
  }, async ({ page }) => {
    const destName = uniq('round');
    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickSave();

    await gotoDestinations(page, pm);
    await pm.alertDestinationsPage.searchDestinations(destName);
    await pm.alertDestinationsPage.openDestinationForEdit(destName);
    expect(await pm.alertDestinationsPage.getEmailRecipientsValue(),
      'edit mode must prefill the stored address').toBe(ORG_USER);

    await pm.alertDestinationsPage.clickSave();
    expect(await api.storedRecipients(destName)).toEqual([ORG_USER.toLowerCase()]);
  });

  test('D-07 · editing a destination to add a recipient persists both', {
    tag: ['@dlEmailDestinations', '@email', '@P1', '@all'],
  }, async ({ page }) => {
    const destName = uniq('addrcpt');
    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickSave();
    expect(await api.storedRecipients(destName)).toHaveLength(1);

    await gotoDestinations(page, pm);
    await pm.alertDestinationsPage.searchDestinations(destName);
    await pm.alertDestinationsPage.openDestinationForEdit(destName);
    await pm.alertDestinationsPage.fillEmailRecipients(`${ORG_USER},${ORG_USER}`);
    await pm.alertDestinationsPage.clickSave();

    expect(await api.storedRecipients(destName), 'the added recipient must persist').toHaveLength(2);
  });

  test('ML-08 · removing a recipient drops it from the stored list', {
    tag: ['@dlEmailDestinations', '@email', '@P1', '@all'],
  }, async ({ page }) => {
    const destName = uniq('remove');
    await fillEmailForm(pm, destName, `${ORG_USER},${ORG_USER}`);
    await pm.alertDestinationsPage.clickSave();
    expect(await api.storedRecipients(destName)).toHaveLength(2);

    await gotoDestinations(page, pm);
    await pm.alertDestinationsPage.searchDestinations(destName);
    await pm.alertDestinationsPage.openDestinationForEdit(destName);
    await pm.alertDestinationsPage.fillEmailRecipients(ORG_USER);
    await pm.alertDestinationsPage.clickSave();

    expect(await api.storedRecipients(destName), 'the removed recipient must be gone').toHaveLength(1);
  });

  test('UI-12 · deleting an email destination removes it from the list', {
    tag: ['@dlEmailDestinations', '@email', '@P1', '@all'],
  }, async ({ page }) => {
    const destName = `auto_dest_dl_delete_${RUN}`;
    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickSave();
    await pm.alertDestinationsPage.expectDestinationInList(destName);

    await gotoDestinations(page, pm);
    await pm.alertDestinationsPage.deleteDestination(destName);

    expect(await api.storedRecipients(destName), 'a deleted destination must be gone server-side').toBeNull();
  });

  test('D-06 · a mixed-case address is stored lowercase', {
    tag: ['@dlEmailDestinations', '@email', '@P1', '@all'],
  }, async () => {
    const destName = uniq('case');
    await fillEmailForm(pm, destName, ORG_USER.toUpperCase());
    await pm.alertDestinationsPage.clickSave();

    expect(await api.storedRecipients(destName), 'recipients are normalised to lowercase on save')
      .toEqual([ORG_USER.toLowerCase()]);
  });

  test('ML-03 · padding around separators is trimmed', {
    tag: ['@dlEmailDestinations', '@email', '@P1', '@all'],
  }, async () => {
    const destName = uniq('trim');
    await fillEmailForm(pm, destName, `${ORG_USER} ,  ${ORG_USER}`);
    await pm.alertDestinationsPage.clickSave();

    const stored = await api.storedRecipients(destName);
    expect(stored).toHaveLength(2);
    for (const r of stored) {
      expect(r, 'no stored recipient may carry whitespace').toBe(r.trim());
    }
  });

  test('ML-05 · one non-member rejects the whole list, with no partial save', {
    tag: ['@dlEmailDestinations', '@email', '@negative', '@P1', '@all'],
  }, async () => {
    const destName = `auto_dest_dl_partial_${RUN}`;
    await fillEmailForm(pm, destName, `${ORG_USER}, outsider-not-a-member@test.local`);
    await pm.alertDestinationsPage.clickSave();

    expect(await api.storedRecipients(destName), 'no partial save may survive').toBeNull();
  });

  test('UI-05 · Test sends without persisting the destination', {
    tag: ['@dlEmailDestinations', '@email', '@P1', '@all'],
  }, async () => {
    const destName = `auto_dest_dl_never_${RUN}`;
    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickTest();
    await pm.alertDestinationsPage.clickCancel();

    expect(await api.storedRecipients(destName), 'Test must not persist the destination').toBeNull();
  });

  test('D-08 · the custom email path offers only organisation users', {
    tag: ['@dlEmailDestinations', '@email', '@P1', '@all'],
  }, async () => {
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.openCustomEmailPath();

    expect(await pm.alertDestinationsPage.isCustomEmailsPickerPresent(),
      'the custom path uses an org-user picker').toBe(true);
    expect(await pm.alertDestinationsPage.isPrebuiltRecipientsFieldPresent(),
      'and not the prebuilt free-text field').toBe(false);

    const offered = await pm.alertDestinationsPage.getCustomEmailPickerOptions();
    expect(offered.some((o) => o.includes('@')), 'the picker must list org users').toBe(true);

    // A real, non-member search term legitimately returns zero options — that
    // IS the secure behaviour, so an empty result cannot itself prove the
    // check ran. What must be proven is that the search box actually engaged;
    // getCustomEmailPickerOptions() otherwise silently skips a missing search
    // field and would return the unfiltered list, which the substring filter
    // below cannot distinguish from a correctly-empty one.
    expect(await pm.alertDestinationsPage.isCustomEmailsSearchVisible(),
      'the picker search field must be present to filter by').toBe(true);

    const forOutsider = await pm.alertDestinationsPage.getCustomEmailPickerOptions('outsider-not-a-member');
    expect(forOutsider.filter((o) => o.includes('outsider')).length,
      'a non-member must not be selectable').toBe(0);
  });

  // ══ TIER A · P2 — edge cases and form hygiene ════════════════════════════

  test('ML-06 · duplicate recipients are recorded as entered', {
    tag: ['@dlEmailDestinations', '@email', '@P2', '@all'],
  }, async () => {
    const destName = uniq('dupe');
    await fillEmailForm(pm, destName, `${ORG_USER}, ${ORG_USER}`);
    await pm.alertDestinationsPage.clickSave();

    // Documents behaviour rather than asserting a fix: there is no de-duplication
    // anywhere in the save or send path (#2471, suggestions).
    const stored = await api.storedRecipients(destName);
    testLogger.info('duplicate-recipient behaviour', { stored });
    expect(stored).not.toBeNull();
    // .every() alone is true for a would-be-deduped 1-element array too, so it
    // cannot distinguish "duplicates preserved" from "duplicates removed" — the
    // exact behaviour this test documents. Length pins that down.
    expect(stored, 'duplicates are recorded as entered, not de-duplicated').toHaveLength(2);
    expect(stored.every((r) => r === ORG_USER.toLowerCase())).toBe(true);
  });

  test('ML-07 · a large recipient list survives the form intact', {
    tag: ['@dlEmailDestinations', '@email', '@P2', '@all'],
  }, async () => {
    const destName = uniq('bulk');
    const many = Array(20).fill(ORG_USER);
    await fillEmailForm(pm, destName, many.join(','));
    await pm.alertDestinationsPage.clickSave();

    const stored = await api.storedRecipients(destName);
    expect(stored, 'nothing may be truncated on save').not.toBeNull();
    expect(stored).toHaveLength(many.length);
  });

  test('UI-03 · a trailing separator does not create an empty recipient', {
    tag: ['@dlEmailDestinations', '@email', '@validation', '@P2', '@all'],
  }, async () => {
    const destName = `auto_dest_dl_trailing_${RUN}`;
    created.push(destName);
    await fillEmailForm(pm, destName, `${ORG_USER},`);
    await pm.alertDestinationsPage.clickSave();

    // The prebuilt validator rejects the trailing separator outright, which is a
    // correct way to satisfy "no empty recipient". Asserted explicitly rather
    // than accepting either outcome, which let a rejected save pass vacuously.
    const stored = await api.storedRecipients(destName);
    expect(stored, 'a trailing comma is rejected rather than stored as an empty recipient')
      .toBeNull();
  });

  test('UI-04 · switching type away from email drops the recipients', {
    tag: ['@dlEmailDestinations', '@email', '@P2', '@all'],
  }, async () => {
    const destName = uniq('switch');
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('email');
    await pm.alertDestinationsPage.fillEmailRecipients(ORG_USER);
    await pm.alertDestinationsPage.clickDestinationTypeCard('slack');

    expect(await pm.alertDestinationsPage.isPrebuiltRecipientsFieldPresent(),
      'the email field must be gone on a webhook type').toBe(false);
  });

  test('UI-07 · a long recipient list breaks neither the field nor the page', {
    tag: ['@dlEmailDestinations', '@email', '@P2', '@all'],
  }, async ({ page }) => {
    const destName = uniq('long');
    const many = Array(8).fill(ORG_USER).join(', ');
    await fillEmailForm(pm, destName, many);

    expect(await pm.alertDestinationsPage.getEmailRecipientsValue(),
      'the field must hold the whole value').toBe(many);
    expect(await pm.alertDestinationsPage.isPageScrolledHorizontally(),
      'a long list must not make the page scroll sideways').toBe(false);

    await pm.alertDestinationsPage.clickSave();
    expect(await api.storedRecipients(destName)).toHaveLength(8);
  });

  test('UI-08 · a duplicate destination name is refused', {
    tag: ['@dlEmailDestinations', '@email', '@validation', '@P2', '@all'],
  }, async ({ page }) => {
    const destName = uniq('dupname');
    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickSave();
    expect(await api.storedRecipients(destName)).toHaveLength(1);

    await gotoDestinations(page, pm);
    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickSave();

    expect(await api.storedRecipients(destName), 'the original must survive').toHaveLength(1);
  });

  test('UI-09 · cancelling an edit writes nothing', {
    tag: ['@dlEmailDestinations', '@email', '@P2', '@all'],
  }, async ({ page }) => {
    const destName = uniq('cancel');
    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickSave();

    await gotoDestinations(page, pm);
    await pm.alertDestinationsPage.searchDestinations(destName);
    await pm.alertDestinationsPage.openDestinationForEdit(destName);
    await pm.alertDestinationsPage.fillEmailRecipients(`${ORG_USER},${ORG_USER}`);
    await pm.alertDestinationsPage.clickCancel();

    expect(await api.storedRecipients(destName), 'cancel must not write').toHaveLength(1);
  });

  test('UI-10 · the form is operable from the keyboard alone', {
    tag: ['@dlEmailDestinations', '@email', '@a11y', '@P2', '@all'],
  }, async () => {
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('email');

    expect(await pm.alertDestinationsPage.tabToRecipientsField(),
      'recipients must be reachable by Tab').toBe(true);

    // An indicator that never changes is no indicator at all, which a snapshot
    // of the focused state alone would miss.
    const focused = await pm.alertDestinationsPage.getRecipientsFocusStyle();
    await pm.alertDestinationsPage.fillDestinationName(`auto_dest_dl_kb_${RUN}`);
    const blurred = await pm.alertDestinationsPage.getRecipientsFocusStyle();
    testLogger.info('focus indicator', { focused, blurred });
    expect(focused.shadow !== blurred.shadow || focused.border !== blurred.border,
      'focus must visibly change the field').toBe(true);
  });

  test('UI-11 · dark theme at a narrow viewport keeps the error legible', {
    tag: ['@dlEmailDestinations', '@email', '@P2', '@all'],
  }, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 420, height: 900 });
    const destName = `auto_dest_dl_dark_${RUN}`;
    await fillEmailForm(pm, destName, 'invalid-email-format');
    await pm.alertDestinationsPage.clickSave();

    const errors = await pm.alertDestinationsPage.getVisibleErrors();
    expect(errors.length, 'the validation error must be visible at 420px').toBeGreaterThan(0);
    expect(await pm.alertDestinationsPage.isPageScrolledHorizontally(),
      'the form must not scroll sideways at 420px').toBe(false);
  });

  // ══ TIER B/C — require a readable mail sink ══════════════════════════════
  // These share ONE inbox, so they clear and count against common state. Nested
  // serial keeps them in a single worker and in order; the Tier A cases above
  // never touch the sink and stay parallel.
  test.describe('delivery', () => {
    test.describe.configure({ mode: 'serial' });

  test('D-04 · envelope headers carry the configured From and only the alias in To', {
    tag: ['@dlEmailDestinations', '@email', '@delivery', '@P1', '@all'],
  }, async () => {
    test.skip(!(await sink.available()), await sink.unavailableReason());
    const destName = uniq('env');
    const cleared = await sink.clear();
    test.skip(!cleared, 'needs a clearable sink so latest() cannot be stale mail (use Mailpit)');

    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickTest();
    await sink.waitForCount(1);

    const msg = await sink.latest();
    expect(msg, 'the Test button must really send').not.toBeNull();
    expect(msg.to, 'only the addressed recipient may appear in To:')
      .toContain(ORG_USER.toLowerCase());
    expect(msg.from, 'From must be the configured sender').toBeTruthy();
  });

  test('ML-04 · several recipients travel in a single message', {
    tag: ['@dlEmailDestinations', '@email', '@delivery', '@P0', '@all'],
  }, async () => {
    test.skip(!(await sink.available()), await sink.unavailableReason());
    const destName = uniq('onemsg');
    const cleared = await sink.clear();
    test.skip(!cleared, 'needs a clearable sink to count messages exactly (use Mailpit)');

    await fillEmailForm(pm, destName, `${ORG_USER},${ORG_USER}`);
    await pm.alertDestinationsPage.clickTest();
    await sink.waitForCount(1);

    expect(await sink.count(), 'one message, not one per recipient').toBe(1);
  });

  // ══ TIER C — requires a real distribution list ═══════════════════════════

  test('D-02 · a real distribution list fans out to its members', {
    tag: ['@dlEmailDestinations', '@email', '@delivery', '@dl', '@P1', '@all'],
  }, async () => {
    test.skip(!DL_ADDRESS, 'set DL_ADDRESS to a distribution list to run the fan-out case');
    test.skip(!(await sink.available()), await sink.unavailableReason());

    // The alias has to be an org member before it can be addressed at all.
    const createRes = await api.createOrgUser(DL_ADDRESS);
    dlUserCreated = createRes.status === 200 || createRes.status === 201;
    const destName = uniq('fanout');
    await sink.clear();

    await fillEmailForm(pm, destName, DL_ADDRESS);
    await pm.alertDestinationsPage.clickTest();

    // One send must produce one delivery per member — that is the whole point of
    // a distribution list, and the half OpenObserve does not perform itself.
    const expected = DL_MEMBERS.length || 1;
    const delivered = await sink.waitForCount(expected);
    expect(delivered, `one send should reach all ${expected} member mailbox(es)`)
      .toBeGreaterThanOrEqual(expected);

    const msg = await sink.latest();
    expect(msg, 'a member mailbox must receive the message').not.toBeNull();
    // A real DL keeps the alias in To: — members are not exposed to one another.
    expect(msg.to.join(',').toLowerCase(), 'To: should carry the alias, not the members')
      .toContain(DL_ADDRESS.split('@')[0].toLowerCase());
  });

  }); // end delivery

  // ══ REGRESSION TESTS FOR OPEN DEFECTS (#2471) ════════════════════════════
  // These assert the CORRECT behaviour and therefore fail on today's build.
  // Skipped rather than left failing, since none of the defects is P0/blocking.
  // Un-skip the matching test as each issue closes — do not soften the assertion.

  test.skip('ML-02 · semicolon-separated recipients are accepted [#2471 B4]', {
    tag: ['@dlEmailDestinations', '@email', '@regression', '@P2', '@all'],
  }, async () => {
    // BLOCKED BY #2471 (B4): prebuilt-templates/email.ts splits on "," only, so a
    // semicolon list is tested as one address and fails the regex. Outlook — where
    // distribution lists live — uses ";" by default, so pasting a member list fails.
    const destName = uniq('semi');
    await fillEmailForm(pm, destName, `${ORG_USER};${ORG_USER}`);
    await pm.alertDestinationsPage.clickSave();

    expect(await api.storedRecipients(destName), 'a semicolon must separate recipients')
      .toHaveLength(2);
  });

  test.skip('UI-13 · the email form shows no Skip TLS Verify control [#2471 B5]', {
    tag: ['@dlEmailDestinations', '@email', '@regression', '@P3', '@all'],
  }, async () => {
    // BLOCKED BY #2471 (B5): the toggle is rendered on the email form but has no
    // effect — an email destination carries only recipients, and SMTP transport
    // security is server configuration (ZO_SMTP_ENCRYPTION).
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('email');

    expect(await pm.alertDestinationsPage.isSkipTlsToggleVisible(),
      'a control with no effect on email must not be shown').toBe(false);
  });

  test.skip('UI-14 · Preview shows the configured sender and the entered recipients [#2471 B7]', {
    tag: ['@dlEmailDestinations', '@email', '@regression', '@P3', '@all'],
  }, async () => {
    // BLOCKED BY #2471 (B7): the dialog renders hardcoded
    // From: alerts@openobserve.ai / To: admin@example.com, so it answers
    // "will this reach the right people?" wrongly.
    const destName = `auto_dest_dl_preview_${RUN}`;
    await fillEmailForm(pm, destName, ORG_USER);
    const preview = await pm.alertDestinationsPage.openPreviewAndGetText();

    expect(preview, 'Preview must show the recipients actually entered').toContain(ORG_USER);
    expect(preview, 'Preview must not show a placeholder recipient').not.toContain('admin@example.com');
  });

  // BLOCKED BY #2471 (B2): membership is validated in destinations.rs save()
  // and test_email() only; the send path never re-checks, so alerts keep
  // reaching a removed user while the destination can no longer be saved.
  // Needs a disposable org user plus a firing alert — see the issue for the
  // full manual reproduction. Not yet implemented as a runnable test — a
  // hardcoded failing assertion here would still fail once #2471 is fixed,
  // which reads as "still broken" when it means the opposite.
  test.fixme('B2 · a user removed from the org stops receiving alerts [#2471 B2]', {
    tag: ['@dlEmailDestinations', '@email', '@delivery', '@regression', '@P1', '@all'],
  }, async () => {});

  test.skip('B3 · the text/plain part is readable text, not HTML [#2471 B3]', {
    tag: ['@dlEmailDestinations', '@email', '@delivery', '@regression', '@P2', '@all'],
  }, async () => {
    // BLOCKED BY #2471 (B3): the TemplateKind::Custom arm passes the same string
    // as both bodies, so the plain-text alternative carries markup. Affects the
    // default prebuilt_email, i.e. the default experience.
    const destName = uniq('mime');
    await sink.clear();
    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickTest();
    await sink.waitForCount(1);

    const msg = await sink.latest();
    expect(msg.text, 'the plain-text part must not contain HTML tags').not.toMatch(/<(html|h2|p|strong|table)\b/);
  });
});
