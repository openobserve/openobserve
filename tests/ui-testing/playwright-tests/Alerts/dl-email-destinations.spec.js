const fs = require('fs');
const path = require('path');
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
 * RECIPIENTS ARE PICKED, NOT TYPED. The recipient control is a multi-select over
 * the org's users and service accounts, so an address the org does not own cannot
 * reach a destination at all. The cases below therefore assert what the PICKER
 * guarantees — the chosen accounts are what gets stored, one entry each, the same
 * account never twice, a non-member unselectable — instead of the string parsing
 * (comma splitting, trimming, case folding, malformed-entry rejection) that the
 * removed free-text field used to do. Those parsing cases went with the field:
 * UI-03 now covers the picker's search filter, ML-05 and D-06 assert the server
 * rules through the REST API (the only place a mixed or non-member list can still
 * be handed over), and ML-07 (a 20-address pasted list) no longer has a subject.
 *
 * TIERING (this is what makes the suite runnable in CI). Email tests were
 * historically all skipped for "no email infrastructure", but most never read a
 * mailbox:
 *   Tier A — needs SMTP switched on and nothing else. The picker, storage
 *            round-trips, error strings, form behaviour. Runs anywhere.
 *   Tier B — needs a readable sink (Mailpit or a Mailinator inbox). Envelope
 *            headers, one-message-many-To, MIME. Skips cleanly with a reason.
 *   Tier C — needs a real distribution list (DL_ADDRESS). Multi-member fan-out.
 *
 * TWO RULES that keep the results honest:
 *   - storage is asserted from the REST API, never the form field (a picker can
 *     render a chip while the stored value differs)
 *   - delivery is asserted from the sink, so "saved successfully" is never
 *     mistaken for "addressed correctly"
 *
 * Absorbs the two email tests previously skipped in
 * alerts-destinations-prebuilt.spec.js (create/edit/delete + stored recipients);
 * see D-01, D-07, UI-12 and UI-02.
 *
 * Open defects from #2471 have regression tests below, skipped with the issue
 * reference — they assert the CORRECT behaviour and are ready to un-skip on fix.
 */

const RUN = Date.now().toString().slice(-6);
const ORG_USER = process.env['ZO_ROOT_USER_EMAIL'] || 'root@example.com';
const DL_ADDRESS = process.env['DL_ADDRESS'] || '';
const DL_MEMBERS = (process.env['DL_MEMBERS'] || '').split(',').map((s) => s.trim()).filter(Boolean);

// A SECOND org account: the picker only offers accounts the org owns, so a
// multi-recipient case cannot be written against a single-user org at all.
// Per-worker unique (RUN plus a random tail, since two workers can load this
// module in the same millisecond) so no worker's afterAll can delete an account
// another worker is still picking from — and whatever it does delete can only
// ever be this suite's own account.
const RCPT_ACCOUNT = `auto_dest_rcpt_${RUN}_${Math.random().toString(36).slice(2, 6)}@test.local`;
let rcptAccountReady = false;

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
 * we SKIP with the reason rather than fail the whole file — that is exactly the
 * state these tests were previously parked in, and a red suite would tell nobody
 * anything.
 */
let smtpReady = null;
// The probe DELIVERS a message and only a real send proves the transport (the membership gate runs first, so a non-member recipient never observes SMTP being off, and /config exposes nothing) — so it is claimed through a file in Playwright's outputDir, wiped every run, making it one probe per RUN rather than one per worker dropping uncounted mail in the shared inbox.
const PROBE_FILE = path.join(__dirname, '../../test-results', '.smtp-probe.json');
async function probeSmtp() {
  const res = await api.testDestination({ type: 'email', recipients: [ORG_USER] });
  const err = ((res.body && res.body.error) || '').toLowerCase();
  // "must be part of this org" still proves SMTP is on — it failed the LATER gate.
  return res.status === 200 && !err.includes('smtp');
}
async function smtpAvailable() {
  if (smtpReady !== null) return smtpReady;
  fs.mkdirSync(path.dirname(PROBE_FILE), { recursive: true });
  let claimed = false;
  try {
    // 'wx' fails if the file exists, so exactly one worker wins the claim.
    fs.closeSync(fs.openSync(PROBE_FILE, 'wx'));
    claimed = true;
  } catch (_) { /* another worker is probing (or already did) */ }

  if (claimed) {
    const ready = await probeSmtp();
    fs.writeFileSync(PROBE_FILE, JSON.stringify({ ready }));
    smtpReady = ready;
    return smtpReady;
  }

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(PROBE_FILE, 'utf8');
      if (raw) return (smtpReady = JSON.parse(raw).ready);
    } catch (_) { /* winner has not written its answer yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // The winner never answered — probe here rather than skipping the suite on a lock timeout.
  smtpReady = await probeSmtp();
  return smtpReady;
}

test.describe('Email destinations and distribution lists', () => {
  // Each test creates its own uniquely-named destination and cleans up in
  // afterAll, so they are independent — parallel keeps one failure from
  // aborting the remainder the way serial mode does.
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeAll(async () => {
    const res = await api.createOrgUser(RCPT_ACCOUNT);
    rcptAccountReady = res.status === 200 || res.status === 201;
    if (!rcptAccountReady) {
      // Already existing is the only acceptable non-2xx (a re-run inside the same
      // worker) — and then the account still has to be there. Anything else is a
      // missing prerequisite, which must fail HERE rather than as a mysterious
      // empty picker in seven unrelated cases.
      rcptAccountReady = (await api.orgAccounts()).includes(RCPT_ACCOUNT);
    }
    if (!rcptAccountReady) {
      throw new Error(`Second org account ${RCPT_ACCOUNT} unavailable — multi-recipient`
        + ` cases cannot run: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    }
  });

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
    if (rcptAccountReady) await api.deleteOrgUser(RCPT_ACCOUNT).catch(() => {});
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

  test('ML-01 · each selected account is stored as its own recipient', {
    tag: ['@dlEmailDestinations', '@email', '@P0', '@all'],
  }, async () => {
    const destName = uniq('multi');
    await fillEmailForm(pm, destName, [ORG_USER, RCPT_ACCOUNT]);
    await pm.alertDestinationsPage.clickSave();

    const stored = await api.storedRecipients(destName);
    expect(stored, 'both picked accounts must be stored, one entry each').toHaveLength(2);
    expect([...stored].sort()).toEqual([ORG_USER.toLowerCase(), RCPT_ACCOUNT.toLowerCase()].sort());
  });

  test('D-03 · a non-member can never become a recipient', {
    tag: ['@dlEmailDestinations', '@email', '@negative', '@P0', '@all'],
  }, async () => {
    const destName = `auto_dest_dl_outsider_${RUN}`;
    const outsider = 'outsider-not-a-member@test.local';
    expect(await api.orgAccounts(), 'the outsider must genuinely be a non-member').not.toContain(outsider);

    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('email');
    await pm.alertDestinationsPage.fillDestinationName(destName);

    // The picker is the gate the free-text field never was: an address the org
    // does not own is not an option, so it cannot be chosen. A non-empty
    // unfiltered list proves the control is live, so the empty filtered list
    // below cannot pass merely because nothing rendered.
    expect(await pm.alertDestinationsPage.getEmailRecipientOptions(),
      'the picker must offer the org accounts').not.toHaveLength(0);
    expect(await pm.alertDestinationsPage.getEmailRecipientOptions('outsider'),
      'a non-member must not be offered').toHaveLength(0);

    await pm.alertDestinationsPage.clickSave();
    expect(await api.storedRecipients(destName), 'nothing selectable means nothing stored').toBeNull();

    // The picker is a convenience in front of the real guard, not a replacement
    // for it: a client that writes the destination directly is still refused,
    // with the reason that names the actual rule.
    const apiDestName = `${destName}_api`;
    created.push(apiDestName);
    const res = await api.createDestination({ name: apiDestName, type: 'email', emails: [outsider] });
    expect(res.status, 'the backend must refuse a non-member recipient').toBe(400);
    expect(String(res.body?.message || ''), 'and must say why').toContain('part of this org');
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

  test('UI-02 · every offered recipient is a real org account', {
    tag: ['@dlEmailDestinations', '@email', '@validation', '@P0', '@all'],
  }, async () => {
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('email');

    // The account list is read on both sides of the picker read: the DL alias is
    // created and deleted by the fan-out case running in this same shard, so an
    // entry that appears or vanishes in between is that case's doing, not a
    // stowaway in the picker.
    const before = await api.orgAccounts();
    const offered = await pm.alertDestinationsPage.getEmailRecipientOptions();
    const accounts = [...new Set([...before, ...(await api.orgAccounts())])];
    expect(offered, 'the picker must offer the accounts the org owns')
      .toContain(ORG_USER.toLowerCase());
    for (const value of offered) {
      expect(accounts, `${value} is offered but is not an account of this org`)
        .toContain(String(value).toLowerCase());
    }

    // A term naming no account can only come back empty, so the list asserted
    // above is everything the picker could ever store — there is no free text
    // left for a malformed address to arrive through.
    expect(await pm.alertDestinationsPage.getEmailRecipientOptions('invalid-email-format'))
      .toHaveLength(0);
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
    // Selecting an account the destination already holds is a no-op, so an edit
    // that saves the prefilled selection unchanged cannot lose the stored entry.
    await pm.alertDestinationsPage.fillEmailRecipients([ORG_USER, RCPT_ACCOUNT]);
    await pm.alertDestinationsPage.clickSave();

    const stored = await api.storedRecipients(destName);
    expect([...stored].sort(), 'the added account must persist alongside the original')
      .toEqual([ORG_USER.toLowerCase(), RCPT_ACCOUNT.toLowerCase()].sort());
  });

  test('ML-08 · removing a recipient drops it from the stored list', {
    tag: ['@dlEmailDestinations', '@email', '@P1', '@all'],
  }, async ({ page }) => {
    const destName = uniq('remove');
    await fillEmailForm(pm, destName, [ORG_USER, RCPT_ACCOUNT]);
    await pm.alertDestinationsPage.clickSave();
    expect(await api.storedRecipients(destName)).toHaveLength(2);

    await gotoDestinations(page, pm);
    await pm.alertDestinationsPage.searchDestinations(destName);
    await pm.alertDestinationsPage.openDestinationForEdit(destName);
    await pm.alertDestinationsPage.unselectEmailRecipient(RCPT_ACCOUNT);
    await pm.alertDestinationsPage.clickSave();

    expect(await api.storedRecipients(destName), 'the removed account must be gone')
      .toEqual([ORG_USER.toLowerCase()]);
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

  test('D-06 · a stored recipient is normalised to lowercase', {
    tag: ['@dlEmailDestinations', '@email', '@P1', '@all'],
  }, async () => {
    const destName = uniq('case');

    // Unreachable through the picker — an account is offered under its own,
    // already-lowercased address — so the contract is asserted at the boundary
    // where a mixed-case entry can still arrive: a client writing the
    // destination itself.
    const res = await api.createDestination({
      name: destName, type: 'email', emails: [ORG_USER.toUpperCase()],
    });
    expect(res.status, 'a real account must be accepted however it is cased').toBe(200);
    expect(await api.storedRecipients(destName), 'recipients are normalised to lowercase on save')
      .toEqual([ORG_USER.toLowerCase()]);
  });

  test('ML-03 · an edit prefills every stored recipient', {
    tag: ['@dlEmailDestinations', '@email', '@P1', '@all'],
  }, async ({ page }) => {
    const destName = uniq('prefill');
    await fillEmailForm(pm, destName, [ORG_USER, RCPT_ACCOUNT]);
    await pm.alertDestinationsPage.clickSave();

    await gotoDestinations(page, pm);
    await pm.alertDestinationsPage.searchDestinations(destName);
    await pm.alertDestinationsPage.openDestinationForEdit(destName);

    const selected = await pm.alertDestinationsPage.getEmailRecipients();
    expect([...selected].sort(), 'every stored recipient must come back selected')
      .toEqual([ORG_USER.toLowerCase(), RCPT_ACCOUNT.toLowerCase()].sort());
  });

  test('ML-05 · one non-member rejects the whole list, with no partial save', {
    tag: ['@dlEmailDestinations', '@email', '@negative', '@P1', '@all'],
  }, async () => {
    const destName = `auto_dest_dl_partial_${RUN}`;
    created.push(destName);

    // The picker cannot build a mixed list, so the invariant is asserted where it
    // can still be violated: a client posting both at once must have the WHOLE
    // list refused, with no half-saved destination left behind.
    const res = await api.createDestination({
      name: destName, type: 'email',
      emails: [ORG_USER, 'outsider-not-a-member@test.local'],
    });
    expect(res.status, 'a list carrying a non-member must be refused').toBe(400);
    expect(await api.storedRecipients(destName), 'no partial save may survive').toBeNull();
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

  test('ML-06 · the same account cannot be recorded twice', {
    tag: ['@dlEmailDestinations', '@email', '@P2', '@all'],
  }, async () => {
    const destName = uniq('dupe');
    // A multi-select holds values, not occurrences: picking one account twice
    // still stores it once. (The free-text field this replaced could record a
    // repeated address verbatim — #2471, suggestions.)
    await fillEmailForm(pm, destName, [ORG_USER, ORG_USER]);
    await pm.alertDestinationsPage.clickSave();

    const stored = await api.storedRecipients(destName);
    testLogger.info('repeated-selection behaviour', { stored });
    expect(stored, 'one account, one recipient').toEqual([ORG_USER.toLowerCase()]);
  });

  test('UI-03 · the picker search narrows the list to matching accounts', {
    tag: ['@dlEmailDestinations', '@email', '@validation', '@P2', '@all'],
  }, async () => {
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('email');

    expect(await pm.alertDestinationsPage.getEmailRecipientOptions(),
      'the search case needs the unfiltered list to compare against').not.toHaveLength(0);

    // Filtering by the second account's local part must leave the accounts that
    // carry the term and drop the root account, whose address does not contain it.
    const term = RCPT_ACCOUNT.split('@')[0];
    const filtered = await pm.alertDestinationsPage.getEmailRecipientOptions(term);
    expect(filtered, 'the search must leave the matching account').not.toHaveLength(0);
    for (const value of filtered) {
      expect(String(value).toLowerCase(), 'a filtered option must match the search term')
        .toContain(term);
    }
    expect(filtered, 'an account outside the search term must be filtered out')
      .not.toContain(ORG_USER.toLowerCase());
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

  test('UI-07 · a multi-account selection breaks neither the control nor the page', {
    tag: ['@dlEmailDestinations', '@email', '@P2', '@all'],
  }, async () => {
    const destName = uniq('multiui');
    await fillEmailForm(pm, destName, [ORG_USER, RCPT_ACCOUNT]);

    const shown = await pm.alertDestinationsPage.getEmailRecipients();
    expect([...shown].sort(), 'the control must report the whole selection')
      .toEqual([ORG_USER.toLowerCase(), RCPT_ACCOUNT.toLowerCase()].sort());
    expect(await pm.alertDestinationsPage.isPageScrolledHorizontally(),
      'a multi-account selection must not make the page scroll sideways').toBe(false);

    await pm.alertDestinationsPage.clickSave();
    expect(await api.storedRecipients(destName)).toHaveLength(2);
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
    await pm.alertDestinationsPage.fillEmailRecipients(RCPT_ACCOUNT);
    await pm.alertDestinationsPage.clickCancel();

    expect(await api.storedRecipients(destName), 'cancel must not write')
      .toEqual([ORG_USER.toLowerCase()]);
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
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('email');
    await pm.alertDestinationsPage.fillDestinationName(destName);
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
  // Every test that SENDS mail belongs here too, even one that never reads the sink: a send from a parallel worker lands in the same inbox and is counted by whichever delivery case is mid-assertion (ML-04's delivery count).
  test.describe('delivery', () => {
    test.describe.configure({ mode: 'serial' });

  test('UI-05 · Test sends without persisting the destination', {
    tag: ['@dlEmailDestinations', '@email', '@delivery', '@P1', '@all'],
  }, async () => {
    const destName = `auto_dest_dl_never_${RUN}`;
    await fillEmailForm(pm, destName, ORG_USER);
    await pm.alertDestinationsPage.clickTest();
    await pm.alertDestinationsPage.clickCancel();

    expect(await api.storedRecipients(destName), 'Test must not persist the destination').toBeNull();
  });

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
    // The prior serial delivery test also mails ORG_USER; its async delivery can land after clear() and, since only one org recipient exists, cannot be told apart by address — so drain to stable-empty before sending.
    await sink.waitUntilEmptyStable();

    await fillEmailForm(pm, destName, [ORG_USER, RCPT_ACCOUNT]);
    await pm.alertDestinationsPage.clickTest();
    await sink.waitForCount(1);

    // The sink counts DELIVERIES, and the CI relay forwards one message per envelope recipient, so two recipients must settle at two — not one.
    // The guarded regression is one message PER RECIPIENT, whose duplicate copy lands milliseconds after the first, so the count may only be read once it stops moving.
    const settled = await sink.countAfterSettle();
    expect(settled, 'each recipient gets exactly one delivery').toBe(2);

    // A per-recipient send also totals two, so only the shared To: proves both travelled in one message.
    const msg = await sink.latest();
    expect(msg.to.sort(), 'both recipients addressed on one message')
      .toEqual([ORG_USER.toLowerCase(), RCPT_ACCOUNT.toLowerCase()].sort());
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
  // (#2471 B4, semicolon-separated lists, no longer has a subject: recipients are
  // picked from accounts, so no separator is ever parsed.)

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
