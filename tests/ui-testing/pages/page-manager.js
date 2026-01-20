// Centralized PageManager for dashboard-related page objects
import DashboardCreate from "./dashboardPages/dashboard-create";
import DashboardListPage from "./dashboardPages/dashboard-list";
import DashboardFolder from "./dashboardPages/dashboard-folder";
import DashboardactionPage from "./dashboardPages/dashboard-panel-actions";
import DashboardPanelConfigs from "./dashboardPages/dashboard-panel-configs";
import DashboardPanel from "./dashboardPages/dashboard-panel-edit";
import DashboardSetting from "./dashboardPages/dashboard-settings";
import DashboardVariables from "./dashboardPages/dashboard-variables";
import DashboardVariablesScoped from "./dashboardPages/dashboard-variables-scoped.js";
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

// ===== SANITY SPEC ADDITIONAL PAGE OBJECTS =====
import { LogsPage } from "./logsPages/logsPage.js";
import { StreamsPage } from "./streamsPages/streamsPage.js";
import { AlertTemplatesPage } from "./alertsPages/alertTemplatesPage.js";
import { AlertDestinationsPage } from "./alertsPages/alertDestinationsPage.js";
import { PipelinesPage } from "./pipelinesPages/pipelinesPage.js";
import { LoginPage } from "./generalPages/loginPage.js";
import { IngestionPage } from "./generalPages/ingestionPage.js";
import { IngestionConfigPage } from "./generalPages/ingestionConfigPage.js";

// ===== GENERAL TESTS ADDITIONAL PAGE OBJECTS =====
import { HomePage } from "./generalPages/homePage.js";
import { MetricsPage } from "./metricsPages/metricsPage.js";
import { TracesPage } from "./tracesPages/tracesPage.js";
import { RumPage } from "./logsPages/rumPage.js";
import { ReportsPage } from "./reportsPages/reportsPage.js";
import { DataPage } from "./generalPages/dataPage.js";
import { IamPage } from "./iamPages/iamPage.js";
import { ManagementPage } from "./generalPages/managementPage.js";
import { AboutPage } from "./generalPages/aboutPage.js";
import { CreateOrgPage } from "./generalPages/createOrgPage.js";
import { CommonActions } from "./commonActions.js";
import { UserPage } from "./generalPages/userPage.js";
import { SanityPage } from "./generalPages/sanityPage.js";
import { ChangeOrgPage } from "./generalPages/changeOrgPage.js";
import { EnrichmentPage } from "./generalPages/enrichmentPage.js";
import { ThemePage } from "./generalPages/themePage.js";
import { LanguagePage } from "./generalPages/languagePage.js";
import { CorrelationSettingsPage } from "./generalPages/correlationSettingsPage.js";
const SchemaPage = require("./generalPages/schemaPage.js");
const SchemaLoadPage = require("./generalPages/schemaLoadPage.js");
const APICleanup = require("./apiCleanup.js");

// ===== LOGS, REPORTS, STREAMS, PIPELINES ADDITIONAL PAGE OBJECTS =====
import { LogsQueryPage } from "./logsPages/logsQueryPage.js";
import UnflattenedPage from "./logsPages/unflattened.js";

// ===== SDR (SENSITIVE DATA REDACTION) PAGE OBJECTS =====
import { SDRPatternsPage } from "./sdrPages/sdrPatternsPage.js";
import { SDRVerificationPage } from "./sdrPages/sdrVerificationPage.js";
import { StreamAssociationPage } from "./streamsPages/streamAssociationPage.js";

// ===== FUNCTIONS PAGE OBJECTS =====
const FunctionsPage = require("./functionsPages/functionsPage.js");

class PageManager {
  /**
   * @param {import('@playwright/test').Page} page - Playwright page instance
   */
  constructor(page) {
    this.page = page;

    // ===== EXISTING DASHBOARD PAGE OBJECTS =====
    this.dashboardCreate = new DashboardCreate(page);
    this.dashboardList = new DashboardListPage(page);
    this.dashboardFolder = new DashboardFolder(page);
    this.dashboardPanelActions = new DashboardactionPage(page);
    this.dashboardPanelConfigs = new DashboardPanelConfigs(page);
    this.dashboardPanelEdit = new DashboardPanel(page);
    this.dashboardSetting = new DashboardSetting(page);
    this.dashboardVariables = new DashboardVariables(page);
    this.dashboardVariablesScoped = new DashboardVariablesScoped(page);
    this.chartTypeSelector = new ChartTypeSelector(page);
    this.dashboardDrilldown = new DashboardDrilldownPage(page);
    this.dashboardFilter = new DashboardFilter(page);
    this.dashboardImport = new DashboardImport(page);
    this.dashboardShareExport = new DashboardShareExportPage(page);
    this.dashboardTimeRefresh = new DashboardTimeRefresh(page);
    this.dateTimeHelper = new DateTimeHelper(page);
    this.logsVisualise = new LogsVisualise(page);
    this.dashboardPage = new DashboardPage(page);

    // ===== EXISTING ALERTS PAGE OBJECT =====
    this.alertsPage = new AlertsPage(page);

    // ===== API CLEANUP =====
    this.apiCleanup = new APICleanup();

    // ===== SANITY SPEC ADDITIONAL PAGE OBJECTS =====
    this.logsPage = new LogsPage(page);
    this.streamsPage = new StreamsPage(page);
    this.alertTemplatesPage = new AlertTemplatesPage(page);
    this.alertDestinationsPage = new AlertDestinationsPage(page);
    this.pipelinesPage = new PipelinesPage(page);
    this.loginPage = new LoginPage(page);
    this.ingestionPage = new IngestionPage(page);
    this.ingestionConfigPage = new IngestionConfigPage(page);

    // ===== GENERAL TESTS ADDITIONAL PAGE OBJECTS =====
    this.homePage = new HomePage(page);
    this.metricsPage = new MetricsPage(page);
    this.tracesPage = new TracesPage(page);
    this.rumPage = new RumPage(page);
    this.reportsPage = new ReportsPage(page);
    this.dataPage = new DataPage(page);
    this.iamPage = new IamPage(page);
    this.managementPage = new ManagementPage(page);
    this.aboutPage = new AboutPage(page);
    this.createOrgPage = new CreateOrgPage(page);
    this.commonActions = new CommonActions(page);
    this.userPage = new UserPage(page);
    this.sanityPage = new SanityPage(page);
    this.changeOrgPage = new ChangeOrgPage(page);
    this.enrichmentPage = new EnrichmentPage(page);
    this.themePage = new ThemePage(page);
    this.languagePage = new LanguagePage(page);
    this.correlationSettingsPage = new CorrelationSettingsPage(page);
    this.schemaPage = new SchemaPage(page);
    this.schemaLoadPage = new SchemaLoadPage(page);

    // ===== LOGS, REPORTS, STREAMS, PIPELINES ADDITIONAL PAGE OBJECTS =====
    this.logsQueryPage = new LogsQueryPage(page);
    this.unflattenedPage = new UnflattenedPage(page);

    // ===== SDR (SENSITIVE DATA REDACTION) PAGE OBJECTS =====
    this.sdrPatternsPage = new SDRPatternsPage(page);
    this.sdrVerificationPage = new SDRVerificationPage(page);
    this.streamAssociationPage = new StreamAssociationPage(page);

    // ===== FUNCTIONS PAGE OBJECTS =====
    this.functionsPage = new FunctionsPage(page);
  }
}

module.exports = PageManager;
