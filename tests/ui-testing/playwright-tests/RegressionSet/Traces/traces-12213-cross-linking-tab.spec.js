const {
  test,
  expect,
  navigateToBase,
  generateUUID,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const { createEmptyStream, deleteStream } = require("../../utils/traces-api.js");

const NOT_SUPPORTED = ["traces", "metrics", "metadata"];

test.describe("Cross-Linking tab in stream details (#12213)", () => {
  let streams;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const suffix = generateUUID().slice(0, 8);
    streams = Object.fromEntries(
      ["logs", ...NOT_SUPPORTED].map((type) => [type, `e2e_12213_${type}_${suffix}`]),
    );
    for (const [type, name] of Object.entries(streams))
      await createEmptyStream(page.request, name, type);
  });

  test.afterEach(async ({ page }, testInfo) => {
    for (const [type, name] of Object.entries(streams))
      await deleteStream(page.request, name, { type });
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test(
    "only a logs stream offers the Cross-Linking tab",
    {
      tag: ["@bug-12213", "@P2", "@regression", "@tracesRegression"],
    },
    async ({ page }) => {
      const pm = new PageManager(page);

      await pm.crossLinkPage.openStreamDetailsByType(streams.logs, "logs");
      expect(
        await pm.crossLinkPage.isCrossLinkingTabVisible(),
        "a logs stream must offer the tab, or the checks below prove nothing",
      ).toBe(true);
      await pm.crossLinkPage.clickCrossLinkingTab();
      await pm.crossLinkPage.expectAddCrossLinkVisible();

      for (const type of NOT_SUPPORTED) {
        await pm.crossLinkPage.openStreamDetailsByType(streams[type], type);
        await pm.crossLinkPage.expectStreamDetailsTabsLoaded();
        await pm.crossLinkPage.expectCrossLinkingTabAbsent(
          `Bug #12213: a ${type} stream must not offer Cross-Linking`,
        );
      }
    },
  );
});
