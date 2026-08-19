/**
 * Logs Build tab — stream list loads without a preselected stream
 *
 * Regression cover for openobserve/openobserve#13812
 * ("fix(logs): load the stream list on Visualize when no stream is selected").
 *
 * The Build toggle mounts BuildQueryPage → PanelEditor(editMode: true) →
 * PanelFieldList with pageKey "build". PanelFieldList deferred its stream-list
 * fetch until a stream was already set, because edit mode is normally reached
 * from a saved panel whose data arrives asynchronously.
 *
 * The Build tab is not that. `ZO_QUERY_ON_STREAM_SELECTION` defaults to true, so
 * the logs page selects nothing until the user does — Build therefore mounts with
 * a blank stream, and its Stream select is the user's own (read-only only when the
 * page key is "logs", i.e. the Visualize tab). Deferring left that select enabled,
 * openable and permanently empty on "No options found", with no way to pick a
 * stream and so no way out.
 *
 * The fix adds "build" to STREAM_LIST_WITHOUT_STREAM alongside "metrics". Arming
 * that initial load also arms the stream_type watcher (it is gated on
 * `initialStreamsLoaded`), so changing Stream Type with a blank stream refetches
 * instead of silently no-op'ing.
 *
 * Neither test picks a stream on the logs page first — that IS the precondition
 * the bug needed.
 *
 * @tags @logs @queryBuilder @all
 */

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestForQueryBuilderTest } = require('../utils/queryBuilder-helpers.js');

const STREAM_NAME = 'e2e_automate';

test.describe("Logs Build Tab - Stream List Without A Preselected Stream", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeAll(async ({ request }) => {
        // The Build tab's stream dropdown must have a real logs stream to offer.
        await ingestForQueryBuilderTest(request);
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await page.goto(`/web/logs?org_identifier=${process.env["ORGNAME"] ?? "default"}`);
        await page.waitForLoadState('domcontentloaded');

        // Deliberately NO selectStream() call here. Guard the precondition instead:
        // if an environment ever pre-seeds a stream on the logs page, Build would
        // mount with a stream already set and both tests below would pass against
        // the buggy build without exercising anything.
        await pm.logsPage.expectNoLogsStreamSelected();
    });

    test("Build tab stream dropdown is populated and usable when no stream is selected on the logs page", {
        tag: ['@queryBuilder', '@functional', '@P0', '@all', '@logs']
    }, async () => {
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // The select defaults to logs and is the user's own control here — the bug
        // was an enabled, openable, permanently empty dropdown, not a disabled one.
        await pm.logsPage.expectBuildStreamType('logs');
        await pm.logsPage.expectBuildStreamDropdownEditable();

        await pm.logsPage.openBuildStreamDropdown();

        // The regression itself: the list never loaded, so OSelect fell through to
        // its empty state.
        await pm.logsPage.expectBuildStreamListPopulated();

        // The ingested stream is actually offered, not just "some" options.
        await pm.logsPage.expectBuildStreamOptionVisible(STREAM_NAME);

        // "no way to pick one" was the user-visible symptom, so assert the pick
        // lands rather than stopping at the list being non-empty.
        await pm.logsPage.clickBuildStreamOption(STREAM_NAME);
        await pm.logsPage.expectBuildStreamSelected(STREAM_NAME);

        // And the selection propagates: the field list loads that stream's schema.
        await pm.logsPage.expectBuildFieldListPopulated();

        testLogger.info('Build tab stream list loaded and selectable without a preselected stream');
    });

    test("Build tab stream list refreshes when the stream type changes with no stream selected", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async () => {
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Baseline: under "logs" the ingested stream is listed.
        await pm.logsPage.openBuildStreamDropdown();
        await pm.logsPage.expectBuildStreamOptionVisible(STREAM_NAME);
        await pm.logsPage.closeBuildStreamDropdown();

        // Switching type must refetch. `e2e_automate` is ingested as a LOGS stream,
        // so a traces list that still offers it means the list was never refreshed —
        // this is what the un-armed stream_type watcher used to do.
        await pm.logsPage.selectBuildStreamType('traces');
        await pm.logsPage.expectBuildStreamType('traces');

        await pm.logsPage.openBuildStreamDropdown();
        // A real traces list arrived — not merely an empty one. Global setup ingests
        // traces for every shard, so this pins "refetched" rather than "cleared".
        await pm.logsPage.expectBuildStreamListPopulated();
        await pm.logsPage.expectBuildStreamOptionAbsent(STREAM_NAME);
        await pm.logsPage.closeBuildStreamDropdown();

        // Switching back restores it — the watcher fires on every change, not once.
        await pm.logsPage.selectBuildStreamType('logs');
        await pm.logsPage.expectBuildStreamType('logs');

        await pm.logsPage.openBuildStreamDropdown();
        await pm.logsPage.expectBuildStreamOptionVisible(STREAM_NAME);

        testLogger.info('Build tab stream list refreshed on every stream type change');
    });
});
