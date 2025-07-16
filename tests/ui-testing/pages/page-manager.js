// Centralized PageManager for dashboard-related page objects
import DashboardCreate from "./dashboardPages/dashboard-create";
import DashboardListPage from "./dashboardPages/dashboard-list";
import DashboardFolder from "./dashboardPages/dashboard-folder";
import DashboardPanelActions from "./dashboardPages/dashboard-panel-actions";
import DashboardPanelConfigs from "./dashboardPages/dashboard-panel-configs";
import DashboardPanelEdit from "./dashboardPages/dashboard-panel-edit";
import DashboardSetting from "./dashboardPages/dashboard-settings";
import DashboardVariables from "./dashboardPages/dashboard-variables";
import ChartTypeSelector from "./dashboardPages/dashboard-chart";
import DashboardDrilldownPage from "./dashboardPages/dashboard-drilldown";
import DashboardFilter from "./dashboardPages/dashboard-filter";
import DashboardImport from "./dashboardPages/dashboard-import.js";
import DashboardShareExportPage from "./dashboardPages/dashboard-share-export";
import DashboardTimeRefresh from "./dashboardPages/dashboard-refresh";
import DateTimeHelper from "./dashboardPages/dashboard-time";
import LogsVisualise from "./dashboardPages/visualise";
import { DashboardPage } from "./dashboardPages/dashboardPage.js";
import { AlertsPage } from "./alertsPages/alertsPage.js";

/**
 * PageManager provides a single access point for all dashboard page objects.
 *
 * Usage in your test file:
 *   import PageManager from './pages/page-manager';
 *   const pm = new PageManager(page);
 *   await pm.dashboardCreate.createDashboard('My Dashboard');
 *   await pm.dashboardPanelActions.addPanelName('Panel 1');
 *   // ...and so on for all dashboard POMs
 */
class PageManager {
  /**
   * @param {import('@playwright/test').Page} page - Playwright page instance
   */
  constructor(page) {
    this.page = page;
    this.dashboardCreate = new DashboardCreate(page);
    this.dashboardList = new DashboardListPage(page);
    this.dashboardFolder = new DashboardFolder(page);
    this.dashboardPanelActions = new DashboardPanelActions(page);
    this.dashboardPanelConfigs = new DashboardPanelConfigs(page);
    this.dashboardPanelEdit = new DashboardPanelEdit(page);
    this.dashboardSetting = new DashboardSetting(page);
    this.dashboardVariables = new DashboardVariables(page);
    this.chartTypeSelector = new ChartTypeSelector(page);
    this.dashboardDrilldown = new DashboardDrilldownPage(page);
    this.dashboardFilter = new DashboardFilter(page);
    this.dashboardImport = new DashboardImport(page);
    this.dashboardShareExport = new DashboardShareExportPage(page);
    this.dashboardTimeRefresh = new DashboardTimeRefresh(page);
    this.dateTimeHelper = new DateTimeHelper(page);
    this.logsVisualise = new LogsVisualise(page);
    this.dashboardPage = new DashboardPage(page);
    this.alertsPage = new AlertsPage(page);
  }
}

export default PageManager;
