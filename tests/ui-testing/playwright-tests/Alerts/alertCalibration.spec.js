const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");

const BOUNCED =
  "Alert calibration route guard sent the runs URL to the alert list (OSS bundle or feature off)";

test.describe("Alert Calibration testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info("Test setup completed");
  });

  test(
    "should redirect the alert calibration route to the alert list on an OSS build",
    { tag: ["@alert-calibration", "@oss", "@P0", "@all"] },
    async () => {
      const buildType = await pm.alertCalibrationPage.detectBuildType();
      test.skip(buildType !== "opensource", `Runs only on an OSS backend (build: ${buildType})`);
      await pm.alertCalibrationPage.openRunsExpectingRedirect();
    },
  );

  test.describe("enterprise", () => {
    test.beforeEach(async () => {
      // Alert calibration is enterprise/cloud-gated: on OSS the route guard
      // bounces /alert-calibration* to alertList, so skip instead of timing out.
      const buildType = await pm.alertCalibrationPage.detectBuildType();
      test.skip(
        buildType !== "enterprise" && buildType !== "cloud",
        `Alert calibration is enterprise/cloud-gated (build: ${buildType})`,
      );
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
      "should show the runs view instead of the enable prompt on the dashboard by default",
      { tag: ["@alert-calibration", "@all"] },
      async () => {
        testLogger.info("Opening the alert calibration dashboard");
        await pm.alertCalibrationPage.navigateToDashboard();
        await pm.alertCalibrationPage.expectRunsViewInsteadOfEnablePrompt();
        testLogger.info("Test completed");
      },
    );

    test(
      "should render the runs page stats strip and runs table",
      { tag: ["@alert-calibration", "@enterprise", "@P0", "@all"] },
      async () => {
        test.skip(!(await pm.alertCalibrationPage.openRunsIfReachable()), BOUNCED);
        await pm.alertCalibrationPage.expectRunsPageShell();
      },
    );

    test(
      "should switch between the runs page and the dashboard with the tabs",
      { tag: ["@alert-calibration", "@enterprise", "@P1", "@all"] },
      async () => {
        test.skip(!(await pm.alertCalibrationPage.openRunsIfReachable()), BOUNCED);
        await pm.alertCalibrationPage.switchToDashboardTab();
        await pm.alertCalibrationPage.switchToRunsTab();
      },
    );
  });
});
