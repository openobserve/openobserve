/**
 * Logs No-Stream Quick Pick — E2E suite
 *
 * Verifies that when a user navigates to the Logs page without a pre-selected stream,
 * the UI surfaces two complementary quick-pick surfaces:
 *   1. Sidebar quick pick — up to 8 one-click stream buttons (IndexList)
 *   2. Hero-state quick pick — action cards + recent-stream chips (LogsNoStreamState)
 *
 * Test coverage:
 *   - TC-QP-001: Quick pick a stream from the sidebar
 *   - TC-QP-002: Hero state appears on fresh arrival
 *   - TC-QP-003: Hero "Select a stream" card opens the stream dropdown
 *   - TC-QP-004: Deselect a stream, quick pick reappears, re-select works
 *   - TC-QP-005: Quick pick "X more" footer (conditional, org must have > 8 streams)
 *   - TC-QP-006: Hero "Recent:" chip selects stream (gated on localStorage seeding)
 *   - TC-QP-007: "Read the query guide" card opens documentation in new tab
 */
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe("Logs No-Stream Quick Pick testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // Navigate to logs page WITHOUT a stream query param — triggers the
    // no-stream-selected state which renders both the sidebar quick pick
    // and the main-content hero cards.
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  // ── P0: Quick Pick a stream from the sidebar ────────────────────────
  test("should quick pick a stream from the sidebar", {
    tag: ['@logs-stream-quick-pick', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing quick pick stream selection from the sidebar');

    // Wait for the sidebar quick pick container to become visible
    await pm.logsPage.expectQuickPickContainerVisible();

    // Click the quick pick button for e2e_automate
    await pm.logsPage.clickQuickPickButton('e2e_automate');

    // After selection the quick pick container should disappear
    await pm.logsPage.expectQuickPickContainerNotVisible();

    // Verify the stream dropdown now shows the selected stream name
    await pm.logsPage.expectStreamDropdownShowsStream('e2e_automate');

    // Wait for field list to load (or "no field found" to appear)
    await pm.logsPage.waitForFieldListAfterStreamSelection();

    testLogger.info('Quick pick stream selection completed');
  });

  // ── P0: Hero state appears on fresh arrival ────────────────────────
  test("should show hero state on fresh arrival with no stream selected", {
    tag: ['@logs-stream-quick-pick', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing hero state visibility on fresh arrival');

    // Wait for the hero container to be visible in the main content area
    await pm.logsPage.expectNoStreamHeroVisible();

    // Assert both action cards are present
    await pm.logsPage.expectSelectStreamCardVisible();
    await pm.logsPage.expectQueryGuideCardVisible();

    testLogger.info('Hero state verified');
  });

  // ── P1: Hero "Select a stream" card opens the stream dropdown ──────
  test("should open stream dropdown when clicking select stream card", {
    tag: ['@logs-stream-quick-pick', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing select stream card opens the stream dropdown');

    // Hero card must be visible first
    await pm.logsPage.expectNoStreamHeroVisible();
    await pm.logsPage.expectSelectStreamCardVisible();

    // Click the card — should trigger onSelectStream() which opens the dropdown
    await pm.logsPage.clickSelectStreamCard();

    // Verify the stream dropdown popover opened
    await pm.logsPage.expectStreamDropdownPopoverVisible();

    testLogger.info('Dropdown opened via select stream card');
  });

  // ── P1: Deselect, quick pick reappears, re-select works ────────────
  test("should reappear quick pick after deselecting and re-select works", {
    tag: ['@logs-stream-quick-pick', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing deselect and re-pick workflow');

    // Step 1: Select a stream via quick pick
    await pm.logsPage.expectQuickPickContainerVisible();
    await pm.logsPage.clickQuickPickButton('e2e_automate');
    await pm.logsPage.expectQuickPickContainerNotVisible();
    await pm.logsPage.expectStreamDropdownShowsStream('e2e_automate');

    // Step 2: Deselect the stream. The logs stream OSelect is multi-mode with
    // rowClickSingleSelect, so clearing the single selection requires clicking the
    // option's checkbox zone (see deselectStreamViaCheckbox), not the option row.
    await pm.logsPage.deselectStreamViaCheckbox('e2e_automate');

    // Step 3: Quick pick should reappear in the sidebar
    await pm.logsPage.expectQuickPickContainerVisible();

    // Step 4: Re-select the same stream via quick pick
    await pm.logsPage.clickQuickPickButton('e2e_automate');
    await pm.logsPage.expectQuickPickContainerNotVisible();
    await pm.logsPage.expectStreamDropdownShowsStream('e2e_automate');

    // Verify field list loads after re-selection
    await pm.logsPage.waitForFieldListAfterStreamSelection();

    testLogger.info('Deselect and re-pick workflow completed');
  });

  // ── P2: Quick pick "X more" footer (seeds > 8 streams, then verifies) ─
  // QUICK_PICK_LIMIT is 8 (IndexList.vue). The quick pick caps at 8 buttons and
  // shows a "Search above for N more" footer whenever the org has more than 8
  // logs streams. This test CREATES 9 streams so the condition always holds, then
  // asserts the cap + footer.
  //
  // Stream names carry a per-run unique token (e2e_qp_more_stream_<token>_N) so
  // repeat/parallel runs never collide with a still-deleting same-named stream
  // (stream deletion in OpenObserve is async). Freshly-ingested streams have no
  // stats yet, so they sort to the bottom of the quick pick and never displace
  // already-active streams (e.g. e2e_automate) that sibling tests rely on. The
  // seeds are swept by cleanup.spec.js via the `e2e_qp_more_stream_` prefix.
  test("should create more than 8 streams and show the quick pick more footer", {
    tag: ['@logs-stream-quick-pick', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing quick pick more footer with seeded streams');

    const QUICK_PICK_LIMIT = 8;
    const runToken = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const seedPrefix = `e2e_qp_more_stream_${runToken}_`;

    // Create one more than the limit so streamList always exceeds it.
    const seededStreams = await pm.logsPage.seedLogStreams(seedPrefix, QUICK_PICK_LIMIT + 1);
    await pm.logsPage.waitForStreamsListed(seededStreams);

    // Reload the no-stream logs page so the stream list picks up the new streams.
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    await pm.logsPage.expectQuickPickContainerVisible();

    // The quick pick must cap visible stream buttons at the limit.
    const count = await pm.logsPage.getQuickPickButtonCount();
    expect(count, 'Quick pick should cap visible buttons at the limit (8)').toBe(QUICK_PICK_LIMIT);

    // The "more" footer must be visible and report a positive remaining count.
    await pm.logsPage.expectQuickPickMoreFooterVisible();
    const footerText = await page.locator(pm.logsPage.quickPickMoreFooter).innerText();
    expect(footerText, 'More footer should report a remaining count').toMatch(/\d+/);

    testLogger.info(`Quick pick more footer verified (${footerText.trim()})`);
  });

  // ── P2: Hero "Recent:" chip selects stream and triggers search ─────
  test("should select stream via hero recent chip", {
    tag: ['@logs-stream-quick-pick', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing hero recent chip stream selection');

    const orgId = getOrgIdentifier();

    // Seed localStorage with a recent stream entry BEFORE navigation so that
    // restoreLogsStream() picks it up when the page mounts. The key is
    // `oo_selected_stream_logs_<orgId>` and the value is a string[] (see streamPersist.ts:3-4,10-13).
    await page.evaluate((oid) => {
      localStorage.setItem(
        `oo_selected_stream_logs_${oid}`,
        JSON.stringify(["e2e_automate"])
      );
    }, orgId);

    // Re-navigate to pick up the localStorage-seeded recent streams.
    // The beforeEach already navigated, but the localStorage was not set yet
    // at that point, so we must go again.
    await page.goto(`${logData.logsUrl}?org_identifier=${orgId}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Hero state must be visible with the recent chip
    await pm.logsPage.expectNoStreamHeroVisible();
    await pm.logsPage.expectRecentChipVisible('e2e_automate');

    // Click the recent chip — should select the stream and trigger a search
    await pm.logsPage.clickRecentChip('e2e_automate');

    // Verify the stream was selected: the quick pick disappears and the
    // dropdown shows the stream name
    await pm.logsPage.expectQuickPickContainerNotVisible();
    await pm.logsPage.expectStreamDropdownShowsStream('e2e_automate');

    // Wait for the field list to load (confirms the stream selection completed)
    await pm.logsPage.waitForFieldListAfterStreamSelection();

    testLogger.info('Hero recent chip selection completed');
  });

  // ── P2: "Read the query guide" card opens documentation ────────────
  test("should open query guide documentation in new tab", {
    tag: ['@logs-stream-quick-pick', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing query guide card opens documentation');

    await pm.logsPage.expectNoStreamHeroVisible();
    await pm.logsPage.expectQueryGuideCardVisible();

    // Set up a popup listener BEFORE clicking, so we capture the new tab
    // that window.open() creates (LogsNoStreamState.vue:55)
    const pagePromise = page.context().waitForEvent('page');

    await pm.logsPage.clickQueryGuideCard();

    // Wait for the new page to be created and load
    const newPage = await pagePromise;
    await newPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

    // The card opens https://openobserve.ai/docs/example-queries/ which
    // redirects to /docs/user-guide/data-exploration/example-queries/.
    // Accept any URL under openobserve.ai that contains "example-queries".
    expect(
      newPage.url(),
      'New tab URL should point to openobserve query guide docs'
    ).toMatch(/openobserve\.ai\/.*example-queries/);

    // Clean up the new tab
    await newPage.close().catch(() => {});

    testLogger.info('Query guide card verified — docs opened in new tab');
  });
});
