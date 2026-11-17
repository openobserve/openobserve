// Runs on a server with no provider and no master key, so it needs no mock, and its gate fails rather than skips.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { orgId } = require('../utils/oncall-seed.js');
const { newAccount, readTelephony, requireNoProvider } = require('../../pages/oncallPages/telephonyMock.js');

const HERO = { title: 'No phone provider connected', action: 'Connect Twilio' };
const NO_MASTER_KEY = 'Ask your operator to set O2_MASTER_ENCRYPTION_KEY.';

test.describe.configure({ mode: 'parallel' });

test.describe(
  'On-call telephony: settings with no provider',
  {
    tag: ['@oncall', '@oncall-telephony', '@enterprise'],
  },
  () => {
    let pm;
    let ORG;

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
      ORG = orgId();
      await requireNoProvider(page);
    });

    test(
      'UN-05 the Telephony page shows the hero, and Connect Twilio opens the dialog',
      {
        tag: ['@P0'],
      },
      async () => {
        await pm.telephonySettingsPage.gotoThroughSettingsMenu(ORG);
        testLogger.info('Expect the hero (3.2, U6, guide 4.1)');
        await pm.telephonySettingsPage.expectTitle('Telephony');
        await pm.telephonySettingsPage.expectHero(HERO);

        await pm.telephonySettingsPage.openConnectDialog();
        await pm.telephonySettingsPage.expectDialogSays('Connect Twilio');
        // o2-enterprise#3420 D3: the guide calls this button Connect and the app Save, so its words are not read.
        await pm.telephonySettingsPage.expectPrimaryButtonVisible();
        await pm.telephonySettingsPage.cancelDialog();
        await pm.telephonySettingsPage.expectHero(HERO);
      },
    );

    test(
      'UN-06 a save with no master key is refused with the operator sentence and stores nothing',
      {
        tag: ['@P1'],
      },
      async ({ page }) => {
        await pm.telephonySettingsPage.goto(ORG);
        await pm.telephonySettingsPage.openConnectDialog();
        await pm.telephonySettingsPage.fillAccount(newAccount());
        await pm.telephonySettingsPage.clickPrimary();

        testLogger.info('Expect the master-key sentence (P14)');
        await pm.telephonySettingsPage.expectRefusal(NO_MASTER_KEY);
        await pm.telephonySettingsPage.cancelDialog();
        await pm.telephonySettingsPage.expectHero(HERO);
        const view = await readTelephony(page);
        expect(view.org ?? null, 'a refused save must store nothing').toBeNull();
      },
    );
  },
);
