/**
 * Dashboard TV Playlist E2E Tests
 *
 * Covers PR #15357 (feat: TV playlist for dashboards): the "TV playlist" bulk
 * action on the dashboards list, its setup dialog, and the rotating player at
 * /web/dashboards/tv?playlist=<dash>:<folder>,…&interval=…&slide=N.
 */

import { test, expect, navigateToBase } from "../utils/enhanced-baseFixtures.js";
import testLogger from "../utils/test-logger.js";
import PageManager from "../../pages/page-manager.js";

test.describe.configure({ mode: "parallel" });

const uniqueSeed = () => `e2e_tvpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

test.describe("Dashboard TV playlist testcases", () => {
  let pm;
  let seed;
  let folderA;
  let folderB;
  let dashboardsA = [];
  let dashboardsB = [];

  const entriesOf = (dashboards, folder) =>
    dashboards.map((d) => ({ dashboardId: d.dashboardId, folderId: folder.folderId }));

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    seed = uniqueSeed();
    folderA = await pm.apiCleanup.createDashboardFolder(`${seed}_A`);
    folderB = await pm.apiCleanup.createDashboardFolder(`${seed}_B`);
    dashboardsA = await pm.apiCleanup.seedDashboardsInFolder(folderA.folderId, 3, `${seed}_a`);
    dashboardsB = await pm.apiCleanup.seedDashboardsInFolder(folderB.folderId, 1, `${seed}_far`);
    testLogger.info("Seeded playlist dashboards", { seed });
  });

  test.afterEach(async () => {
    // A folder delete is rejected while it still holds dashboards.
    for (const dash of dashboardsA) {
      await pm.apiCleanup.deleteDashboard(dash.dashboardId, folderA.folderId);
    }
    for (const dash of dashboardsB) {
      await pm.apiCleanup.deleteDashboard(dash.dashboardId, folderB.folderId);
    }
    await pm.apiCleanup.deleteDashboardFolder(folderA.folderId);
    await pm.apiCleanup.deleteDashboardFolder(folderB.folderId);
  });

  test(
    "should open the TV playlist dialog with the selected dashboards in tick order and default settings",
    { tag: ["@dashboardTvPlaylist", "@smoke", "@P0", "@all"] },
    async () => {
      const [first, second, third] = dashboardsA;

      await pm.dashboardTvPlaylist.gotoFolder(folderA.folderId);
      await pm.dashboardTvPlaylist.selectDashboards([third.title, first.title]);
      await pm.dashboardTvPlaylist.openPlaylistDialog();

      await pm.dashboardTvPlaylist.expectItemTitles([third.title, first.title]);
      await pm.dashboardTvPlaylist.expectCountText("2 of 50");
      await pm.dashboardTvPlaylist.expectMoveButtonsAtEdges(1);
      await pm.dashboardTvPlaylist.expectDefaultSettings();
      testLogger.info("Dialog opened with tick-ordered dashboards", { unselected: second.title });
    }
  );

  test(
    "should launch the TV player in a new tab with the playlist encoded in the URL",
    { tag: ["@dashboardTvPlaylist", "@smoke", "@P0", "@all"] },
    async () => {
      const [first, second] = dashboardsA;

      await pm.dashboardTvPlaylist.gotoFolder(folderA.folderId);
      await pm.dashboardTvPlaylist.selectDashboards([first.title, second.title]);
      await pm.dashboardTvPlaylist.openPlaylistDialog();

      const tvPage = await pm.dashboardTvPlaylist.openPlaylist();
      try {
        await pm.dashboardTvPlaylist.expectDialogClosed();

        const url = new URL(tvPage.url());
        expect(url.pathname).toMatch(/\/web\/dashboards\/tv$/);
        expect(url.searchParams.get("playlist")).toBe(
          `${first.dashboardId}:${folderA.folderId},${second.dashboardId}:${folderA.folderId}`
        );
        expect(url.searchParams.get("interval")).toBe("1m");
        expect(url.searchParams.get("slide")).toBe("1");
        expect(url.searchParams.get("period")).toBe("1h");

        const tv = new PageManager(tvPage).dashboardTvPlaylist;
        await tv.expectPlayerReady();
        await tv.expectSlide(first.title, 1, 2);
        await tv.expectControlsVisible();
        await tv.expectTimeRangeLabelVisible();
      } finally {
        await tvPage.close();
      }
    }
  );

  test(
    "should reorder and remove dashboards and disable Open when the playlist is empty",
    { tag: ["@dashboardTvPlaylist", "@P1", "@all"] },
    async () => {
      const [first, second, third] = dashboardsA;

      await pm.dashboardTvPlaylist.gotoFolder(folderA.folderId);
      await pm.dashboardTvPlaylist.selectDashboards([first.title, second.title, third.title]);
      await pm.dashboardTvPlaylist.openPlaylistDialog();
      await pm.dashboardTvPlaylist.expectItemTitles([first.title, second.title, third.title]);

      await pm.dashboardTvPlaylist.moveItemDown(0);
      await pm.dashboardTvPlaylist.expectItemTitles([second.title, first.title, third.title]);

      await pm.dashboardTvPlaylist.moveItemUp(2);
      await pm.dashboardTvPlaylist.expectItemTitles([second.title, third.title, first.title]);

      await pm.dashboardTvPlaylist.removeItem(1);
      await pm.dashboardTvPlaylist.expectItemTitles([second.title, first.title]);
      await pm.dashboardTvPlaylist.expectCountText("2 of 50");

      await pm.dashboardTvPlaylist.removeItem(0);
      await pm.dashboardTvPlaylist.removeItem(0);
      await pm.dashboardTvPlaylist.expectCountText("0 of 50");
      await pm.dashboardTvPlaylist.expectEmptyPlaylist();
    }
  );

  test(
    "should add a dashboard from another folder through the dialog search",
    { tag: ["@dashboardTvPlaylist", "@P1", "@all"] },
    async () => {
      const [first] = dashboardsA;
      const [far] = dashboardsB;

      await pm.dashboardTvPlaylist.gotoFolder(folderA.folderId);
      await pm.dashboardTvPlaylist.selectDashboards([first.title]);
      await pm.dashboardTvPlaylist.openPlaylistDialog();

      await pm.dashboardTvPlaylist.searchDashboards(`${seed}_far`);
      await pm.dashboardTvPlaylist.addSearchResult(far.dashboardId);

      await pm.dashboardTvPlaylist.expectItemTitles([first.title, far.title]);
      await pm.dashboardTvPlaylist.expectCountText("2 of 50");
      await pm.dashboardTvPlaylist.expectSearchResultAdded(far.dashboardId);
    }
  );

  test(
    "should carry interval, time range, theme and fit into the copied playlist link",
    { tag: ["@dashboardTvPlaylist", "@P1", "@all"] },
    async () => {
      const [first, second] = dashboardsA;

      await pm.dashboardTvPlaylist.gotoFolder(folderA.folderId);
      await pm.dashboardTvPlaylist.selectDashboards([first.title, second.title]);
      await pm.dashboardTvPlaylist.openPlaylistDialog();

      await pm.dashboardTvPlaylist.selectInterval(10);
      await pm.dashboardTvPlaylist.selectPeriod("15m");
      await pm.dashboardTvPlaylist.selectTheme("dark");
      await pm.dashboardTvPlaylist.toggleFit();

      const link = new URL(await pm.dashboardTvPlaylist.copyLink());
      testLogger.info("Copied playlist link", { link: link.toString() });
      expect(link.pathname).toMatch(/\/web\/dashboards\/tv$/);
      expect(link.searchParams.get("playlist")).toBe(
        `${first.dashboardId}:${folderA.folderId},${second.dashboardId}:${folderA.folderId}`
      );
      expect(link.searchParams.get("interval")).toBe("10s");
      expect(link.searchParams.get("period")).toBe("15m");
      expect(link.searchParams.get("theme")).toBe("dark");
      expect(link.searchParams.get("fit")).toBe("true");

      await pm.dashboardTvPlaylist.selectPeriod("own");
      const ownDefaultLink = new URL(await pm.dashboardTvPlaylist.copyLink());
      expect(ownDefaultLink.searchParams.has("period")).toBe(false);
    }
  );

  test(
    "should move between slides with the previous and next controls and exit to the dashboards list",
    { tag: ["@dashboardTvPlaylist", "@P0", "@all"] },
    async () => {
      const [first, second, third] = dashboardsA;
      const tv = pm.dashboardTvPlaylist;

      await tv.gotoPlaylist({ entries: entriesOf(dashboardsA, folderA), interval: "1h" });
      await tv.expectPlayerReady();
      await tv.expectSlide(first.title, 1, 3);

      await tv.clickNext();
      await tv.expectSlide(second.title, 2, 3);
      await tv.expectSlideParam(2);

      await tv.clickNext();
      await tv.expectSlide(third.title, 3, 3);
      await tv.expectSlideParam(3);

      await tv.clickNext();
      await tv.expectSlide(first.title, 1, 3);
      await tv.expectSlideParam(1);

      await tv.clickPrev();
      await tv.expectSlide(third.title, 3, 3);
      await tv.expectSlideParam(3);

      await tv.clickExit();
      await tv.expectExitedToDashboards();
    }
  );

  test(
    "should pause and resume rotation and respond to the keyboard shortcuts",
    { tag: ["@dashboardTvPlaylist", "@P1", "@all"] },
    async () => {
      const [first, second] = dashboardsA;
      const tv = pm.dashboardTvPlaylist;

      await tv.gotoPlaylist({ entries: entriesOf(dashboardsA, folderA), interval: "10s" });
      await tv.expectPlayerReady();
      await tv.expectSlide(first.title, 1, 3);

      await tv.togglePause();
      await tv.expectPaused(true);
      await tv.expectSlideHeldWhilePaused(first.title, 1, 13000);

      await tv.togglePause();
      await tv.expectPaused(false);

      await tv.pressKey("Space");
      await tv.expectPaused(true);
      await tv.pressKey("Space");
      await tv.expectPaused(false);

      await tv.pressKey("ArrowRight");
      await tv.expectSlide(second.title, 2, 3);
      await tv.expectSlideParam(2);

      await tv.pressKey("ArrowLeft");
      await tv.expectSlide(first.title, 1, 3);
      await tv.expectSlideParam(1);

      await tv.pressKey("Escape");
      await tv.expectExitedToDashboards();
    }
  );

  test(
    "should rotate to the next slide after the interval and resume on the same slide after reload",
    { tag: ["@dashboardTvPlaylist", "@P1", "@all"] },
    async ({ page }) => {
      const [first, second] = dashboardsA;
      const tv = pm.dashboardTvPlaylist;

      await tv.gotoPlaylist({ entries: entriesOf(dashboardsA, folderA), interval: "10s" });
      await tv.expectPlayerReady();
      await tv.expectSlide(first.title, 1, 3);

      await tv.expectSlide(second.title, 2, 3, 90000);
      await tv.expectSlideParam(2);

      await tv.togglePause();
      await page.reload();
      await tv.expectPlayerReady();
      await tv.expectSlide(second.title, 2, 3);
      await tv.expectSlideParam(2);
    }
  );

  test(
    "should show the invalid-link state when the URL names no dashboards",
    { tag: ["@dashboardTvPlaylist", "@P2", "@all"] },
    async () => {
      const tv = pm.dashboardTvPlaylist;

      await tv.gotoPlaylist({});
      await tv.expectInvalidLink();

      await tv.clickInvalidLinkAction();
      await tv.expectExitedToDashboards();
    }
  );

  test(
    "should clamp an interval below the minimum and tell the viewer",
    { tag: ["@dashboardTvPlaylist", "@P2", "@all"] },
    async () => {
      const [first] = dashboardsA;
      const tv = pm.dashboardTvPlaylist;

      await tv.gotoPlaylist({ entries: entriesOf(dashboardsA, folderA), interval: "3s" });
      await tv.expectIntervalNotice("Interval adjusted to");
      await tv.expectPlayerReady();
      await tv.expectSlide(first.title, 1, 3);
      await tv.expectIntervalParam("10s");
    }
  );

  test(
    "should skip a deleted dashboard and show the empty state when none are available",
    { tag: ["@dashboardTvPlaylist", "@P2", "@all"] },
    async () => {
      const [first] = dashboardsA;
      const tv = pm.dashboardTvPlaylist;
      const missing = { dashboardId: `${seed}_missing`, folderId: folderA.folderId };

      await tv.gotoPlaylist({
        entries: [missing, { dashboardId: first.dashboardId, folderId: folderA.folderId }],
        interval: "1h",
      });
      await tv.expectPlayerReady();
      await tv.expectSlide(first.title, 1, 1, 60000);

      await tv.gotoPlaylist({ entries: [missing], interval: "1h" });
      await tv.expectEmptyState();
    }
  );
});
