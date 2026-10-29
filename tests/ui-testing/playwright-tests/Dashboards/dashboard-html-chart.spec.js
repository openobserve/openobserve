const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require('../utils/test-logger.js');
import logData from "../../fixtures/log.json";
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
// Each test runs in parallel (mode: "parallel" below), so the name must be
// generated fresh per test — a single shared name caused cross-test races
// where one test's create/delete collided with another's mid-flight.
const generateDashboardName = () =>
  "Dashboard_" + Math.random().toString(36).slice(2, 11);

// Basic HTML snippet for the first test
const BASIC_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test>Openobserve</h1>
    <p>Testing Openobserve visibility</p>
  </body>
</html>`;

// HTML snippet that renders a bold dashboard variable for the second test
const VARIABLE_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test>Openobserve</h1>
    <p>
      <span style="font-weight:900;">$variablename</span>&nbsp;Testing&nbsp;Openobserve&nbsp;visibility
    </p>
  </body>
</html>`;

const XSS_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test>XSS Test</h1>
    <script>alert("xss")</script>
  </body>
</html>`;

// Chromium's CSSOM decodes these escapes to a literal "</style>" when the panel CSS is rewritten.
const CSS_REWRITE_HTML_SNIPPET = `<style>a{content:"\\3c/style\\3e\\3cimg src=x onerror=window.__o2HtmlPanelSentinel=1\\3e"}</style>
<style>a[title="\\3c/style\\3e\\3cimg src=x onerror=window.__o2HtmlPanelSentinel=1\\3e"]{color:red}</style>
<h1 data-test>CSS Rewrite Test</h1>`;

const UNDEFINED_VARIABLE_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <p>$undefinedvar Not replaced</p>
  </body>
</html>`;

const SAFE_REL = "noopener noreferrer";

const BLANK_TARGET_HTML_SNIPPET = `<h1>Blank Target Test</h1>
<a id="o2-blank-link" href="https://example.com/a" target="_blank" rel="opener">Blank link</a>
<a id="o2-blank-mixed-case-link" href="https://example.com/b" target="  _BLANK ">Mixed case link</a>
<form id="o2-blank-form" action="https://example.com/submit" target="_blank"><button type="submit">Go</button></form>
<map name="o2-map"><area id="o2-blank-area" shape="rect" coords="0,0,10,10" href="https://example.com/c" target="_blank" alt="area"></map>
<svg width="20" height="20"><a id="o2-blank-svg-link" href="https://example.com/d" target="_blank"><rect width="10" height="10"></rect></a></svg>`;

const DROPPED_TARGET_HTML_SNIPPET = `<h1>Dropped Target Test</h1>
<a id="o2-named-link" href="https://example.com/a" target="o2frame">Named link</a>
<a id="o2-top-link" href="https://example.com/b" target="_top">Top link</a>
<a id="o2-self-link" href="https://example.com/c" target="_self">Self link</a>
<a id="o2-parent-link" href="https://example.com/d" target="_parent">Parent link</a>
<form id="o2-named-form" action="https://example.com/submit" target="o2frame"><button type="submit">Go</button></form>
<a id="o2-plain-link" href="https://example.com/e" rel="nofollow">Plain link</a>`;

// a shadowed getAttribute must not blank the panel; a shadowed nodeName form is dropped as clobbered
const SHADOWED_FORM_HTML_SNIPPET = `<h1>Shadowed Form Test</h1>
<form id="o2-shadowed-form" action="https://example.com/submit" target="_blank">
  <input name="getAttribute" value="a">
  <button type="submit">Send</button>
</form>
<form id="o2-clobbered-form" action="https://example.com/submit" target="_blank">
  <input name="nodeName" value="b">
</form>
<a id="o2-after-forms-link" href="https://example.com/a" target="_blank">After forms</a>`;

const popupHtmlSnippet = (href) => `<h1>Popup Link Test</h1>
<a id="o2-popup-link" href="${href}" target="_blank">Open in new tab</a>`;

test.describe.configure({ mode: "parallel" });

// Refactored test cases using Page Object Model

test.describe("HTML chart dashboard", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("Should display the correct Plot UI when entering the HTML code", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();

    await pm.chartTypeSelector.selectChartType("html");

    await pm.chartTypeSelector.fillHtmlEditor(BASIC_HTML_SNIPPET);

    await expect(
      pm.chartTypeSelector.getHtmlHeading("Openobserve")
    ).toBeVisible();

    // Add the panel name and save the panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("Should correctly replace the dashboard variable value on the HTML chart.", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    await page.waitForTimeout(5000);
    // Open dashboard settings and add a variable
    await pm.dashboardSetting.openSetting();

    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();

    await pm.chartTypeSelector.selectChartType("html");

    await pm.dashboardTimeRefresh.setRelative("30", "m");

    await pm.chartTypeSelector.fillHtmlEditor(VARIABLE_HTML_SNIPPET);

    await expect(
      pm.chartTypeSelector.getHtmlHeading("Openobserve")
    ).toBeVisible();

    // selectValueFromVariableDropDown itself waits for the /_values_stream
    // response (see dashboard-variables.js) before checking the option.
    await pm.dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "controller"
    );

    await expect(
      pm.chartTypeSelector.getHtmlRendererText("controller")
    ).toBeVisible();

    // Save the dashboard panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  //The system does not allow malicious JavaScript to run inside an HTML chart.
  //Only safe HTML (like headings or text) is displayed, preventing hackers from injecting harmful code.
  test("Should sanitize <script> tags to prevent XSS in the HTML chart.", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    const dashboardName = generateDashboardName();

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("html");

    await pm.chartTypeSelector.fillHtmlEditor(XSS_HTML_SNIPPET);

    await expect(pm.chartTypeSelector.getHtmlHeading("XSS Test")).toBeVisible();
    await expect(
      pm.chartTypeSelector.getHtmlRendererScripts()
    ).toHaveCount(0);

    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
  test("Should not let rewritten panel CSS break out of its style element.", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    const dashboardName = generateDashboardName();

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("html");

    await pm.chartTypeSelector.fillHtmlEditor(CSS_REWRITE_HTML_SNIPPET);

    await expect(
      pm.chartTypeSelector.getHtmlHeading("CSS Rewrite Test")
    ).toBeVisible();
    await expect(pm.chartTypeSelector.getInjectedOnErrorImages()).toHaveCount(0);

    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    await expect(
      pm.chartTypeSelector.getHtmlHeading("CSS Rewrite Test")
    ).toBeVisible();
    await expect(pm.chartTypeSelector.getInjectedOnErrorImages()).toHaveCount(0);
    // an injected image fails to load asynchronously, so give onerror time to fire
    await page.waitForTimeout(1000);
    expect(await pm.chartTypeSelector.getHtmlPanelSentinel()).toBeUndefined();

    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("Should keep undefined dashboard variable placeholder unchanged in HTML chart.", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    const dashboardName = generateDashboardName();

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("html");

    await pm.chartTypeSelector.fillHtmlEditor(UNDEFINED_VARIABLE_HTML_SNIPPET);

    await expect(
      pm.chartTypeSelector.getHtmlRendererText("$undefinedvar")
    ).toBeVisible();

    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});

test.describe("HTML chart link targets", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  const openHtmlPanelEditor = async (pm, page, dashboardName, html) => {
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("html");
    await pm.chartTypeSelector.fillHtmlEditor(html);
  };

  const expectBlankTargetKept = async (pm, selector) => {
    const element = pm.chartTypeSelector.getHtmlRendererElement(selector);
    await expect(element).toHaveAttribute("target", "_blank");
    await expect(element).toHaveAttribute("rel", SAFE_REL);
  };

  test("Should keep target=_blank and force a safe rel on links, forms, area and SVG links", {
    tag: ["@dashboards", "@htmlChart", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await openHtmlPanelEditor(pm, page, dashboardName, BLANK_TARGET_HTML_SNIPPET);
    await expect(
      pm.chartTypeSelector.getHtmlHeading("Blank Target Test")
    ).toBeVisible();

    for (const selector of [
      "#o2-blank-link",
      "#o2-blank-mixed-case-link",
      "#o2-blank-form",
      "#o2-blank-area",
      "#o2-blank-svg-link",
    ]) {
      await expectBlankTargetKept(pm, selector);
    }

    await pm.dashboardPanelActions.addPanelName(
      pm.dashboardPanelActions.generateUniquePanelName("panel-test")
    );
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("Should drop named, _top, _self and _parent targets without adding rel", {
    tag: ["@dashboards", "@htmlChart", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await openHtmlPanelEditor(pm, page, dashboardName, DROPPED_TARGET_HTML_SNIPPET);
    await expect(
      pm.chartTypeSelector.getHtmlHeading("Dropped Target Test")
    ).toBeVisible();

    for (const selector of [
      "#o2-named-link",
      "#o2-top-link",
      "#o2-self-link",
      "#o2-parent-link",
      "#o2-named-form",
    ]) {
      const element = pm.chartTypeSelector.getHtmlRendererElement(selector);
      await expect(element).toHaveCount(1);
      await expect(element).not.toHaveAttribute("target");
      await expect(element).not.toHaveAttribute("rel");
    }

    // an element without a target keeps the author's rel
    await expect(
      pm.chartTypeSelector.getHtmlRendererElement("#o2-plain-link")
    ).toHaveAttribute("rel", "nofollow");

    await pm.dashboardPanelActions.addPanelName(
      pm.dashboardPanelActions.generateUniquePanelName("panel-test")
    );
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("Should render a form with a control named getAttribute and drop a nodeName-clobbered form", {
    tag: ["@dashboards", "@htmlChart", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await openHtmlPanelEditor(pm, page, dashboardName, SHADOWED_FORM_HTML_SNIPPET);

    await expect(
      pm.chartTypeSelector.getHtmlHeading("Shadowed Form Test")
    ).toBeVisible();
    await expect(
      pm.chartTypeSelector.getHtmlRendererElement("#o2-shadowed-form button")
    ).toBeVisible();
    await expectBlankTargetKept(pm, "#o2-shadowed-form");
    await expect(
      pm.chartTypeSelector.getHtmlRendererElement("#o2-clobbered-form")
    ).toHaveCount(0);
    await expectBlankTargetKept(pm, "#o2-after-forms-link");

    await pm.dashboardPanelActions.addPanelName(
      pm.dashboardPanelActions.generateUniquePanelName("panel-test")
    );
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("Should open a target=_blank link in a new tab without window.opener", {
    tag: ["@dashboards", "@htmlChart", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();
    const popupUrl = new URL("/healthz", process.env["ZO_BASE_URL"]).href;

    await openHtmlPanelEditor(pm, page, dashboardName, popupHtmlSnippet(popupUrl));
    await expectBlankTargetKept(pm, "#o2-popup-link");

    const popup = await pm.chartTypeSelector.clickHtmlRendererElementForPopup(
      "#o2-popup-link"
    );
    expect(popup.url()).toBe(popupUrl);
    expect(await pm.chartTypeSelector.isPopupOpenerNull(popup)).toBe(true);
    await popup.close();

    // the dashboard tab itself must not navigate away
    await expect(
      pm.chartTypeSelector.getHtmlHeading("Popup Link Test")
    ).toBeVisible();

    await pm.dashboardPanelActions.addPanelName(
      pm.dashboardPanelActions.generateUniquePanelName("panel-test")
    );
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("Should keep target=_blank and safe rel on the saved panel after reload", {
    tag: ["@dashboards", "@htmlChart", "@P2"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await openHtmlPanelEditor(pm, page, dashboardName, BLANK_TARGET_HTML_SNIPPET);
    await expect(
      pm.chartTypeSelector.getHtmlHeading("Blank Target Test")
    ).toBeVisible();

    await pm.dashboardPanelActions.addPanelName(
      pm.dashboardPanelActions.generateUniquePanelName("panel-test")
    );
    await pm.dashboardPanelActions.savePanel();

    await expect(
      pm.chartTypeSelector.getHtmlHeading("Blank Target Test")
    ).toBeVisible();
    await expectBlankTargetKept(pm, "#o2-blank-link");
    await expectBlankTargetKept(pm, "#o2-blank-form");

    await page.reload();
    await expect(
      pm.chartTypeSelector.getHtmlHeading("Blank Target Test")
    ).toBeVisible();
    await expectBlankTargetKept(pm, "#o2-blank-link");
    await expectBlankTargetKept(pm, "#o2-blank-mixed-case-link");
    await expectBlankTargetKept(pm, "#o2-blank-svg-link");

    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
