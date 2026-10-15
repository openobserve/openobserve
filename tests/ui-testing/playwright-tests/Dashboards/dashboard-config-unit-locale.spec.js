const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupTablePanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
import {
  getTableCellText,
  waitForPanelTableSettled,
} from "../../pages/dashboardPages/dashboard-table-helpers.js";
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

// de-DE is the exact inverse of the en-US test browser for grouping/decimal
// separators, which is what makes the separator-swap assertions below decisive.
const LOCALE_TAG = "de-DE";
const LOCALE_UNIT = `locale:${LOCALE_TAG}`;
// Each locale label carries its code underscored — "German - DE (de_DE)" — and that
// is what the dropdown search matches on.
const LOCALE_CODE = "de_DE";

// The y-axis measure column of a default table panel (column 0 is histogram(_timestamp)).
const VALUE_COLUMN = 1;

/** Swaps "." and "," so an en-US number reads as its de-DE rendering (1,234.50 -> 1.234,50). */
function toGermanSeparators(enUsNumber) {
  return enUsNumber.replace(/[.,]/g, (c) => (c === "," ? "." : ","));
}

/** Measure-column text of the first table row, once the panel has stopped repainting. */
async function readValueCell(page) {
  await waitForPanelTableSettled(page);
  const text = await getTableCellText(page, 0, VALUE_COLUMN);
  expect(text).not.toBe("");
  return text;
}

test.describe("ConfigPanel — Locale Format unit per panel and column", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test('"Other Locale" is an expander, not a unit: it toggles the locale list open and closed without changing the selection', async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const trigger = pm.dashboardPanelConfigs.getUnitTrigger();
    const groupRow = pm.dashboardPanelConfigs.getLocaleGroupRow();
    const localeOptions = pm.dashboardPanelConfigs.getLocaleOptions();

    await pm.dashboardPanelConfigs._openSelectDropdown("dashboard-config-unit");
    const unitBefore = await trigger.getAttribute("data-test-selected-value");

    // Collapsed by default: the nested locale options are filtered out of the list
    // entirely, so they are not merely scrolled out of the virtualized viewport.
    await expect(groupRow).toHaveAttribute("aria-expanded", "false");
    await expect(localeOptions).toHaveCount(0);
    testLogger.info("Other Locale row renders collapsed");

    await pm.dashboardPanelConfigs.toggleLocaleGroup();
    expect(await localeOptions.count()).toBeGreaterThan(0);
    testLogger.info("Expanding Other Locale reveals the locale options");

    // Clicking the row must not select it — "other-locale" is a nesting key and is
    // never saved as a unit, so the dropdown also has to stay open.
    await expect(trigger).toHaveAttribute(
      "data-test-selected-value",
      unitBefore ?? ""
    );
    await expect(groupRow).toBeVisible();

    await pm.dashboardPanelConfigs.toggleLocaleGroup();
    await expect(localeOptions).toHaveCount(0);
    testLogger.info("Collapsing Other Locale hides the locale options again");

    // Keyboard parity: ArrowRight expands the highlighted row, ArrowLeft collapses it.
    // Hovering does not move the keyboard highlight, so walk down to the row with
    // ArrowDown; ArrowRight is a no-op on every option above it.
    await expect(async () => {
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowRight");
      await expect(groupRow).toHaveAttribute("aria-expanded", "true", {
        timeout: 1000,
      });
    }).toPass({ timeout: 15000 });
    // handleExpandKey leaves the highlight on the row it toggled.
    await page.keyboard.press("ArrowLeft");
    await expect(groupRow).toHaveAttribute("aria-expanded", "false");
    testLogger.info("ArrowRight/ArrowLeft expand and collapse the Other Locale row");

    await page.keyboard.press("Escape");
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("unit search matches both the locale code and the locale name, and flattens the Other Locale group", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const groupRow = pm.dashboardPanelConfigs.getLocaleGroupRow();
    const localeOption = pm.dashboardPanelConfigs.getLocaleOption(LOCALE_TAG);

    // Searching by code finds the locale without expanding anything first, and the
    // expander row itself drops out of the list — a search lists every match flat.
    await pm.dashboardPanelConfigs.searchUnitOptions(LOCALE_CODE);
    await expect(localeOption).toBeVisible();
    await expect(groupRow).toHaveCount(0);
    testLogger.info("Search by locale code reveals the locale flat", {
      code: LOCALE_CODE,
    });

    // Search by the language-name half of the same label, read off the option rather
    // than hardcoded, since the names render in the viewer's own language.
    const label = await localeOption.getAttribute("data-test-label");
    const languageName = label.split(" - ")[0];
    expect(languageName.length).toBeGreaterThan(0);

    await pm.dashboardPanelConfigs.searchUnitOptions(languageName);
    await expect(localeOption).toBeVisible();
    testLogger.info("Search by locale name reveals the locale", { languageName });

    await pm.dashboardPanelConfigs.searchUnitOptions("zz_NOPE");
    await expect(pm.dashboardPanelConfigs.getLocaleOptions()).toHaveCount(0);
    await expect(groupRow).toHaveCount(0);
    testLogger.info("A non-matching search returns no locale options");

    await page.keyboard.press("Escape");
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("Other Locale: picking a locale saves it as locale:<tag>, persists across save, and reopens with its group expanded", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelConfigs.selectLocaleUnit(LOCALE_TAG);
    // The locale lives in the existing unit field as "locale:<tag>" — no new config
    // key, which is what keeps panels saved before the feature compatible.
    await expect(pm.dashboardPanelConfigs.getUnitTrigger()).toHaveAttribute(
      "data-test-selected-value",
      LOCALE_UNIT
    );
    testLogger.info("Locale selected", { unit: LOCALE_UNIT });

    await pm.dashboardPanelActions.applyDashboardBtn();
    await expect(pm.dashboardPanelActions.dashboardTable).toBeVisible();
    await pm.dashboardPanelActions.savePanel();

    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.getUnitTrigger()).toHaveAttribute(
      "data-test-selected-value",
      LOCALE_UNIT
    );
    testLogger.info("Locale unit persisted after save");

    // Reopening must not hide the current choice behind a collapsed row: the group
    // auto-expands when one of its nested options is the selected unit. Read that
    // off the nested option rather than the expander row's aria-expanded — the list
    // opens scrolled to the selected option, which leaves the row itself outside the
    // virtualized window with no DOM node at all. A nested option having a node is
    // itself proof of expansion: while collapsed, none of them are rendered.
    await pm.dashboardPanelConfigs._openSelectDropdown("dashboard-config-unit");
    await expect(
      pm.dashboardPanelConfigs.getLocaleOption(LOCALE_TAG)
    ).toBeVisible();
    testLogger.info("Reopened dropdown shows the saved locale expanded and in view");

    await page.keyboard.press("Escape");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("a chosen locale reformats the panel's numbers, while Locale Format (Auto) keeps following the UI language", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelConfigs.selectUnit("Locale Format (Auto)");
    await pm.dashboardPanelActions.applyDashboardBtn();
    const autoText = await readValueCell(page);
    testLogger.info("Locale Format (Auto) rendering", { autoText });

    // Auto follows the test browser's en-US UI language: "," groups, "." for decimals.
    expect(autoText).toMatch(/^-?\d{1,3}(,\d{3})*\.\d{2}$/);

    await pm.dashboardPanelConfigs.selectLocaleUnit(LOCALE_TAG);
    await pm.dashboardPanelActions.applyDashboardBtn();
    const chosenText = await readValueCell(page);
    testLogger.info("Chosen locale rendering", { chosenText });

    // Same number under de-DE conventions: the two separators trade places.
    expect(chosenText).toBe(toGermanSeparators(autoText));
    expect(chosenText).not.toBe(autoText);
    testLogger.info(
      "Pinning the locale reformats the value independently of the UI language"
    );

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("column override: a chosen locale reformats that column and persists after save", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);
    // count() makes the measure column genuinely numeric, so the dialog's unit select
    // shows under the default "auto" field type — no field_type override needed.
    await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

    await pm.dashboardPanelConfigs.selectUnit("Locale Format (Auto)");
    await pm.dashboardPanelActions.applyDashboardBtn();
    const autoText = await readValueCell(page);
    testLogger.info("Measure column under the panel's Auto locale", { autoText });

    await pm.dashboardPanelConfigs.openOverrideConfig();
    await pm.dashboardPanelConfigs.addLastOverrideField();
    await pm.dashboardPanelConfigs.selectFormatUnitLocale(LOCALE_TAG);

    const overrideParent = await pm.dashboardPanelConfigs
      .getOverrideUnitSelect()
      .getAttribute("data-test");
    await expect(
      pm.dashboardPanelConfigs.getUnitTrigger(overrideParent)
    ).toHaveAttribute("data-test-selected-value", LOCALE_UNIT);
    testLogger.info("Column unit set to the chosen locale", { unit: LOCALE_UNIT });

    await pm.dashboardPanelConfigs.overrideSaveBtn.click();
    await pm.dashboardPanelConfigs.overrideDialog.waitFor({
      state: "hidden",
      timeout: 5000,
    });
    await pm.dashboardPanelActions.applyDashboardBtn();

    // The column override wins over the panel unit for this column only.
    const overriddenText = await readValueCell(page);
    testLogger.info("Measure column under the column override", { overriddenText });
    expect(overriddenText).toBe(toGermanSeparators(autoText));
    expect(overriddenText).not.toBe(autoText);

    await pm.dashboardPanelActions.savePanel();
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.openOverrideConfig();
    const reopenedParent = await pm.dashboardPanelConfigs
      .getOverrideUnitSelect()
      .getAttribute("data-test");
    await expect(
      pm.dashboardPanelConfigs.getUnitTrigger(reopenedParent)
    ).toHaveAttribute("data-test-selected-value", LOCALE_UNIT);
    testLogger.info("Column-level locale persisted after save");

    await pm.dashboardPanelConfigs.closeOverrideConfig();
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
