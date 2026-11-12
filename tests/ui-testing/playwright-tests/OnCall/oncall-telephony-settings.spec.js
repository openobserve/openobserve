// Telephony settings against the Twilio mock, as root in a per-test org, so a failed check on one account never reaches another test's breaker.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { createOrg, uniqueName, withOrg } = require('../utils/oncall-seed.js');
const {
  TelephonyMock,
  clearOrgFixtures,
  connectOrgAccount,
  createSignedInPerson,
  newAccount,
  readContactAs,
  readTelephony,
  registerAccount,
  requireTelephony,
  sha256,
  shortSid,
} = require('../../pages/oncallPages/telephonyMock.js');

const HERO = { title: 'No phone provider connected', action: 'Connect Twilio' };
const REJECTED = 'Twilio did not accept this account. Check the Account SID and auth token, and that the account is active.';
const BAD_SID = 'That is not a Twilio Account SID; it starts with AC.';
const BAD_FROM = /Use the full number with country code, for example/;
const TOKEN_HINT = 'Leave blank to keep the current token';
const READ_ONLY = 'Only org admins can change this.';
const KEY_WORDS = ['4 acknowledge', '6 resolve', '8 escalate'];

test.describe.configure({ mode: 'parallel' });

test.describe(
  'On-call telephony: settings',
  {
    tag: ['@oncall', '@oncall-telephony', '@enterprise'],
  },
  () => {
    let pm;
    let org;
    let prefix;
    let mock;
    let person;

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
      await requireTelephony(page, 'org');
      mock = new TelephonyMock(page.request);
      prefix = uniqueName(`e2e_tel_set_w${testInfo.workerIndex}`);
      org = await createOrg(page, 'e2e_tel_set');
    });

    test.afterEach(async ({ page }) => {
      if (person) await person.context.close();
      person = null;
      if (org) await clearOrgFixtures(page, org, prefix);
      org = null;
    });

    test(
      'US-01 an admin connects an account and reads it back on the connected card',
      {
        tag: ['@P0'],
      },
      async ({ page }) => {
        const account = newAccount();
        await registerAccount(mock, account);
        // Holds the check open long enough to read the button; under the 5 s client timeout it is only a late answer.
        await mock.fail({ sid: account.sid, kind: 'account', delay_ms: 1500, times: 1 });

        await pm.telephonySettingsPage.gotoThroughSettingsMenu(org.id);
        testLogger.info('Expect the page title and hero (guide 4.1, 4.3)');
        await pm.telephonySettingsPage.expectTitle('Telephony');
        await pm.telephonySettingsPage.expectHero(HERO);

        await pm.telephonySettingsPage.openConnectDialog();
        await pm.telephonySettingsPage.expectDialogSays('Connect Twilio');
        // o2-enterprise#3420 D3: the guide calls this button Connect and the app Save, so its words are not read.
        await pm.telephonySettingsPage.expectPrimaryButtonVisible();
        await pm.telephonySettingsPage.fillAccount(account);
        await pm.telephonySettingsPage.clickPrimary();
        await pm.telephonySettingsPage.expectPrimaryButton('Checking with Twilio…');
        await pm.telephonySettingsPage.expectDialogClosed();

        // o2-enterprise#3420 SC11: the row's words differ between spec and app, so only the key names are read.
        testLogger.info('Expect From, the short SID, Connected and the call keys (3.2, guide 4.4)');
        await pm.telephonySettingsPage.expectConnectedCard({ from: account.from, shortSid: shortSid(account.sid), status: 'Connected' });
        await pm.telephonySettingsPage.expectKeysRow({ available: true, words: KEY_WORDS });
        await pm.telephonySettingsPage.expectNoHero();

        const checks = await mock.requests({ sid: account.sid, kind: 'account' });
        expect(
          checks.some((check) => check.auth_ok === true),
          'the save must have asked the provider',
        ).toBe(true);
        const view = await withOrg(org.id, async () => await readTelephony(page));
        expect(view.org.account_sid).toBe(account.sid);
        expect(view.org.from_number).toBe(account.from);
        expect(view.press4_available).toBe(true);
        expect(JSON.stringify(view), 'a read must never carry the token').not.toContain(account.token);

        await pm.telephonySettingsPage.reload();
        await pm.telephonySettingsPage.expectConnectedCard({ from: account.from, shortSid: shortSid(account.sid), status: 'Connected' });
      },
    );

    test(
      'US-02 an account the provider rejects shows the banner and stores nothing',
      {
        tag: ['@P0'],
      },
      async ({ page }) => {
        const account = newAccount();
        await registerAccount(mock, account);
        await pm.telephonySettingsPage.goto(org.id);
        await pm.telephonySettingsPage.openConnectDialog();
        await pm.telephonySettingsPage.fillAccount({ ...account, token: newAccount().token });
        await pm.telephonySettingsPage.clickPrimary();

        testLogger.info('Expect the rejected-account banner (P5, guide 4.3)');
        await pm.telephonySettingsPage.expectRefusal(REJECTED);
        const checks = await mock.requests({ sid: account.sid, kind: 'account' });
        expect(checks.length, 'the wrong token must really have been tried').toBeGreaterThan(0);
        expect(checks.every((check) => check.auth_ok === false)).toBe(true);

        await pm.telephonySettingsPage.cancelDialog();
        await pm.telephonySettingsPage.expectHero(HERO);
        const view = await withOrg(org.id, async () => await readTelephony(page));
        expect(view.org ?? null, 'nothing is saved unless the provider accepts it').toBeNull();
      },
    );

    test(
      'US-03 Update with a blank token keeps the token and never shows it',
      {
        tag: ['@P1'],
      },
      async ({ page }) => {
        const account = newAccount({ extraNumbers: 1 });
        const newFrom = account.numbers[1];
        await withOrg(org.id, async () => await connectOrgAccount(page, mock, account));
        await pm.telephonySettingsPage.goto(org.id);
        await pm.telephonySettingsPage.expectConnectedCard({ from: account.from, shortSid: shortSid(account.sid), status: 'Connected' });
        const seen = await mock.requests({ sid: account.sid });
        const sinceSeq = seen[seen.length - 1].seq;

        await pm.telephonySettingsPage.openUpdateDialog();
        testLogger.info('Expect the keep-token hint and an empty password box (guide 4.4, P6, U7)');
        await pm.telephonySettingsPage.expectDialogSays(TOKEN_HINT);
        await pm.telephonySettingsPage.expectTokenInputHiddenAndEmpty();
        await pm.telephonySettingsPage.fillAccount({ from: newFrom });
        await pm.telephonySettingsPage.clickPrimary();
        await pm.telephonySettingsPage.expectDialogClosed();
        await pm.telephonySettingsPage.expectConnectedCard({ from: newFrom, shortSid: shortSid(account.sid), status: 'Connected' });

        const checks = await mock.requests({ sid: account.sid, kind: 'account', sinceSeq });
        expect(checks.length, 'an update must ask the provider again').toBeGreaterThan(0);
        for (const check of checks) {
          expect(check.auth_ok).toBe(true);
          expect(await mock.tokenHash(check.seq), 'a blank token must keep the stored one').toBe(sha256(account.token));
        }
        const view = await withOrg(org.id, async () => await readTelephony(page));
        expect(view.org.from_number, 'the update must really have saved').toBe(newFrom);

        await pm.telephonySettingsPage.openUpdateDialog();
        await pm.telephonySettingsPage.expectTokenInputHiddenAndEmpty();
        await pm.telephonySettingsPage.cancelDialog();
      },
    );

    test(
      'US-04 Disconnect asks to confirm, the hero returns, and a person loses the provider',
      {
        tag: ['@P0'],
      },
      async ({ page, browser }) => {
        const account = newAccount();
        person = await withOrg(org.id, async () => {
          await connectOrgAccount(page, mock, account);
          return await createSignedInPerson(page, browser, prefix);
        });
        const before = await readContactAs({ org: org.id, ...person });
        expect(before.phone_provider_available, 'the account must count before it is removed').toBe(true);

        await pm.telephonySettingsPage.goto(org.id);
        await pm.telephonySettingsPage.openDisconnectConfirm();
        // o2-enterprise#3420 D4: the guide says email only and the app says email and Slack, so the sentence is not read.
        await pm.telephonySettingsPage.confirmDisconnect();
        await pm.telephonySettingsPage.expectHero(HERO);
        const view = await withOrg(org.id, async () => await readTelephony(page));
        expect(view.org ?? null).toBeNull();

        const mine = new PageManager(person.page).oncallMinePage;
        await mine.goto(org.id);
        // o2-enterprise#3420 D2: the spec's disabled card and sentence differ from the app's, so only the missing box and the link are read.
        testLogger.info('Expect no number box, no way to add a phone, and the link to Telephony once the account is gone (P7, U3)');
        await mine.expectNoProviderCard();
        await mine.openTelephonyFromCard();
        await new PageManager(person.page).telephonySettingsPage.expectTitle('Telephony');
      },
    );

    test(
      'US-05 a save refused 403 latches the page read-only with the sentence',
      {
        tag: ['@P1'],
      },
      async ({ page }) => {
        const account = newAccount();
        await withOrg(org.id, async () => await connectOrgAccount(page, mock, account));
        await pm.telephonySettingsPage.goto(org.id);
        await pm.telephonySettingsPage.expectControlsEnabled();
        await pm.telephonySettingsPage.refuseAtNetworkEdge(org.id, ['PUT', 'DELETE']);

        await pm.telephonySettingsPage.openUpdateDialog();
        await pm.telephonySettingsPage.clickPrimary();
        await pm.telephonySettingsPage.expectDialogClosed();
        testLogger.info('Expect the read-only sentence and latched controls (A10)');
        await pm.telephonySettingsPage.expectReadOnly(READ_ONLY);
      },
    );

    test(
      'US-06 a read refused 403 shows the sentence instead of the page',
      {
        tag: ['@P1'],
      },
      async () => {
        await pm.telephonySettingsPage.refuseAtNetworkEdge(org.id, ['GET']);
        await pm.telephonySettingsPage.goto(org.id);
        testLogger.info('Expect the forbidden sentence (A10)');
        await pm.telephonySettingsPage.expectForbidden(READ_ONLY);
      },
    );

    test(
      'US-07 a bad SID and a bad From get the exact sentences and reach nobody',
      {
        tag: ['@P1'],
      },
      async ({ page }) => {
        const account = newAccount();
        const badSid = 'XX12345';
        await registerAccount(mock, account);
        await pm.telephonySettingsPage.goto(org.id);
        await pm.telephonySettingsPage.openConnectDialog();

        await pm.telephonySettingsPage.fillAccount({ ...account, sid: badSid });
        await pm.telephonySettingsPage.clickPrimary();
        testLogger.info('Expect the bad SID sentence (P14, guide 4.3)');
        await pm.telephonySettingsPage.expectDialogSays(BAD_SID);

        await pm.telephonySettingsPage.fillAccount({ sid: account.sid, from: account.from.slice(1) });
        await pm.telephonySettingsPage.clickPrimary();
        testLogger.info('Expect the bad From sentence (P14, guide 4.3)');
        await pm.telephonySettingsPage.expectDialogSays(BAD_FROM);

        await pm.telephonySettingsPage.cancelDialog();
        await pm.telephonySettingsPage.expectHero(HERO);
        expect(await mock.requests({ sid: account.sid }), 'a malformed form must not reach the provider').toEqual([]);
        expect(await mock.requests({ sid: badSid }), 'a malformed SID must not reach the provider').toEqual([]);
        const view = await withOrg(org.id, async () => await readTelephony(page));
        expect(view.org ?? null).toBeNull();
      },
    );
  },
);
