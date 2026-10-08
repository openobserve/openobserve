const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");

const LANGUAGE_COOKIE = "vue3-typescript-admin-languageKey";
const LOCALES = ["de", "ru", "nl", "pl", "es", "pt", "tr", "fr", "it"];
const PROFILE = '[data-test="header-my-account-profile-icon"]';
const ROW = '[data-test="header-language-submenu-trigger"]';
const LIST = '[data-test="language-dropdown-item"]';
const EN_OPTION = '[data-test="language-dropdown-item-en-us"]';
const TILE = '[data-test^="menu-link-"][data-test$="-item"]';

async function setLanguageCookie(page, code) {
  const url = new URL(process.env.ZO_BASE_URL);
  await page.context().addCookies([
    { name: LANGUAGE_COOKIE, value: code, domain: url.hostname, path: "/" },
  ]);
}

/** Picks English again, so the stored language never changes between specs. */
async function reloadThroughLanguageMenu(page) {
  await page.locator(PROFILE).click();
  await page.locator(ROW).click();
  await expect(page.locator(LIST)).toBeVisible();
  await page.locator(EN_OPTION).click();
}

test.describe("Nav rail: locales and language reload", () => {
  // Every case sets its own language cookie, so one failure must not skip the rest.

  for (const code of LOCALES) {
    test(`rail labels in ${code} are never clipped without an ellipsis (AC-11)`, async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await page.setViewportSize({ width: 1440, height: 900 });
      await setLanguageCookie(page, code);
      await navigateToBase(page);
      const tiles = page.locator(`nav ${TILE}`);
      await expect(tiles.first()).toBeVisible();

      const report = await tiles.evaluateAll((els) =>
        els.map((el) => {
          const label = el.querySelector(".nav-menu-item-label");
          if (!label) return null;
          // Same measure the product uses: a clamped box hides a too-wide word from scrollWidth, the Range sees it.
          const range = document.createRange();
          range.selectNodeContents(label);
          const overflows =
            label.scrollHeight > label.clientHeight ||
            range.getBoundingClientRect().width > label.getBoundingClientRect().width;
          return {
            id: el.getAttribute("data-test"),
            overflows,
            truncated: el.getAttribute("data-truncated") === "true",
            ellipsis: getComputedStyle(label).textOverflow === "ellipsis",
            group: el.getAttribute("aria-haspopup") === "menu",
            name: el.getAttribute("aria-label"),
          };
        }),
      );
      const clipped = report.filter((r) => r && r.overflows && !(r.truncated && r.ellipsis));
      expect(clipped, "overflowing labels without an ellipsis").toEqual([]);
      const fitting = report.filter((r) => r && !r.overflows && r.truncated);
      expect(fitting, "fitting labels marked truncated").toEqual([]);

      const truncatedLink = report.find((r) => r && r.truncated && !r.group);
      if (truncatedLink) {
        testLogger.step(`Hover the truncated link tile ${truncatedLink.id} and read its tooltip`);
        const tile = page.locator(`[data-test="${truncatedLink.id}"]`);
        await tile.hover();
        const link = truncatedLink.id.replace(/^menu-link-/, "").replace(/-item$/, "");
        const tooltip = page.locator(`[data-test="menu-link-${link}-tooltip"]`);
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toContainText(truncatedLink.name);
        await tile.focus();
        await expect(tooltip).toBeVisible();
      }
      const truncatedGroup = report.find((r) => r && r.truncated && r.group);
      if (truncatedGroup) {
        testLogger.step(`Hover the truncated group tile ${truncatedGroup.id} and read its flyout header`);
        await page.locator(`[data-test="${truncatedGroup.id}"]`).hover();
        const flyout = page.locator('[data-test^="nav-group-flyout-"]').first();
        await expect(flyout).toBeVisible();
        await expect(flyout).toContainText(truncatedGroup.name);
      }
      testLogger.info("locale report", { code, truncated: report.filter((r) => r && r.truncated).map((r) => r.id) });
    });
  }

  test("Logs keeps a typed, unrun query and the time range across the language reload (AC-21)", async ({
    page,
  }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setLanguageCookie(page, "en-us");
    await navigateToBase(page);
    const pm = new PageManager(page);
    await pm.logsPage.navigateToLogs(process.env.ORGNAME);

    testLogger.step("Pick a stream, type a query without running it, and pick a 1 hour range");
    // restoreUrlQueryParams only restores a non-SQL query when the URL also names a stream (useLogs.ts).
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.typeQuery("match_all('language-reload-probe')");
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
    await expect(page.locator('[data-test="date-time-btn"]')).toContainText(/1 Hour/i);

    testLogger.step("Change language and wait for the reload");
    const reloaded = page.waitForEvent("load");
    await reloadThroughLanguageMenu(page);
    await reloaded;

    testLogger.step("The query and the range are back");
    const url = new URL(page.url());
    expect(url.searchParams.get("period")).toBe("1h");
    expect(url.searchParams.get("query")).toBeTruthy();
    await expect(page.locator('[data-test="logs-search-bar-query-editor"]')).toContainText(
      "language-reload-probe",
      { timeout: 30000 },
    );
    await expect(page.locator('[data-test="date-time-btn"]')).toContainText(/1 Hour/i);
  });

  test("a clean page reloads with no prompt (AC-21)", async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await setLanguageCookie(page, "en-us");
    await navigateToBase(page);
    const dialogs = [];
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      d.dismiss().catch(() => {});
    });
    const reloaded = page.waitForEvent("load");
    await reloadThroughLanguageMenu(page);
    await reloaded;
    expect(dialogs).toEqual([]);
    await expect(page.locator(PROFILE)).toBeVisible();
  });

  test("a dirty pipeline editor asks before the language reload (AC-21)", async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setLanguageCookie(page, "en-us");
    await navigateToBase(page);
    const pm = new PageManager(page);

    testLogger.step("Open a new pipeline and add a source stream node");
    await pm.pipelinesPage.openPipelineMenu();
    await pm.pipelinesPage.addPipeline();
    await pm.pipelinesPage.selectStream();
    await pm.pipelinesPage.dragStreamToTarget(pm.pipelinesPage.streamButton);
    await pm.pipelinesPage.selectLogs();
    await pm.pipelinesPage.enterStreamName("e2e_automate");
    await pm.pipelinesPage.selectStreamOption("e2e_automate");
    await pm.pipelinesPage.saveInputNodeStream();

    testLogger.step("Change language: the browser asks, and the cancel keeps the page");
    const dialogs = [];
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      d.dismiss().catch(() => {});
    });
    await reloadThroughLanguageMenu(page);
    await expect.poll(() => dialogs, { timeout: 15000 }).toContain("beforeunload");
    expect(page.url()).toMatch(/\/pipeline\/pipelines\/(add|edit)/);
  });
});
