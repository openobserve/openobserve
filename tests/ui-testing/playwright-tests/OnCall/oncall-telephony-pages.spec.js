// Real pages through the Twilio mock: a firing costs 1 to 3 minutes, so the timeout covers the scheduler, the ladder and the ledger.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { createOrg, listResponses, uniqueName, withOrg } = require('../utils/oncall-seed.js');
const { getPolicy, getResponseRecord } = require('../utils/oncall-seed-ext.js');
const {
  TelephonyMock,
  clearOrgFixtures,
  connectOrgAccount,
  firePage,
  newAccount,
  requireTelephony,
  routeServiceToTeam,
  stageTeamWithPerson,
} = require('../../pages/oncallPages/telephonyMock.js');

const PAGE_TEST_TIMEOUT_MS = 330_000;

test.describe.configure({ mode: 'parallel', timeout: PAGE_TEST_TIMEOUT_MS });

test.describe(
  'On-call telephony: pages, ledger and acknowledging by phone',
  {
    tag: ['@oncall', '@oncall-telephony', '@enterprise'],
  },
  () => {
    let pm;
    let org;
    let prefix;
    let mock;

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
      await requireTelephony(page, 'org');
      mock = new TelephonyMock(page.request);
      prefix = uniqueName(`e2e_tel_page_w${testInfo.workerIndex}`);
      org = await createOrg(page, 'e2e_tel_page');
      await withOrg(org.id, async () => await connectOrgAccount(page, mock, newAccount()));
    });

    test.afterEach(async ({ page }) => {
      if (org) await clearOrgFixtures(page, org, prefix);
      org = null;
    });

    test(
      'UG-01 ticking SMS and Voice sends all three, and the ledger reads Sent per person and channel',
      {
        tag: ['@P0'],
      },
      async ({ page }) => {
        await withOrg(org.id, async () => {
          const { team, person, phone, seq } = await stageTeamWithPerson(page, mock, prefix, { channels: ['email'] });

          await pm.oncallPolicyEditorPage.gotoEscalationTab(org.id, team.id);
          await pm.oncallPolicyEditorPage.openEditor();
          await pm.oncallPolicyEditorPage.selectPriority(1);
          await pm.oncallPolicyEditorPage.setChannel(1, 'sms', true);
          await pm.oncallPolicyEditorPage.setChannel(1, 'voice', true);
          await pm.oncallPolicyEditorPage.expectChannelTicked(1, 'email', true);
          expect(await pm.oncallPolicyEditorPage.savePolicyAndWait(), 'the policy save').toBeLessThan(300);
          const stored = (await getPolicy(page, team.id)).rungs.find((rung) => rung.priority === 1);
          expect(stored.channels).toEqual(expect.arrayContaining(['email', 'sms', 'voice']));

          const { record } = await firePage(page, prefix, team.id);
          await mock.waitFor(phone, 'sms', { sinceSeq: seq });
          await mock.waitFor(phone, 'call', { sinceSeq: seq });

          await pm.oncallResponseDetailPage.goto(org.id, record.id);
          await pm.oncallResponseDetailPage.expectDetailVisible();
          await pm.oncallResponseDetailPage.expectTabPanelVisible('deliveries');
          testLogger.info('Expect Email, SMS and Voice call rows reading Sent (guide 9, ENT#3118, section 2)');
          await pm.oncallResponseDetailPage.expectDelivery(person.email, 'Email', 'Sent');
          await pm.oncallResponseDetailPage.expectDelivery(person.email, 'SMS', 'Sent');
          await pm.oncallResponseDetailPage.expectDelivery(person.email, 'Voice call', 'Sent');
          await pm.oncallResponseDetailPage.expectDeliveryRowCount(person.email, 3);
        });
      },
    );

    test(
      'UG-02 pressing 4 on the call acknowledges as that person on the page and the alert',
      {
        tag: ['@P0'],
      },
      async ({ page }) => {
        await withOrg(org.id, async () => {
          const { team, person, phone, seq } = await stageTeamWithPerson(page, mock, prefix);
          const { alert, record } = await firePage(page, prefix, team.id);
          await mock.waitFor(phone, 'call', { sinceSeq: seq });

          const answer = await mock.press({ to: phone, digits: '4' });
          // o2-enterprise#3420 SC6: the spec has two sentences for pressing 4, so only the start is read.
          testLogger.info('Expect the reply to start Acknowledged. (3.5, M3)');
          expect(answer.says[0]).toMatch(/^Acknowledged\./);
          expect(answer.hangup).toBe(true);
          expect((await getResponseRecord(page, record.id)).acked_by, 'the token names who acted').toBe(person.email);

          await pm.oncallResponseDetailPage.goto(org.id, record.id);
          await pm.oncallResponseDetailPage.expectDetailVisible();
          await pm.oncallResponseDetailPage.expectAcknowledgedBy(person.email);

          testLogger.info('Expect the alert chip to name the same person (02d 1, AK-2, AK-4)');
          await pm.oncallResponseDetailPage.gotoAlertDetail(org.id, alert.id);
          await pm.oncallResponseDetailPage.expectAlertChipNames(person.email);
        });
      },
    );

    test(
      'UG-03 the SMS link acknowledges, opens the page in OpenObserve, and a spent link names who',
      {
        tag: ['@P1'],
      },
      async ({ page }) => {
        await withOrg(org.id, async () => {
          const { team, person, phone, seq } = await stageTeamWithPerson(page, mock, prefix);
          const { alert, record } = await firePage(page, prefix, team.id);
          const link = await mock.readAckLink(phone, { sinceSeq: seq });

          await pm.oncallResponseDetailPage.openAckLink(link);
          expect(await pm.oncallResponseDetailPage.submitAckLink(), 'the acknowledge POST').toBe(200);
          testLogger.info('Expect the link to acknowledge as that person');
          expect((await getResponseRecord(page, record.id)).acked_by).toBe(person.email);
          await pm.oncallResponseDetailPage.followAckLinkIntoApp();
          testLogger.info('Expect the page in OpenObserve to show the ack (02d section 4)');
          await pm.oncallResponseDetailPage.expectAcknowledgedBy(person.email);
          await pm.oncallResponseDetailPage.gotoAlertDetail(org.id, alert.id);
          await pm.oncallResponseDetailPage.expectAlertChipNames(person.email);

          await pm.oncallResponseDetailPage.openAckLink(link);
          testLogger.info('Expect a spent link to name who acknowledged (D36)');
          await pm.oncallResponseDetailPage.expectAckLinkHeading(person.email);
        });
      },
    );

    test(
      'UG-04 a rejected number fails only the SMS row, beside Voice and Email reading Sent',
      {
        tag: ['@P1'],
      },
      async ({ page }) => {
        await withOrg(org.id, async () => {
          const { team, person, phone, seq } = await stageTeamWithPerson(page, mock, prefix);
          // o2-enterprise#3420 SC12: 21211 is a bad number, so this takes no side on how a STOP should read.
          await mock.fail({ to: phone, kind: 'sms', status: 400, code: 21211 });
          const { record } = await firePage(page, prefix, team.id);
          await mock.waitFor(phone, 'sms', { sinceSeq: seq, accepted: false });
          await mock.waitFor(phone, 'call', { sinceSeq: seq });

          await pm.oncallResponseDetailPage.goto(org.id, record.id);
          await pm.oncallResponseDetailPage.expectDetailVisible();
          await pm.oncallResponseDetailPage.expectTabPanelVisible('deliveries');
          testLogger.info('Expect SMS Failed beside Voice call and Email Sent (guide 9, P9)');
          await pm.oncallResponseDetailPage.expectDelivery(person.email, 'SMS', 'Failed');
          await pm.oncallResponseDetailPage.expectDelivery(person.email, 'Voice call', 'Sent');
          await pm.oncallResponseDetailPage.expectDelivery(person.email, 'Email', 'Sent');
        });
      },
    );

    test(
      'UG-05 a test page from the simulator texts and calls, and opens no page',
      {
        tag: ['@P2'],
      },
      async ({ page }) => {
        await withOrg(org.id, async () => {
          const { team, person, phone, seq } = await stageTeamWithPerson(page, mock, prefix);
          const service = await routeServiceToTeam(page, team.id, prefix);

          await pm.oncallRoutingPage.goto(org.id);
          await pm.oncallRoutingPage.expectPageVisible();
          await pm.oncallRoutingPage.openSignalTester();
          await pm.oncallRoutingPage.addSimulatorDimension('service', service);
          await pm.telephonySettingsPage.chooseSimulatorPriority('P1');
          await pm.oncallRoutingPage.runSimulator();
          await pm.oncallRoutingPage.expectSimulatorTeamNames(team.name);
          await pm.telephonySettingsPage.sendTestPage();

          const attempts = await pm.telephonySettingsPage.readTestAttempts();
          const mineOnly = attempts.filter((line) => line.includes(person.name));
          testLogger.info('Expect the result to list SMS and Voice call (D10, guide 7)', { attempts });
          expect(mineOnly.some((line) => line.includes('SMS'))).toBe(true);
          expect(mineOnly.some((line) => line.includes('Voice call'))).toBe(true);

          const [text] = await mock.waitFor(phone, 'sms', { sinceSeq: seq });
          const [call] = await mock.waitFor(phone, 'call', { sinceSeq: seq });
          testLogger.info('Expect the exact test text and call, with no link and no keys (guide 7, M8)');
          expect(text.body).toBe(`[Test] ${team.name} test page. No action needed.`);
          expect(call.twiml_parsed.says).toEqual([`This is a test page for ${team.name}. No action needed.`]);
          expect(call.twiml_parsed.gather, 'a test call takes no key').toBeNull();

          const opened = await listResponses(page, { teamId: team.id, includeResolved: true });
          expect(opened, 'a test page opens no page').toEqual([]);
        });
      },
    );
  },
);
