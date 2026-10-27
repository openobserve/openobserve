const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");

test.describe("Alert Calibration testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // Alert calibration is enterprise/cloud-gated: on OSS the route guard
    // bounces /alert-calibration* to alertList, so skip instead of timing out.
    const buildType = await pm.alertCalibrationPage.detectBuildType();
    test.skip(
      buildType !== "enterprise" && buildType !== "cloud",
      `Alert calibration is enterprise/cloud-gated (build: ${buildType})`,
    );
    testLogger.info("Test setup completed");
  });

  test(
    "should present alert calibration enabled by default in the settings form",
    { tag: ["@alert-calibration", "@all"] },
    async () => {
      testLogger.info("Opening the alert calibration settings page");
      await pm.alertCalibrationPage.navigateToSettings();
      await pm.alertCalibrationPage.expectEnabledSwitchOn();
      testLogger.info("Test completed");
    },
  );

  test(
    "should show the empty runs state instead of the enable prompt on the dashboard by default",
    { tag: ["@alert-calibration", "@all"] },
    async () => {
      testLogger.info("Opening the alert calibration dashboard");
      await pm.alertCalibrationPage.navigateToDashboard();
      await pm.alertCalibrationPage.expectEmptyRunsStateInsteadOfEnablePrompt();
      testLogger.info("Test completed");
    },
  );
});
