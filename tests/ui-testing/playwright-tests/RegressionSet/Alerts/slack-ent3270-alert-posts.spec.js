// Copyright 2026 OpenObserve Inc.

// Only the regression shard named Slack has the Slack app and the stand-in; a silence longer than the wait stops a repeat from hiding a lost first post.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const { api } = require('../../../pages/slackPages/index.js');
const { uniq, simpleAlert, compositeAlert } = require('../../utils/alerts-api-helpers.js');

const CHANNEL = { id: 'C0PWREG3270', name: 'sre-prod' };
const SILENCE_MINUTES = 10;
const FIRST_POST_WAIT_MS = 5 * 60 * 1000;
// The race loses a varying share of a batch fired together, so a small batch could pass by luck.
const BATCH_SIZE = 12;

test.describe(
  'Slack app alert posts (ENT#3270, ENT#3271)',
  {
    tag: ['@slack', '@alerts', '@regression'],
  },
  () => {
    test.describe.configure({ mode: 'serial', timeout: 9 * 60 * 1000 });

    let request;
    let org;
    let destination;
    let stream;
    let alertIds = [];

    const v2 = (path) => `/api/v2/${org}/${path}`;

    test.beforeAll(async ({ playwright }) => {
      request = await playwright.request.newContext();
      const team = { teamId: `T0PWREG${api.uniq().toUpperCase()}`, teamName: 'Acme PW Regression' };
      const added = await request.post(`${api.MOCK()}/_mock/teams`, {
        data: {
          team_id: team.teamId,
          team_name: team.teamName,
          channels: [{ ...CHANNEL, is_private: false, is_member: true, is_shared: false }],
        },
      });
      expect(added.status(), 'the Slack stand-in must be running').toBe(200);
      ({ id: org } = await api.createOrg(request, 'slack_reg'));
      const { installation } = await api.storedHttpInstall(request, org, team);
      destination = `slack_reg_app_${api.uniq()}`;
      await api.ok(request, 'post', `/api/${org}/alerts/destinations`, {
        name: destination,
        type: 'slack_app',
        installation_id: installation.id,
        channel_id: CHANNEL.id,
        channel_name: CHANNEL.name,
        buttons: true,
        mention: 'default',
        refire_reuse_minutes: 30,
        auto_investigate: 'off',
        shared_channel_confirmed: false,
        oncall_room_confirmed: false,
      });
      stream = `slack_reg_${api.uniq()}`;
      await api.ok(request, 'post', `/api/${org}/${stream}/_json`, [
        { level: 'error' },
        { level: 'error' },
        { level: 'error' },
      ]);
    });

    test.afterEach(async () => {
      for (const id of alertIds.reverse()) {
        await api.call(request, 'delete', v2(`alerts/${id}?folder=default`));
      }
      alertIds = [];
    });

    test.afterAll(async () => {
      await api.call(request, 'delete', `/api/${org}/alerts/destinations/${encodeURIComponent(destination)}`);
      await request.dispose();
    });

    async function createAlert(payload) {
      await api.ok(request, 'post', v2('alerts?folder=default'), payload);
      const { list } = await api.ok(request, 'get', v2('alerts?folder=default&page_size=1000'));
      const id = list.find((row) => row.name === payload.name)?.alert_id;
      expect(id, `${payload.name} must be listable`).toBeTruthy();
      alertIds.push(id);
      return id;
    }

    function singleRow(name, destinations) {
      const alert = simpleAlert(name);
      alert.stream_name = stream;
      alert.destinations = destinations;
      alert.trigger_condition = {
        ...alert.trigger_condition,
        period: 5,
        frequency: 1,
        threshold: 1,
        silence: SILENCE_MINUTES,
      };
      return alert;
    }

    const postsNaming = async (name) => {
      const calls = await api.mockRequests(request, 'chat.postMessage');
      return calls.filter(
        (call) =>
          call.response &&
          call.form.channel === CHANNEL.id &&
          !call.form.thread_ts &&
          `${call.form.text}${call.form.attachments}`.includes(name),
      );
    };

    async function expectEveryAlertPosted(names) {
      const unposted = async () => {
        const posted = await Promise.all(names.map(async (name) => (await postsNaming(name)).length > 0));
        return names.filter((_, i) => !posted[i]);
      };
      await expect
        .poll(unposted, {
          message: `every alert must post before its ${SILENCE_MINUTES}-minute silence ends`,
          timeout: FIRST_POST_WAIT_MS,
          intervals: [3000],
        })
        .toEqual([]);
    }

    // Firing proves the alert ran, so a missing post is a lost post; ENT#3271's step 4 reads this list, ENT#3270's reads Alert History, which this does not open.
    async function expectFiringInList(page, search, names) {
      const pm = new PageManager(page);
      await navigateToBase(page);
      await expect(async () => {
        await page.goto(`/web/alerts?org_identifier=${org}&folder=default`);
        await pm.alertsPage.searchAlert(search);
        for (const name of names) {
          await expect(pm.alertsPage.rowLastOutcome(name)).toHaveText(/firing/i, { timeout: 5000 });
        }
      }).toPass({ timeout: 60000 });
    }

    test('ENT#3270 every new single-row alert posts its first Slack message on the run where it fires', async ({
      page,
    }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      const stem = uniq('slack_reg_single').toLowerCase();
      const names = Array.from({ length: BATCH_SIZE }, (_, i) => `${stem}_${String(i).padStart(2, '0')}`);
      for (const name of names) await createAlert(singleRow(name, [destination]));

      await expectEveryAlertPosted(names);
      await expectFiringInList(page, stem, names);
      for (const name of names) {
        expect((await postsNaming(name)).length, `${name} posts one message, not a second one`).toBe(1);
      }
    });

    test('ENT#3271 a composite alert with a Slack app destination posts when it fires', async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      const stem = uniq('slack_reg_comp').toLowerCase();
      const childIds = [];
      for (const suffix of ['c1', 'c2']) childIds.push(await createAlert(singleRow(`${stem}_${suffix}`, [])));
      const name = `${stem}_parent`;
      await createAlert(
        compositeAlert(name, childIds, {
          enabled: true,
          destinations: [destination],
          trigger_condition: { silence: SILENCE_MINUTES },
        }),
      );

      await expectEveryAlertPosted([name]);
      await expectFiringInList(page, name, [name]);
      expect((await postsNaming(name)).length, 'one message for the firing').toBe(1);
    });
  },
);
