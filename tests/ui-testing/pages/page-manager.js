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
import DashboardSqlAutocomplete from "./dashboardPages/dashboard-sql-autocomplete";
import DashboardPromQLEditor from "./dashboardPages/dashboard-promql-editor";
import DashboardMultiSQL from "./dashboardPages/dashboard-multi-sql";
import DashboardMaxQueryRange from "./dashboardPages/dashboard-max-query-range";
import DashboardDrilldownPage from "./dashboardPages/dashboard-drilldown";
import DashboardLegendsCopy from "./dashboardPages/dashboard-legends-copy";
import DashboardFilter from "./dashboardPages/dashboard-filter";
import DashboardImport from "./dashboardPages/dashboard-import.js";
import DashboardShareExportPage from "./dashboardPages/dashboard-share-export";
import DashboardTimeRefresh from "./dashboardPages/dashboard-refresh";
import DateTimeHelper from "./dashboardPages/dashboard-time";
import DashboardPanelTime from "./dashboardPages/dashboard-panel-time";
import LogsVisualise from "./dashboardPages/visualise";
import { DashboardPage } from "./dashboardPages/dashboardPage.js";
import { AlertsPage } from "./alertsPages/alertsPage.js";
import { AlertHistoryPage } from "./alertsPages/alertHistoryPage.js";

// ===== SANITY SPEC ADDITIONAL PAGE OBJECTS =====
import { LogsPage } from "./logsPages/logsPage.js";
import { StreamsPage } from "./streamsPages/streamsPage.js";
import { AlertTemplatesPage } from "./alertsPages/alertTemplatesPage.js";
import { AlertDestinationsPage } from "./alertsPages/alertDestinationsPage.js";
import { PipelinesPage } from "./pipelinesPages/pipelinesPage.js";
import { PipelinesFormValidationPage } from "./pipelinesPages/pipelinesFormValidationPage.js";
import { LoginPage } from "./generalPages/loginPage.js";
import { IngestionPage } from "./generalPages/ingestionPage.js";
import { CloudLoginPage } from "./cloudPages/cloudLoginPage.js";
import { isCloudEnvironment } from "./cloudPages/cloud-env.js";
import { IngestionConfigPage } from "./generalPages/ingestionConfigPage.js";

// ===== GENERAL TESTS ADDITIONAL PAGE OBJECTS =====
import { HomePage } from "./generalPages/homePage.js";
import { MetricsPage } from "./metricsPages/metricsPage.js";
import { MetricsQueryEditorPage } from "./metricsPages/metricsQueryEditorPage.js";
import { MetricsBuilderPage } from "./metricsPages/metricsBuilderPage.js";
import { TracesPage } from "./tracesPages/tracesPage.js";
import { ServiceGraphPage } from "./tracesPages/serviceGraphPage.js";
import { ServicesCatalogPage } from "./tracesPages/servicesCatalogPage.js";
import { RumPage } from "./rumPages/rumPage.js";
import { RumSessionsPage } from "./rumPages/rumSessionsPage.js";
import { RumPerformancePage } from "./rumPages/rumPerformancePage.js";
import { RumIngestionPage } from "./rumPages/rumIngestionPage.js";
import { RumSourcemapsPage } from "./rumPages/rumSourcemapsPage.js";
import { ReportsPage } from "./reportsPages/reportsPage.js";
import { ReportFoldersPage } from "./reportsPages/reportFoldersPage.js";
import { ReportsFormValidationPage } from "./reportsPages/reportsFormValidationPage.js";
import { DataPage } from "./generalPages/dataPage.js";
import { IamPage } from "./iamPages/iamPage.js";
import { IngestionTokensPage } from "./iamPages/ingestionTokensPage.js";
import { IamFormValidationPage } from "./iamPages/iamFormValidationPage.js";
import { DashboardsFormValidationPage } from "./dashboardPages/dashboardsFormValidationPage.js";
import { AlertsFormValidationPage } from "./alertsPages/alertsFormValidationPage.js";
import { OnboardingFormValidationPage } from "./generalPages/onboardingFormValidationPage.js";
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
import { CrossLinkPage } from "./generalPages/crossLinkPage.js";
import { ModelPricingPage } from "./generalPages/modelPricingPage.js";
import { EditionFeaturesPage } from "./generalPages/editionFeaturesPage.js";
import { RegexPatternsFormValidationPage } from "./generalPages/regexPatternsFormValidationPage.js";
import { CipherKeysFormValidationPage } from "./generalPages/cipherKeysFormValidationPage.js";
import { SharedComponentsFormValidationPage } from "./generalPages/sharedComponentsFormValidationPage.js";
import { SettingsFormValidationPage } from "./generalPages/settingsFormValidationPage.js";
import { AiToolsetsFormValidationPage } from "./generalPages/aiToolsetsFormValidationPage.js";
import { RumFormValidationPage } from "./generalPages/rumFormValidationPage.js";
const SchemaPage = require("./generalPages/schemaPage.js");
const SchemaLoadPage = require("./generalPages/schemaLoadPage.js");
const APICleanup = require("./apiCleanup.js");
const WorkflowsPage = require("./workflowsPages/workflowsPage.js");

// ===== LOGS, REPORTS, STREAMS, PIPELINES ADDITIONAL PAGE OBJECTS =====
import { LogsQueryPage } from "./logsPages/logsQueryPage.js";
import UnflattenedPage from "./logsPages/unflattened.js";

// ===== SDR (SENSITIVE DATA REDACTION) PAGE OBJECTS =====
import { SDRPatternsPage } from "./sdrPages/sdrPatternsPage.js";
import { SDRVerificationPage } from "./sdrPages/sdrVerificationPage.js";
import { StreamAssociationPage } from "./streamsPages/streamAssociationPage.js";
import { StreamsFormValidationPage } from "./streamsPages/streamsFormValidationPage.js";

// ===== FUNCTIONS PAGE OBJECTS =====
const FunctionsPage = require("./functionsPages/functionsPage.js");
const { ActionScriptsFormValidationPage } = require("./functionsPages/actionScriptsFormValidationPage.js");
const FunctionsFormValidationPage = require("./functionsPages/functionsFormValidationPage.js");

// ===== ANOMALY DETECTION PAGE OBJECTS =====
const { AnomalyDetectionPage } = require("./anomalyPages/anomalyDetectionPage.js");
const { AnomalyFormValidationPage } = require("./anomalyPages/anomalyFormValidationPage.js");

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
    this.dashboardSqlAutocomplete = new DashboardSqlAutocomplete(page);
    this.dashboardPromQLEditor = new DashboardPromQLEditor(page);
    this.dashboardMultiSQL = new DashboardMultiSQL(page);
    this.dashboardMaxQueryRange = new DashboardMaxQueryRange(page);
    this.dashboardDrilldown = new DashboardDrilldownPage(page);
    this.dashboardLegendsCopy = new DashboardLegendsCopy(page);
    this.dashboardFilter = new DashboardFilter(page);
    this.dashboardImport = new DashboardImport(page);
    this.dashboardShareExport = new DashboardShareExportPage(page);
    this.dashboardTimeRefresh = new DashboardTimeRefresh(page);
    this.dateTimeHelper = new DateTimeHelper(page);
    this.dashboardPanelTime = new DashboardPanelTime(page);
    this.logsVisualise = new LogsVisualise(page);
    this.dashboardPage = new DashboardPage(page);

    // ===== EXISTING ALERTS PAGE OBJECT =====
    this.alertsPage = new AlertsPage(page);
    this.alertHistoryPage = new AlertHistoryPage(page);

    // ===== API CLEANUP =====
    this.apiCleanup = new APICleanup(page);

    // ===== WORKFLOWS (v1) PAGE OBJECT =====
    this.workflowsPage = new WorkflowsPage(page);

    // ===== SANITY SPEC ADDITIONAL PAGE OBJECTS =====
    this.logsPage = new LogsPage(page);
    this.streamsPage = new StreamsPage(page);
    this.alertTemplatesPage = new AlertTemplatesPage(page);
    this.alertDestinationsPage = new AlertDestinationsPage(page);
    this.pipelinesPage = new PipelinesPage(page);
    this.pipelinesFormValidation = new PipelinesFormValidationPage(page);
    this.loginPage = isCloudEnvironment() ? new CloudLoginPage(page) : new LoginPage(page);
    this.ingestionPage = new IngestionPage(page);
    this.ingestionConfigPage = new IngestionConfigPage(page);

    // ===== GENERAL TESTS ADDITIONAL PAGE OBJECTS =====
    this.homePage = new HomePage(page);
    this.metricsPage = new MetricsPage(page);
    this.metricsQueryEditorPage = new MetricsQueryEditorPage(page);
    this.metricsBuilderPage = new MetricsBuilderPage(page);
    this.tracesPage = new TracesPage(page);
    this.serviceGraphPage = new ServiceGraphPage(page);
    this.servicesCatalogPage = new ServicesCatalogPage(page);
    this.rumPage = new RumPage(page);
    this.reportsPage = new ReportsPage(page);
    this.reportFoldersPage = new ReportFoldersPage(page);
    this.reportsFormValidation = new ReportsFormValidationPage(page);
    this.dataPage = new DataPage(page);
    this.iamPage = new IamPage(page);
    this.ingestionTokensPage = new IngestionTokensPage(page);
    this.iamFormValidation = new IamFormValidationPage(page);
    this.dashboardsFormValidation = new DashboardsFormValidationPage(page);
    this.alertsFormValidation = new AlertsFormValidationPage(page);
    this.onboardingFormValidation = new OnboardingFormValidationPage(page);
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
    this.crossLinkPage = new CrossLinkPage(page);
    this.modelPricingPage = new ModelPricingPage(page);
    this.editionFeaturesPage = new EditionFeaturesPage(page);
    this.regexPatternsFormValidation = new RegexPatternsFormValidationPage(page);
    this.sharedComponentsFormValidation = new SharedComponentsFormValidationPage(page);
    this.schemaPage = new SchemaPage(page);
    this.schemaLoadPage = new SchemaLoadPage(page);

    // ===== LOGS, REPORTS, STREAMS, PIPELINES ADDITIONAL PAGE OBJECTS =====
    this.logsQueryPage = new LogsQueryPage(page);
    this.unflattenedPage = new UnflattenedPage(page);

    // ===== SDR (SENSITIVE DATA REDACTION) PAGE OBJECTS =====
    this.sdrPatternsPage = new SDRPatternsPage(page);
    this.sdrVerificationPage = new SDRVerificationPage(page);
    this.streamAssociationPage = new StreamAssociationPage(page);
    this.streamsFormValidation = new StreamsFormValidationPage(page);

    // ===== FUNCTIONS PAGE OBJECTS =====
    this.functionsPage = new FunctionsPage(page);
    this.actionScriptsFormValidation = new ActionScriptsFormValidationPage(page);
    this.functionsFormValidation = new FunctionsFormValidationPage(page);

    // ===== CIPHER KEYS PAGE OBJECTS =====
    this.cipherKeysFormValidation = new CipherKeysFormValidationPage(page);
    this.settingsFormValidation = new SettingsFormValidationPage(page);

    // ===== ANOMALY DETECTION PAGE OBJECTS =====
    this.anomalyDetectionPage = new AnomalyDetectionPage(page, this.commonActions);
    this.anomalyFormValidation = new AnomalyFormValidationPage(page);
    this.aiToolsetsFormValidation = new AiToolsetsFormValidationPage(page);

    // ===== RUM PAGE OBJECTS =====
    this.rumFormValidation = new RumFormValidationPage(page);
    this.rumSessionsPage = new RumSessionsPage(page);
    this.rumPerformancePage = new RumPerformancePage(page);
    this.rumIngestionPage = new RumIngestionPage(page);
    this.rumSourcemapsPage = new RumSourcemapsPage(page);
  }
}

module.exports = PageManager;
