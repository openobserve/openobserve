// Copyright 2026 OpenObserve Inc.

// Only the regression shard named Slack has the Slack app and the stand-in; a silence longer than the wait stops a repeat from hiding a lost first post.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const { api } = require('../../../pages/slackPages/index.js');
const { uniq, compositeAlert, firstRunFiringAlert } = require('../../utils/alerts-api-helpers.js');

const CHANNEL = { id: 'C0PWREG3270', name: 'sre-prod' };
const SILENCE_MINUTES = 10;
const FIRST_POST_WAIT_MS = 5 * 60 * 1000;
// The race loses a varying share of a batch fired together, so a small batch could pass by luck.
const BATCH_SIZE = 12;
const POST_WAIT = {
  timeout: FIRST_POST_WAIT_MS,
  message: `every alert must post before its ${SILENCE_MINUTES}-minute silence ends`,
};

test.describe(
  'Slack app alert posts (ENT#3270, ENT#3271)',
  {
    tag: ['@slack', '@alerts', '@regression'],
  },
  () => {
    // ENT#3270 loses a share of first posts at random, so a retry could turn a lost post green.
    test.describe.configure({ mode: 'serial', timeout: 9 * 60 * 1000, retries: 0 });

    let fx;

    test.beforeAll(async ({ playwright }) => {
      fx = await api.alertPostFixture(playwright, CHANNEL);
    });

    test.afterEach(async () => {
      await api.deleteFixtureAlerts(fx);
    });

    test.afterAll(async () => {
      if (fx) await api.disposeAlertPostFixture(fx);
    });

    test('ENT#3270 every new single-row alert posts its first Slack message on the run where it fires', async ({
      page,
    }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      const stem = uniq('slack_reg_single').toLowerCase();
      const names = Array.from({ length: BATCH_SIZE }, (_, i) => `${stem}_${String(i).padStart(2, '0')}`);
      const firing = { stream: fx.stream, destinations: [fx.destination], silence: SILENCE_MINUTES };
      for (const name of names) await api.createFixtureAlert(fx, firstRunFiringAlert(name, firing));

      await api.expectEveryAlertPosted(fx.request, fx.channelId, names, POST_WAIT);
      // Firing proves the alert ran, so a missing post is a lost post; ENT#3270's step 4 reads Alert History, which this does not open.
      await navigateToBase(page);
      await new PageManager(page).alertsPage.expectRowsFiring(fx.org, stem, names);
      for (const name of names) {
        const posts = await api.channelPostsNaming(fx.request, fx.channelId, name);
        expect(posts.length, `${name} posts one message, not a second one`).toBe(1);
      }
    });

    test('ENT#3271 a composite alert with a Slack app destination posts when it fires', async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      const stem = uniq('slack_reg_comp').toLowerCase();
      const silent = { stream: fx.stream, destinations: [], silence: SILENCE_MINUTES };
      const childIds = [];
      for (const suffix of ['c1', 'c2']) {
        childIds.push(await api.createFixtureAlert(fx, firstRunFiringAlert(`${stem}_${suffix}`, silent)));
      }
      const name = `${stem}_parent`;
      await api.createFixtureAlert(
        fx,
        compositeAlert(name, childIds, {
          enabled: true,
          destinations: [fx.destination],
          trigger_condition: { silence: SILENCE_MINUTES },
        }),
      );

      await api.expectEveryAlertPosted(fx.request, fx.channelId, [name], POST_WAIT);
      // ENT#3271's step 4 reads this list.
      await navigateToBase(page);
      await new PageManager(page).alertsPage.expectRowsFiring(fx.org, name, [name]);
      const posts = await api.channelPostsNaming(fx.request, fx.channelId, name);
      expect(posts.length, 'one message for the firing').toBe(1);
    });
  },
);
