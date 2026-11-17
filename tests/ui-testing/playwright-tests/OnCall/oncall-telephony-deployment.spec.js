// The deployment-wide account through the Twilio mock, which refuses any rule that could fail it, because its breaker covers every org on the server.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { addTeamMembers, createOrg, createTeam, rotation, setTeamSchedule, uniqueName, withOrg } = require('../utils/oncall-seed.js');
const {
  TelephonyMock,
  clearOrgFixtures,
  createPerson,
  createSignedInPerson,
  newAccount,
  readContactAs,
  readTelephony,
  registerAccount,
  requireTelephony,
  shortSid,
  uniquePhone,
} = require('../../pages/oncallPages/telephonyMock.js');

const TITLE = "This deployment's Twilio account";
const USE_OWN = 'Use your own Twilio account instead';
const LINK_COPY = 'Pages that use SMS or Voice text and call this number. Acknowledge from the link in the text.';
// o2-enterprise#3420 D5: the guide only paraphrases this sentence, so naming the deployment's account is all that is read.
const TO_DEPLOYMENT = /deployment's account/i;

test.describe.configure({ mode: 'parallel' });

test.describe(
  'On-call telephony: the deployment account',
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
      await requireTelephony(page, 'deployment');
      mock = new TelephonyMock(page.request);
      prefix = uniqueName(`e2e_tel_dep_w${testInfo.workerIndex}`);
      org = await createOrg(page, 'e2e_tel_dep');
    });

    test.afterEach(async ({ page }) => {
      if (person) await person.context.close();
      person = null;
      if (org) await clearOrgFixtures(page, org, prefix);
      org = null;
    });

    test(
      'UD-01 an org with no account sees the deployment card, with call keys not available',
      {
        tag: ['@P0'],
      },
      async ({ page }) => {
        const view = await withOrg(org.id, async () => await readTelephony(page));
        expect(view.deployment_from_number, 'the From shown on the card comes from the server').toBeTruthy();

        await pm.telephonySettingsPage.goto(org.id);
        // o2-enterprise#3420 SC11 SC14: the guide's owner sentence is gone and the keys row reworded, so neither is read beyond Not available.
        testLogger.info('Expect the title, From and Use your own (guide 4.1, 4.2)');
        await pm.telephonySettingsPage.expectDeploymentCard({ title: TITLE, from: view.deployment_from_number, useOwn: USE_OWN });
        await pm.telephonySettingsPage.expectKeysRow({ available: false, words: ['Not available'] });
        await pm.telephonySettingsPage.expectNoHero();
      },
    );

    test(
      'UD-02 a person verifies through the deployment account with no Settings access',
      {
        tag: ['@P0'],
      },
      async ({ page, browser }) => {
        const phone = uniquePhone();
        const [deploymentSid] = (await mock.health()).protected_sids;
        person = await withOrg(org.id, async () => await createSignedInPerson(page, browser, prefix));
        const screens = new PageManager(person.page);
        // Provider presence must come from the person's own contact read, not from Settings (U3, A3).
        await screens.telephonySettingsPage.refuseAtNetworkEdge(org.id, ['GET']);

        await screens.oncallMinePage.goto(org.id);
        await screens.oncallMinePage.typePhone(phone);
        await screens.oncallMinePage.clickSendCode();
        await screens.oncallMinePage.expectCodeBoxVisible();
        const [text] = await mock.waitFor(phone, 'sms');
        expect(text.sid, 'with no org account the code goes through the deployment').toBe(deploymentSid);

        await screens.oncallMinePage.enterCode(await mock.lastCode(phone));
        await screens.oncallMinePage.clickConfirm();
        await screens.oncallMinePage.expectPhoneState('Verified');
        testLogger.info('Expect the link copy, not the press-keys copy (guide 6.3)');
        await screens.oncallMinePage.expectVerifiedCopy(LINK_COPY);

        const contact = await readContactAs({ org: org.id, ...person });
        expect(contact.phone_is_pageable).toBe(true);
        expect(contact.press4_available).toBe(false);
      },
    );

    test(
      'UD-03 own account connects, and Disconnect goes back to the deployment card',
      {
        tag: ['@P1'],
      },
      async ({ page }) => {
        const account = newAccount();
        await registerAccount(mock, account);
        await pm.telephonySettingsPage.goto(org.id);
        const view = await withOrg(org.id, async () => await readTelephony(page));
        await pm.telephonySettingsPage.expectDeploymentCard({ title: TITLE, from: view.deployment_from_number, useOwn: USE_OWN });

        await pm.telephonySettingsPage.openUseOwnDialog();
        await pm.telephonySettingsPage.fillAccount(account);
        await pm.telephonySettingsPage.clickPrimary();
        await pm.telephonySettingsPage.expectDialogClosed();
        await pm.telephonySettingsPage.expectConnectedCard({ from: account.from, shortSid: shortSid(account.sid), status: 'Connected' });

        await pm.telephonySettingsPage.openDisconnectConfirm();
        testLogger.info('Expect the deployment copy (3.2, U6, guide 4.4)');
        await pm.telephonySettingsPage.expectDisconnectCopy(TO_DEPLOYMENT);
        await pm.telephonySettingsPage.confirmDisconnect();
        await pm.telephonySettingsPage.expectDeploymentCard({ title: TITLE, from: view.deployment_from_number, useOwn: USE_OWN });
        await pm.telephonySettingsPage.expectNoHero();
      },
    );

    test(
      'UD-04 the Delivery tab has no no-provider note when the deployment has an account',
      {
        tag: ['@P2'],
      },
      async ({ page }) => {
        // D14: phone ticks default only once a rotation exists; a team with none is the whole-team fallback, Email alone.
        const team = await withOrg(org.id, async () => {
          const member = await createPerson(page, prefix);
          const created = await createTeam(page, { name: `${prefix}_team`, timezone: 'UTC' });
          await addTeamMembers(page, created.id, [member.email]);
          await setTeamSchedule(page, created.id, {
            timezone: 'UTC',
            rotations: [rotation({ id: 'Primary', members: [member.email] })],
          });
          return created;
        });
        await pm.oncallPolicyEditorPage.gotoEscalationTab(org.id, team.id);
        const contact = await pm.oncallPolicyEditorPage.openEditorReadingContact();
        expect(contact.phone_provider_available, 'the read the note hangs on').toBe(true);
        await pm.oncallPolicyEditorPage.selectPriority(1);
        await pm.oncallPolicyEditorPage.expectChannelTicked(1, 'sms', true);
        testLogger.info('Expect no note with a provider present; control for UN-03 (guide 5)');
        await pm.oncallPolicyEditorPage.expectNoNoProviderNote();
      },
    );
  },
);
