// Centralized PageManager for dashboard-related page objects
import DashboardCreate from "./dashboard-create";
import DashboardListPage from "./dashboard-list";
import DashboardFolder from "./dashboard-folder";
import DashboardPanelActions from "./dashboard-panel-actions";
import DashboardPanelConfigs from "./dashboard-panel-configs";
import DashboardPanelEdit from "./dashboard-panel-edit";
import DashboardSetting from "./dashboard-settings";
import DashboardVariables from "./dashboard-variables";
import ChartTypeSelector from "./dashboard-chart";
import DashboardDrilldownPage from "./dashboard-drilldown";
import DashboardFilter from "./dashboard-filter";
import DashboardImport from "./dashboard.import";
import DashboardShareExportPage from "./dashboard-share-export";
import DashboardTimeRefresh from "./dashboard-refresh";
import DateTimeHelper from "./dashboard-time";
import LogsVisualise from "./visualise";
import { DashboardPage } from "../../pages/dashboardPage.js";
import { AlertsPage } from "../../pages/alertsPages/alertsPage.js";


/**
 * PageManager provides a single access point for all dashboard page objects.
 *
 * Usage in your test file:
 *   import PageManager from './pages/dashboardPages/page-manager';
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