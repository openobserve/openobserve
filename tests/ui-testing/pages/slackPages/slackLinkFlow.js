// One-click linking end to end: an unlinked Slack user mentions the bot, the bot sends the link, the browser follows it.
const { expect } = require('@playwright/test');
const api = require('./slackApi.js');

const SLACK_USER = { user_id: 'U0DANA', email: 'dana@acme.test' };

/** Sets up an HTTP-mode workspace in `org` and returns a fresh `r` (id.sig) from the bot's link prompt. */
async function linkRequestFromSlack(request, org, team) {
  const { installation, signingSecret } = await api.storedHttpInstall(request, org, team);
  const since = Date.now() / 1000;
  const status = await api.sendSlackEvent(request, {
    signingSecret,
    appId: installation.app_id,
    teamId: team.teamId,
    event: {
      type: 'app_mention',
      user: SLACK_USER.user_id,
      channel: 'C0ALERTS',
      text: '<@U0BOT> why is checkout slow?',
      ts: `${Math.floor(since)}.000100`,
    },
  });
  expect(status, 'inbound app_mention accepted').toBe(200);
  return { installation, r: await api.waitForLinkRequest(request, since) };
}

/** Opens the link like the Slack user would and records every top-level URL the page visits. */
async function followLink(context, page, slack, team, r, org) {
  const visited = [];
  const onNav = (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  };
  page.on('framenavigated', onNav);
  const unroute = await api.routeSlackAuthorize(context, { team_id: team.teamId, ...SLACK_USER });
  try {
    await slack.link.openLink(r, org);
    await expect(slack.link.linked).toBeVisible({ timeout: 30000 });
  } finally {
    await unroute();
    page.off('framenavigated', onNav);
  }
  return visited;
}

/** Polls the mock for the bot's DM to the Slack user (chat.postMessage to the user id) whose blocks contain `needle`. */
async function waitForDm(request, needle, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dms = (await api.mockRequests(request, 'chat.postMessage')).filter(
      (c) => c.form.channel === SLACK_USER.user_id && String(c.form.blocks || '').includes(needle),
    );
    if (dms.length) return dms[dms.length - 1].form;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no DM to ${SLACK_USER.user_id} carrying ${needle}`);
}

module.exports = { SLACK_USER, linkRequestFromSlack, followLink, waitForDm };
