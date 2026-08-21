// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import {
  setupTestDashboard,
  cleanupTestDashboard,
} from "./utils/dashCreation.js";
import { generateDashboardName } from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");
const { ensureMetricsIngested } = require("../utils/shared-metrics-setup.js");

test.describe("Dashboard add-panel chart selection icons testcases", () => {
  test.describe.configure({ mode: "parallel" });

  // One-time metrics ingestion for the PromQL-disable test. `default` metrics
  // stream must exist before the PromQL toggle can be exercised (the toggle is
  // v-if'd on stream_type == "metrics").
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  // P0: The add-panel mounts the ChartSelection sidebar with exactly 20 tiles +
  // 20 icons, and the default chart type (bar) carries the single selection.
  test(
    "should render all 20 chart selection icons with the default (bar) selection",
    { tag: ["@dashboard-chart-selection", "@dashboards", "@all", "@P0", "@smoke"] },
    async ({ page }) => {
      testLogger.info("Testing chart selection sidebar renders 20 icons with default selection");
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();

      // Wait for the async selected-state signal (data-test-selected) to be assigned.
      await pm.chartTypeSelector.waitForChartSelectionHighlight();

      await expect(pm.chartTypeSelector.getChartSelectionItems()).toHaveCount(20);
      await expect(pm.chartTypeSelector.getChartSelectionIcons()).toHaveCount(20);
      await expect(pm.chartTypeSelector.getSelectedChartTiles()).toHaveCount(1);
      await expect(pm.chartTypeSelector.getSelectedChartTile("bar")).toHaveCount(1);
      await expect(pm.chartTypeSelector.getSelectedChartItem("bar")).toHaveAttribute(
        "data-selected",
        "true"
      );

      testLogger.info("Chart selection sidebar renders 20 icons with default bar selection");

      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // P0: Clicking a non-default chart transfers the single highlight exactly once —
  // the clicked tile gains the selection and the previous (bar) tile loses it.
  test(
    "should move the single selection highlight to the clicked chart tile",
    { tag: ["@dashboard-chart-selection", "@dashboards", "@all", "@P0", "@smoke"] },
    async ({ page }) => {
      testLogger.info("Testing chart selection highlight moves to the clicked tile");
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.waitForChartSelectionHighlight();

      await pm.chartTypeSelector.selectChartType("pie");

      await expect(pm.chartTypeSelector.getSelectedChartTile("pie")).toHaveCount(1);
      await expect(pm.chartTypeSelector.getSelectedChartTile("bar")).toHaveCount(0);
      await expect(pm.chartTypeSelector.getSelectedChartItem("pie")).toHaveAttribute(
        "data-selected",
        "true"
      );
      await expect(pm.chartTypeSelector.getSelectedChartItem("bar")).toHaveAttribute(
        "data-selected",
        "false"
      );
      // No stale duplicate highlight: exactly one tile carries data-test-selected.
      await expect(pm.chartTypeSelector.getSelectedChartTiles()).toHaveCount(1);

      testLogger.info("Selection highlight moved to the pie tile");

      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // P1: Hovering a chart icon reveals its localized title via the shared OTooltip.
  test(
    "should show the localized tooltip when hovering a chart icon",
    { tag: ["@dashboard-chart-selection", "@dashboards", "@all", "@P1", "@functional"] },
    async ({ page }) => {
      testLogger.info("Testing chart icon tooltip on hover");
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.waitForChartSelectionHighlight();

      // The child-mode OTooltip attaches its hover listener to the icon <img>.
      await pm.chartTypeSelector.getChartIcon("pie").hover();

      const tooltip = pm.chartTypeSelector
        .getChartSelectionTooltip()
        .filter({ hasText: "Pie" })
        .first();
      await expect(tooltip).toBeVisible({ timeout: 5000 });

      testLogger.info("Chart icon tooltip shows the localized title");

      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // P1: Dark mode flips <html> to .dark and the icons resolve the dark color-scheme variant.
  test(
    "should render the theme-aware icon variant in dark mode",
    { tag: ["@dashboard-chart-selection", "@dashboards", "@all", "@P1", "@functional"] },
    async ({ page }) => {
      testLogger.info("Testing chart icon dark-mode variant");
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.waitForChartSelectionHighlight();

      try {
        await pm.themePage.switchToDarkMode();

        // Guard the theme switch took effect before asserting its downstream result.
        expect(await pm.themePage.isDarkMode()).toBe(true);

        // Icons still render (one <img> per tile) after the theme flip.
        await expect(pm.chartTypeSelector.getChartSelectionIcons()).toHaveCount(20);
        await expect(pm.chartTypeSelector.getChartSelectionIcons().first()).toBeVisible();

        // The dark:scheme-dark variant resolves → computed color-scheme is "dark".
        expect(await pm.chartTypeSelector.getChartIconColorScheme()).toBe("dark");

        testLogger.info("Chart icon dark-mode variant resolved (color-scheme: dark)");
      } finally {
        // Restore light mode so a leaked dark theme cannot bleed into sibling specs.
        await pm.themePage.switchToLightMode();
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    }
  );

  // P1: In PromQL mode the Sankey tile is disabled and its click is suppressed,
  // while other (allowed) chart types remain selectable.
  test(
    "should disable the Sankey chart tile in PromQL mode while other charts remain selectable",
    { tag: ["@dashboard-chart-selection", "@dashboards", "@all", "@P1", "@functional", "@promql"] },
    async ({ page }) => {
      testLogger.info("Testing PromQL mode disables the Sankey chart tile");
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.waitForChartSelectionHighlight();

      // The PromQL toggle only renders after the metrics stream-type is selected.
      await pm.chartTypeSelector.selectStreamType("metrics");

      // Gracefully skip if this build has no metrics stream-type (toggle never renders).
      if (!(await pm.chartTypeSelector.isPromqlToggleVisible())) {
        await cleanupTestDashboard(page, pm, dashboardName);
        test.skip(
          true,
          "PromQL toggle unavailable — metrics stream-type not supported in this build"
        );
        return;
      }

      await pm.chartTypeSelector.selectStream("default");
      await pm.chartTypeSelector.switchToPromqlMode();

      // Guard the mode switch actually took effect before asserting its result.
      await expect(pm.chartTypeSelector.promqlQueryTypeBtn).toHaveAttribute(
        "data-state",
        "on",
        { timeout: 10000 }
      );

      // Sankey is the only chart absent from promqlAllowedCharts → disabled.
      const sankeyTile = pm.chartTypeSelector.getChartTile("sankey");
      await expect(sankeyTile).toHaveClass(/cursor-not-allowed/);
      await expect(sankeyTile).toHaveClass(/opacity-50/);

      // Clicking the disabled Sankey tile is suppressed — selection does not change.
      await sankeyTile.click();
      await expect(pm.chartTypeSelector.getSelectedChartTile("sankey")).toHaveCount(0);
      await expect(pm.chartTypeSelector.getSelectedChartTile("bar")).toHaveCount(1);

      // A non-disabled chart (line) remains selectable in PromQL mode.
      await pm.chartTypeSelector.selectChartType("line");
      await expect(pm.chartTypeSelector.getSelectedChartTile("line")).toHaveCount(1);
      await expect(pm.chartTypeSelector.getSelectedChartItem("line")).toHaveAttribute(
        "data-selected",
        "true"
      );

      testLogger.info("PromQL mode disables Sankey while line remains selectable");

      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
