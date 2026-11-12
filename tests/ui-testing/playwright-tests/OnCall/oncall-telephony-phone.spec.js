// Phone card against the Twilio mock: each test has its own org and account, because the breaker key is the org, and its own person and number, because of the code caps.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { addTeamMembers, createOrg, createTeam, uniqueName, withOrg } = require('../utils/oncall-seed.js');
const {
  TelephonyMock,
  clearOrgFixtures,
  connectOrgAccount,
  createPerson,
  createSignedInPerson,
  newAccount,
  putContactStatusAs,
  readContactAs,
  requireTelephony,
  sendCodesAs,
  uniquePhone,
} = require('../../pages/oncallPages/telephonyMock.js');

const PRESS_KEYS_COPY =
  'Pages that use SMS or Voice text and call this number. During a call, press 4 to acknowledge, 6 to resolve, or 8 to escalate.';
const WRONG_CODE = 'That code is not right. 4 tries left.';
const NUMBER_REJECTED = 'This number cannot receive texts. Check it and try again.';
const CANNOT_SEND = 'The code could not be sent right now. Try again in a minute.';
const TOO_MANY_TRIES = 'Too many tries. Send a new code.';
// o2-enterprise#3420 SC1 SC15: the guide says "too many codes today" and the UI drops "today", and how long the wait runs is open, so any wait passes.
const USER_DAILY_LIMIT = /^You have asked for too many codes( today)?\. Try again in .+\.$/;
// Guide 6.3 says pages stop texting and calling until the new number is confirmed, so only that meaning is read.
const CHANGED_HINT = /text.*call.*until you confirm/i;
const NO_PHONE_OWN = 'no phone on file. Add your phone on My on-call';
const NO_PHONE = 'no phone on file';

test.describe.configure({ mode: 'parallel' });

test.describe(
  'On-call telephony: the phone card',
  {
    tag: ['@oncall', '@oncall-telephony', '@enterprise'],
  },
  () => {
    let org;
    let prefix;
    let mock;
    let account;
    let person;
    let mine;

    test.beforeEach(async ({ page, browser }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      await requireTelephony(page, 'org');
      mock = new TelephonyMock(page.request);
      prefix = uniqueName(`e2e_tel_phone_w${testInfo.workerIndex}`);
      org = await createOrg(page, 'e2e_tel_phone');
      account = newAccount();
      await withOrg(org.id, async () => {
        await connectOrgAccount(page, mock, account);
        person = await createSignedInPerson(page, browser, prefix);
      });
      mine = new PageManager(person.page).oncallMinePage;
    });

    test.afterEach(async ({ page }) => {
      if (person) await person.context.close();
      person = null;
      if (org) await clearOrgFixtures(page, org, prefix);
      org = null;
    });

    test(
      'UP-01 a person adds a phone, types the texted code and reads Verified',
      {
        tag: ['@P0'],
      },
      async () => {
        const phone = uniquePhone();
        await mine.goto(org.id);
        // o2-enterprise#3420 D1: the spec puts the Phone card first and the app puts it after Your shifts, so only presence is read.
        testLogger.info('Expect the card and Your teams on the page (U8)');
        await mine.expectPhoneCardVisible();
        await mine.expectTeamsCardVisible();

        const writes = mine.recordContactWrites();
        await mine.typePhone(phone);
        await mine.clickSendCode();
        await mine.expectCodeBoxVisible();
        testLogger.info('Expect the code-sent line (guide 6.3) and PUT then POST (section 10)');
        await mine.expectPhoneState('Not verified');
        await mine.expectCodeSentCopy(`Code sent to ${phone}. It works for 10 minutes.`);
        expect(writes.map((write) => write.method)).toEqual(['PUT', 'POST']);
        expect(writes[0].body.phone).toBe(phone);
        expect(writes[1].path.endsWith('/verify')).toBe(true);

        const texts = await mock.waitFor(phone, 'sms');
        expect(texts, 'exactly one code goes out').toHaveLength(1);
        expect(texts[0].sid, 'the code goes through the org account').toBe(account.sid);
        expect(texts[0].from).toBe(account.from);

        await mine.enterCode(await mock.lastCode(phone));
        await mine.clickConfirm();
        testLogger.info('Expect Verified and the press-keys copy (A3, guide 6.3)');
        await mine.expectPhoneState('Verified');
        await mine.expectVerifiedCopy(PRESS_KEYS_COPY);
        await mine.expectPhoneNumberShown(phone);
        await mine.expectCodeBoxHidden();
        await mine.expectNoPhoneError();

        const contact = await readContactAs({ org: org.id, ...person });
        expect(contact.phone).toBe(phone);
        expect(contact.phone_is_pageable, 'the server must agree with the screen').toBe(true);
      },
    );

    test(
      'UP-02 a wrong code says so with the tries left, and the right code still works',
      {
        tag: ['@P0'],
      },
      async () => {
        const phone = uniquePhone();
        await mine.goto(org.id);
        await mine.typePhone(phone);
        await mine.clickSendCode();
        await mine.expectCodeBoxVisible();

        const code = await mock.lastCode(phone);
        const wrong = `${code.slice(0, 5)}${(Number(code[5]) + 1) % 10}`;
        await mine.enterCode(wrong);
        await mine.clickConfirm();
        testLogger.info('Expect the wrong-code sentence with 4 tries left (guide 6.3, V8)');
        await mine.expectPhoneError(WRONG_CODE);
        await mine.expectPhoneState('Not verified');
        expect((await readContactAs({ org: org.id, ...person })).phone_is_pageable).toBe(false);

        await mine.enterCode(code);
        await mine.clickConfirm();
        await mine.expectPhoneState('Verified');
        await mine.expectNoPhoneError();
      },
    );

    test(
      'UP-03 a number with no country code is flagged on Send and never leaves the browser',
      {
        tag: ['@P1'],
      },
      async () => {
        const phone = uniquePhone();
        await mine.goto(org.id);
        const writes = mine.recordContactWrites();

        await mine.typePhone('4155550134');
        await mine.clickSendCode();
        // o2-enterprise#3420 E24: the spec flags as it is typed and the app on leaving the box or on Send, so only Send is read.
        testLogger.info('Expect the format flag on Send (U3)');
        await mine.expectFormatFlagged();
        await mine.expectCodeBoxHidden();

        await mine.typePhone(phone);
        await mine.clickSendCode();
        await mine.expectCodeBoxVisible();
        const saved = writes.filter((write) => write.method === 'PUT').map((write) => write.body.phone);
        expect(saved, 'the flagged number must not be the first thing the server saw').toEqual([phone]);
      },
    );

    test(
      'UP-04 changing a verified number takes the proof away',
      {
        tag: ['@P1'],
      },
      async () => {
        const first = uniquePhone();
        const second = uniquePhone();
        await mock.verifyPhoneAs({ org: org.id, ...person, phone: first });
        await mine.goto(org.id);
        await mine.expectPhoneState('Verified');

        await mine.clickChange();
        await mine.expectPhoneInputVisible();
        await mine.typePhone(second);
        await mine.clickSendCode();
        testLogger.info('Expect Not verified once the number changes (U3, V6)');
        await mine.expectPhoneState('Not verified');
        const contact = await readContactAs({ org: org.id, ...person });
        expect(contact.phone).toBe(second);
        expect(contact.phone_is_pageable, 'a changed number must not page until it is confirmed').toBe(false);

        await person.page.reload();
        await mine.expectPhoneState('Not verified');
        await mine.expectPhoneInputVisible();
        await mine.expectChangedHint(CHANGED_HINT);
      },
    );

    test(
      'UP-05 a send the provider refuses says why, for a bad number and for an outage',
      {
        tag: ['@P1'],
      },
      async () => {
        const badNumber = uniquePhone();
        const outage = uniquePhone();
        await mock.fail({ to: badNumber, kind: 'sms', status: 400, code: 21211 });
        await mock.fail({ to: outage, kind: 'sms', status: 500 });
        await mine.goto(org.id);

        await mine.typePhone(badNumber);
        await mine.clickSendCode();
        testLogger.info('Expect the bad-number sentence (guide 6.3)');
        await mine.expectPhoneError(NUMBER_REJECTED);
        await mine.expectCodeBoxHidden();
        expect((await mock.requests({ to: badNumber, kind: 'sms' }))[0].response_status).toBe(400);

        // The state tag appears once the saved number is read back, which would otherwise overwrite what is typed next.
        await mine.expectPhoneState('Not verified');
        await mine.typePhone(outage);
        await mine.clickSendCode();
        testLogger.info('Expect the provider-unavailable sentence (guide 6.3)');
        await mine.expectPhoneError(CANNOT_SEND);
        await mine.expectCodeBoxHidden();
        expect((await mock.requests({ to: outage, kind: 'sms' }))[0].response_status).toBe(500);
        expect((await readContactAs({ org: org.id, ...person })).phone_is_pageable).toBe(false);
      },
    );

    test(
      'UP-06 Resend waits out the gap, then the new code works and the old one does not',
      {
        tag: ['@P1'],
      },
      async () => {
        const phone = uniquePhone();
        await mine.goto(org.id);
        await mine.typePhone(phone);
        await mine.clickSendCode();
        await mine.expectCodeBoxVisible();
        const oldCode = await mock.lastCode(phone);

        testLogger.info('Expect Resend disabled with a number showing, then enabled again (V7)');
        await mine.expectResendCountingDown();
        await mine.waitForResendReady();
        await mine.clickResend();
        await mock.waitFor(phone, 'sms', { count: 2 });
        const newCode = await mock.lastCode(phone);
        expect(newCode, 'the resend must text a different code').not.toBe(oldCode);

        await mine.enterCode(oldCode);
        await mine.clickConfirm();
        testLogger.info('Expect the old code refused with the tries reset (V8)');
        await mine.expectPhoneError(WRONG_CODE);
        await mine.expectPhoneState('Not verified');

        await mine.enterCode(newCode);
        await mine.clickConfirm();
        await mine.expectPhoneState('Verified');
      },
    );

    test(
      'UP-07 only my own chips link to My on-call, and a missing phone is not red',
      {
        tag: ['@P1'],
      },
      async ({ page }) => {
        const { team, mate } = await withOrg(org.id, async () => {
          const teammate = await createPerson(page, prefix, 'mate');
          const created = await createTeam(page, { name: `${prefix}_team`, timezone: 'UTC' });
          await addTeamMembers(page, created.id, [person.email, teammate.email]);
          return { team: created, mate: teammate };
        });
        const screens = new PageManager(person.page);
        await screens.oncallTeamDetailPage.goto(org.id, team.id, 'members');

        testLogger.info('Expect own chips to link and carry the reason (U2, guide 6.1)');
        await mine.expectChipLinksToMine(person.email, 'sms', NO_PHONE_OWN);
        await mine.expectChipLinksToMine(person.email, 'voice', NO_PHONE_OWN);
        testLogger.info('Expect a teammate chip to carry the reason with no link (U2, guide 9)');
        await mine.expectChipDoesNotLink(mate.email, 'sms', NO_PHONE);
        await mine.expectChipDoesNotLink(mate.email, 'voice', NO_PHONE);

        testLogger.info('Expect no red while email lands (U5, S1)');
        await mine.expectReachableByEmailAndNotRed(person.email);
        await mine.expectReachableByEmailAndNotRed(mate.email);

        await mine.openOwnChip(person.email, 'sms');
      },
    );

    test(
      'UP-08 the On-Call menu reaches My on-call',
      {
        tag: ['@P2'],
      },
      async () => {
        await mine.gotoHome(org.id);
        await mine.openFromOnCallMenu();
        // o2-enterprise#3420 SC4: the spec keeps a profile menu entry the app removed, so only the On-Call menu is read.
        testLogger.info('Expect the On-Call menu entry to land on the phone card (U1)');
        await mine.expectPhoneCardVisible();
        await mine.expectProviderAvailable();
      },
    );

    test(
      "UP-09 with RBAC off my card works, and an admin still cannot write a teammate's phone",
      {
        tag: ['@P1'],
      },
      async ({ page }) => {
        const phone = uniquePhone();
        const mate = await withOrg(org.id, async () => await createPerson(page, prefix, 'mate'));

        testLogger.info("Expect 403 on someone else's phone, whatever the role (A11)");
        expect(await putContactStatusAs({ org: org.id, ...person }, mate.email, uniquePhone())).toBe(403);
        expect((await readContactAs({ org: org.id, ...mate })).phone ?? null, 'the refusal must leave no number').toBeNull();

        await mine.goto(org.id);
        await mine.expectPhoneUsable();
        await mine.typePhone(phone);
        await mine.clickSendCode();
        await mine.expectPhoneState('Not verified');
        await mine.expectCodeSentCopy(`Code sent to ${phone}. It works for 10 minutes.`);
      },
    );

    test(
      'UP-10 five wrong tries burn the code, so the right one is then refused',
      {
        tag: ['@P1'],
      },
      async () => {
        const phone = uniquePhone();
        await mine.goto(org.id);
        await mine.typePhone(phone);
        await mine.clickSendCode();
        await mine.expectCodeBoxVisible();

        const code = await mock.lastCode(phone);
        await mine.enterCode(`${code.slice(0, 5)}${(Number(code[5]) + 1) % 10}`);
        // o2-enterprise#3420 V-03: the spec does not say what the fifth wrong try hears, so any 400 passes.
        testLogger.info('Spend the five tries (V2)');
        for (let attempt = 0; attempt < 5; attempt += 1) {
          expect(await mine.clickConfirmAndWaitForAnswer()).toBe(400);
        }

        await mine.enterCode(code);
        await mine.clickConfirm();
        testLogger.info('Expect the too-many-tries sentence (guide 6.3, V8)');
        await mine.expectPhoneError(TOO_MANY_TRIES);
        await mine.expectPhoneState('Not verified');
        expect((await readContactAs({ org: org.id, ...person })).phone_is_pageable).toBe(false);
      },
    );

    test(
      'UP-11 asking again inside the gap opens the code box with the wait and texts nothing',
      {
        tag: ['@P1'],
      },
      async () => {
        const phone = uniquePhone();
        await mine.goto(org.id);
        await mine.typePhone(phone);
        await mine.clickSendCode();
        await mine.expectCodeBoxVisible();

        // A reload forgets the countdown, which is the only way past the disabled button to a real too_soon.
        await person.page.reload();
        await mine.expectPhoneState('Not verified');
        await mine.expectPhoneInputVisible();
        await mine.typePhone(phone);
        await mine.clickSendCode();
        testLogger.info('Expect the box and the timer next to Resend (guide 6.3, V7)');
        await mine.expectCodeBoxVisible();
        await mine.expectResendCountingDown();
        expect(await mock.requests({ to: phone, kind: 'sms' }), 'the refused send must not text').toHaveLength(1);
      },
    );

    test(
      'UP-12 the sixth code a person asks for says to wait',
      {
        tag: ['@P1'],
      },
      async () => {
        const blocked = uniquePhone();
        await sendCodesAs({ org: org.id, ...person }, Array.from({ length: 5 }, () => uniquePhone()));
        await mine.goto(org.id);
        await mine.expectPhoneState('Not verified');
        await mine.expectPhoneInputVisible();
        await mine.typePhone(blocked);
        await mine.clickSendCode();
        testLogger.info('Expect the limit sentence with no code box (guide 6.3, V7, V8)');
        await mine.expectPhoneError(USER_DAILY_LIMIT);
        await mine.expectCodeBoxHidden();
        expect(await mock.requests({ to: blocked }), 'the refused send must not text').toEqual([]);
      },
    );
  },
);
