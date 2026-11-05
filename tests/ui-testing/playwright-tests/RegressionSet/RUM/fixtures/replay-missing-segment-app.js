const { nextReplayUpload, rumContext } = require('./multi-tab-replay-app.js');

const SELECTORS = {
  addEntryBtn: '[data-test="sg-add-entry-btn"]',
  refreshReportBtn: '[data-test="sg-refresh-report-btn"]',
};
const REPLAY_INTAKE = '**/rum/v1/*/replay*';
const FEED_PAGE = { heading: 'Order feed' };
const REPORT_PAGE = { heading: 'Daily report', lastStatus: 'Report refreshed 8 times' };
const ENTRIES_PER_SEGMENT = 2;
const REPORT_REFRESHES_PER_SEGMENT = 4;

async function openPage(page, url) {
  const recorder = page.waitForResponse((r) => r.url().includes('/sdk/chunks/recorder-') && r.ok(), { timeout: 30000 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await recorder;
  await page.waitForFunction(() => Boolean(window.O2_RUM?.getInternalContext()?.session_id), null, { timeout: 30000 });
}

async function clickTimes(page, selector, times) {
  for (let i = 0; i < times; i += 1) await page.locator(selector).click();
}

async function recordSessionWithLostSegments(context, server, org, { feedSegments, dropFeedUploads }) {
  let uploadsSeen = 0;
  const dropped = [];
  // A failed upload is retried by the SDK, so only an answered one is really lost.
  await context.route(REPLAY_INTAKE, async (route) => {
    const index = uploadsSeen;
    uploadsSeen += 1;
    if (dropFeedUploads.includes(index)) {
      dropped.push(index);
      await route.fulfill({ status: 200, body: '{}' });
      return;
    }
    await route.fallback();
  });

  const page = await context.newPage();
  await openPage(page, server.feedUrl);
  for (let segment = 0; segment < feedSegments; segment += 1) {
    const upload = nextReplayUpload(page, org);
    await clickTimes(page, SELECTORS.addEntryBtn, ENTRIES_PER_SEGMENT);
    await upload;
  }
  const feed = await rumContext(page);

  await openPage(page, server.reportUrl);
  for (let segment = 0; segment < 2; segment += 1) {
    const upload = nextReplayUpload(page, org);
    await clickTimes(page, SELECTORS.refreshReportBtn, REPORT_REFRESHES_PER_SEGMENT);
    await upload;
  }
  // A live session's newest segment is held back by the player, so one more segment must follow the last refresh.
  const trailing = nextReplayUpload(page, org);
  await page.locator(SELECTORS.refreshReportBtn).hover();
  await trailing;
  const report = await rumContext(page);

  return {
    sessionId: report.session_id,
    sameSession: feed.session_id === report.session_id,
    feedViewId: feed.view.id,
    reportViewId: report.view.id,
    dropped,
    uploads: uploadsSeen,
  };
}

module.exports = { recordSessionWithLostSegments, FEED_PAGE, REPORT_PAGE };
