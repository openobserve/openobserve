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

import {
  routeGuard,
  useLocalUserInfo,
  useLocalCurrentUser,
  invalidateLoginData,
} from "@/utils/zincutils";
import config from "@/aws-exports";
import Home from "@/views/HomeView.vue";
import ImportDashboard from "@/views/Dashboards/ImportDashboard.vue";
import About from "@/views/About.vue";
import MemberSubscription from "@/views/MemberSubscription.vue";
import Error404 from "@/views/Error404.vue";
import ShortUrl from "@/views/ShortUrl.vue";

const Search = () => import("@/plugins/logs/Index.vue");
const SearchJobInspector = () =>
  import("@/plugins/logs/SearchJobInspector.vue");
const AppMetrics = () => import("@/plugins/metrics/Index.vue");
const AppTraces = () => import("@/plugins/traces/Index.vue");
const PromQLQueryBuilder = () => import("@/views/PromQL/QueryBuilder.vue");

const TraceDetails = () => import("@/plugins/traces/TraceDetails.vue");

const ViewDashboard = () => import("@/views/Dashboards/ViewDashboard.vue");
const AddPanel = () => import("@/views/Dashboards/addPanel/AddPanel.vue");
const StreamExplorer = () => import("@/views/StreamExplorer.vue");
const LogStream = () => import("@/views/LogStream.vue");
const Alerts = () => import("@/views/AppAlerts.vue");
const Dashboards = () => import("@/views/Dashboards/Dashboards.vue");
const AlertList = () => import("@/components/alerts/AlertList.vue");
const Settings = () => import("@/components/settings/index.vue");

const Functions = () => import("@/views/Functions.vue");
const FunctionList = () => import("@/components/functions/FunctionList.vue");
const AssociatedStreamFunction = () =>
  import("@/components/functions/AssociatedStreamFunction.vue");
const EnrichmentTableList = () =>
  import("@/components/functions/EnrichmentTableList.vue");
const RealUserMonitoring = () => import("@/views/RUM/RealUserMonitoring.vue");
const SessionViewer = () => import("@/views/RUM/SessionViewer.vue");
const ErrorViewer = () => import("@/views/RUM/ErrorViewer.vue");
const AppPerformance = () => import("@/views/RUM/AppPerformance.vue");
const AppErrors = () => import("@/views/RUM/AppErrors.vue");
const AppSessions = () => import("@/views/RUM/AppSessions.vue");
const SourceMaps = () => import("@/views/RUM/SourceMaps.vue");
const UploadSourceMaps = () => import("@/views/RUM/UploadSourceMaps.vue");

const ReportList = () => import("@/components/reports/ReportList.vue");
const CreateReport = () => import("@/components/reports/CreateReport.vue");

const PerformanceSummary = () =>
  import("@/components/rum/performance/PerformanceSummary.vue");
const WebVitalsDashboard = () =>
  import("@/components/rum/performance/WebVitalsDashboard.vue");
const ErrorsDashboard = () =>
  import("@/components/rum/performance/ErrorsDashboard.vue");
const ApiDashboard = () =>
  import("@/components/rum/performance/ApiDashboard.vue");
const PipelineEditor = () => import("@/components/pipeline/PipelineEditor.vue");
const PipelinesList = () => import("@/components/pipeline/PipelinesList.vue");

const ImportPipeline = () => import("@/components/pipeline/ImportPipeline.vue");

import useIngestionRoutes from "./useIngestionRoutes";
import useEnterpriseRoutes from "./useEnterpriseRoutes";
import config from "@/aws-exports";
import useManagementRoutes from "./useManagementRoutes";
import Login from "@/views/Login.vue";

const useRoutes = () => {
  const parentRoutes: any = [
    {
      path: "/login",
      component: Login,
      meta: {
        title: "Login",
      },
    },
    {
      path: "/logout",
      beforeEnter(to: any, from: any, next: any) {
        // Clear backend auth cookies before redirecting to login (#10900)
        invalidateLoginData();
        useLocalCurrentUser("", true);
        useLocalUserInfo("", true);

        window.location.href = "/login";
      },
    },
    {
      path: "/cb",
      name: "callback",
      component: Login,
      meta: {
        title: "Login Callback",
      },
    },
  ];

  const homeChildRoutes = [
    {
      path: "",
      name: "home",
      component: Home,
      meta: {
        keepAlive: true,
        title: "Home",
        titleKey: "menu.home",
        searchable: true,
        icon: "home",
        section: "General",
        keywords: ["overview"],
      },
    },
    {
      path: "logs",
      name: "logs",
      component: Search,
      meta: {
        keepAlive: true,
        title: "Logs",
        titleKey: "menu.search",
        searchable: true,
        icon: "article",
        section: "Observability",
        keywords: [
          "log search",
          "log query",
          "field list",
          "log patterns",
          "saved views",
        ],
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "logs/inspector",
      name: "searchJobInspector",
      component: SearchJobInspector,
      meta: {
        keepAlive: false,
        title: "Search Job Inspector",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "metrics",
      name: "metrics",
      component: AppMetrics,
      meta: {
        keepAlive: true,
        title: "Metrics",
        titleKey: "menu.metrics",
        searchable: true,
        icon: "query_stats",
        section: "Observability",
        keywords: [
          "prometheus",
          "promql",
          "time series",
          "gauge",
          "counter",
          "metric explorer",
        ],
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "promql-builder",
      name: "promqlBuilder",
      component: PromQLQueryBuilder,
      meta: {
        keepAlive: false,
        title: "PromQL Query Builder",
        titleKey: "menu.metrics",
        searchable: true,
        icon: "functions",
        section: "Observability",
        keywords: [
          "promql builder",
          "prometheus query",
          "metrics query builder",
          "PromQL Query Builder",
        ],
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "traces",
      name: "traces",
      component: AppTraces,
      meta: {
        keepAlive: true,
        title: "Traces",
        titleKey: "menu.traces",
        searchable: true,
        icon: "timeline",
        section: "Observability",
        keywords: [
          "distributed tracing",
          "spans",
          "service graph",
          "opentelemetry",
          "latency",
          "APM",
        ],
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "traces/trace-details",
      name: "traceDetails",
      component: TraceDetails,
      meta: {
        title: "Trace Details",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      // Redirect old service-graph route to traces page
      path: "service-graph",
      redirect: "/traces",
    },
    {
      name: "streamExplorer",
      path: "streams/stream-explore",
      component: StreamExplorer,
      props: true,
      meta: {
        title: "Stream Explorer",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "streams",
      name: "logstreams",
      component: LogStream,
      meta: {
        title: "Streams",
        titleKey: "menu.index",
        searchable: true,
        icon: "storage",
        section: "Management",
        keywords: [
          "log streams",
          "metrics streams",
          "traces streams",
          "stream schema",
          "stream management",
          "Sensitive Data Redaction",
          "Schema Settings",
          "Extended Retention",
        ],
        keywordKeys: [
          "logStream.labelLogs",
          "logStream.labelMetrics",
          "logStream.labelTraces",
          "logStream.labelMetadata",
          "logStream.sdr",
        ],
        create: {
          labelKey: "commandPalette.newStream",
          keywords: ["new stream", "add stream", "create stream"],
          query: { action: "create" },
        },
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "about",
      name: "about",
      component: About,
      meta: {
        keepAlive: true,
        title: "About",
      },
    },
    {
      path: "dashboards",
      name: "dashboards",
      component: Dashboards,
      meta: {
        keepAlive: false,
        title: "Dashboards",
        titleKey: "menu.dashboard",
        searchable: true,
        icon: "dashboard",
        section: "Visualization",
        keywords: [
          "charts",
          "panels",
          "visualization",
          "graphs",
          "dashboard folders",
        ],
        create: {
          labelKey: "commandPalette.newDashboard",
          keywords: ["new dashboard", "add dashboard", "create dashboard"],
          query: { action: "create" },
        },
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "/dashboards/view",
      name: "viewDashboard",
      component: ViewDashboard,
      props: true,
      meta: {
        title: "View Dashboard",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "/dashboards/import",
      name: "importDashboard",
      component: ImportDashboard,
      props: true,
      meta: {
        title: "Import Dashboard",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "/dashboards/add_panel",
      name: "addPanel",
      component: AddPanel,
      props: true,
      meta: {
        title: "Add Panel",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "member_subscription",
      name: "member_subscription",
      component: MemberSubscription,
      meta: {
        keepAlive: true,
        title: "Member Subscription",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    ...useManagementRoutes(),
    {
      path: "pipeline",
      name: "pipeline",
      component: Functions,
      meta: {
        title: "Pipeline",
        titleKey: "menu.pipeline",
        searchable: true,
        icon: "account_tree",
        section: "Management",
        keywords: [
          "VRL functions",
          "enrichment tables",
          "data pipeline",
          "stream processing",
        ],
        keywordKeys: [
          "function.streamPipeline",
          "function.header",
          "function.enrichmentTables",
          "pipeline.evalTemplates",
        ],
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "functions",
          name: "functionList",
          component: FunctionList,
          meta: {
            title: "Functions",
            titleKey: "function.header",
            searchable: true,
            icon: "functions",
            section: "Management",
            keywords: [
              "VRL functions",
              "data transformation",
              "stream functions",
              "custom functions",
            ],
            create: {
              labelKey: "commandPalette.newFunction",
              keywords: ["new function", "add function", "create VRL function"],
              query: { action: "add" },
            },
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "enrichment-tables",
          name: "enrichmentTables",
          component: EnrichmentTableList,
          meta: {
            title: "Enrichment Tables",
            titleKey: "function.enrichmentTables",
            searchable: true,
            icon: "dataset",
            section: "Management",
            keywords: [
              "lookup tables",
              "data enrichment",
              "reference data",
              "enrichment",
            ],
            create: {
              labelKey: "commandPalette.newEnrichmentTable",
              keywords: ["new enrichment", "add enrichment table", "create lookup table"],
              query: { action: "create" },
            },
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "pipelines",
          name: "pipelines",
          component: PipelinesList,
          meta: {
            title: "Pipelines",
            titleKey: "function.streamPipeline",
            searchable: true,
            icon: "lan",
            section: "Management",
            keywords: [
              "stream pipelines",
              "data pipeline",
              "log pipeline",
              "pipeline list",
            ],
            create: {
              labelKey: "commandPalette.newEvaluationTemplate",
              keywords: ["new evaluation template", "add eval template", "create evaluation template"],
              query: { action: "create" },
            },
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "edit",
              name: "pipelineEditor",
              component: PipelineEditor,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "add",
              name: "createPipeline",
              component: PipelineEditor,
              meta: {
                create: {
                  labelKey: "commandPalette.newPipeline",
                  icon: "account_tree",
                  keywords: ["new pipeline", "add pipeline", "create stream pipeline"],
                },
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "import",
              name: "importPipeline",
              component: ImportPipeline,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "history",
              name: "pipelineHistory",
              component: () =>
                import("@/components/pipelines/PipelineHistory.vue"),
              meta: {
                title: "Pipeline History",
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "backfill",
              name: "pipelineBackfill",
              component: () =>
                import("@/components/pipelines/BackfillJobsList.vue"),
              meta: {
                title: "Pipeline Backfill Jobs",
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
      ],
    },
    {
      path: "alerts",
      name: "alertList",
      component: AlertList,
      meta: {
        title: "Alerts",
        titleKey: "menu.alerts",
        searchable: true,
        icon: "notifications",
        section: "Observability",
        keywords: [
          "monitors",
          "notifications",
          "anomaly detection",
          "scheduled alerts",
          "real-time alerts",
          "alert rules",
        ],
        keywordKeys: [
          "alerts.all",
          "alerts.scheduled",
          "alerts.realTime",
          "alerts.anomalyDetection",
        ],
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "alerts/add",
      name: "addAlert",
      component: () => import("@/views/AddAlertView.vue"),
      meta: {
        title: "Add Alert",
        create: {
          labelKey: "commandPalette.newAlert",
          icon: "notifications",
          keywords: ["new alert", "create alert", "add monitor", "new monitor"],
        },
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "alerts/anomaly/add",
      name: "addAnomalyDetection",
      component: () => import("@/views/AddAlertView.vue"),
      meta: {
        title: "Add Anomaly Detection",
      },
      beforeEnter(to: any, from: any, next: any) {
        const store = (window as any).store;
        const isOss = store?.state?.zoConfig?.build_type === "opensource";
        if (
          isOss ||
          (config.isEnterprise !== "true" && config.isCloud !== "true")
        ) {
          next({
            name: "alertList",
            query: { org_identifier: to.query.org_identifier },
          });
          return;
        }
        routeGuard(to, from, next);
      },
    },
    {
      path: "alerts/anomaly/edit/:anomaly_id",
      name: "editAnomalyDetection",
      component: () => import("@/views/AddAlertView.vue"),
      meta: {
        title: "Edit Anomaly Detection",
      },
      beforeEnter(to: any, from: any, next: any) {
        const store = (window as any).store;
        const isOss = store?.state?.zoConfig?.build_type === "opensource";
        if (
          isOss ||
          (config.isEnterprise !== "true" && config.isCloud !== "true")
        ) {
          next({
            name: "alertList",
            query: { org_identifier: to.query.org_identifier },
          });
          return;
        }
        routeGuard(to, from, next);
      },
    },
    {
      path: "alerts/history",
      name: "alertHistory",
      component: () => import("@/components/alerts/AlertHistory.vue"),
      meta: {
        title: "Alert History",
        searchable: true,
        icon: "history",
        section: "Observability",
        keywords: ["triggered alerts", "fired alerts", "alert logs"],
        keywordKeys: ["alerts.all", "alerts.scheduled", "alerts.realTime"],
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "alerts/insights",
      name: "alertInsights",
      component: () => import("@/components/alerts/AlertInsights.vue"),
      meta: {
        title: "Alert Insights",
        searchable: true,
        icon: "insights",
        section: "Observability",
        keywords: ["alert analytics", "alert quality", "noise reduction"],
        keywordKeys: [
          "alerts.insights.tabs.overview",
          "alerts.insights.tabs.frequency",
          "alerts.insights.tabs.correlation",
          "alerts.insights.tabs.quality",
        ],
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "alerts/import-semantic-groups",
      name: "importSemanticGroups",
      component: () => import("@/components/alerts/ImportSemanticGroups.vue"),
      meta: {
        title: "Import Semantic Groups",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "short/:id",
      name: "shortUrl",
      component: ShortUrl,
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      props: true,
    },
    {
      path: "rum",
      name: "RUM",
      component: RealUserMonitoring,
      meta: {
        title: "Real User Monitoring",
        titleKey: "menu.rum",
        searchable: true,
        icon: "person_search",
        section: "Observability",
        keywords: [
          "session replay",
          "error tracking",
          "performance monitoring",
          "web vitals",
          "source maps",
          "browser monitoring",
          "frontend observability",
        ],
        keywordKeys: [
          "rum.sessions",
          "rum.errorTracking",
          "rum.performance",
          "rum.webVitals",
          "rum.overview",
          "rum.errors",
          "rum.api",
        ],
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "sessions",
          name: "Sessions",
          component: AppSessions,
          meta: {
            keepAlive: true,
            title: "RUM Sessions",
            titleKey: "rum.sessions",
            searchable: true,
            icon: "play_circle",
            section: "Observability",
            keywords: [
              "session replay",
              "user sessions",
              "RUM sessions",
              "browser sessions",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "sessions/view/:id",
          name: "SessionViewer",
          component: SessionViewer,
          props: true,
          meta: {
            keepAlive: false,
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "errors",
          name: "ErrorTracking",
          component: AppErrors,
          meta: {
            keepAlive: true,
            title: "RUM Error Tracking",
            titleKey: "rum.errorTracking",
            searchable: true,
            icon: "error",
            section: "Observability",
            keywords: [
              "error tracking",
              "JavaScript errors",
              "browser errors",
              "frontend exceptions",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "errors/view/:id",
          name: "ErrorViewer",
          component: ErrorViewer,
          props: true,
          meta: {
            keepAlive: true,
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "source-maps",
          name: "SourceMaps",
          component: SourceMaps,
          meta: {
            keepAlive: true,
            title: "Source Maps",
            searchable: true,
            icon: "map",
            section: "Observability",
            keywords: [
              "source maps",
              "stack trace",
              "JavaScript debugging",
              "upload source maps",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "upload-source-maps",
          name: "UploadSourceMaps",
          component: UploadSourceMaps,
          meta: {
            keepAlive: false,
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "performance",
          name: "RumPerformance",
          component: AppPerformance,
          props: true,
          meta: {
            keepAlive: true,
            title: "RUM Performance",
            titleKey: "rum.performance",
            searchable: true,
            icon: "speed",
            section: "Observability",
            keywords: [
              "performance monitoring",
              "Core Web Vitals",
              "page speed",
              "LCP",
              "FID",
              "CLS",
              "TTFB",
            ],
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "overview",
              name: "rumPerformanceSummary",
              component: PerformanceSummary,
              meta: {
                title: "Performance Overview",
                titleKey: "rum.overview",
                searchable: true,
                icon: "dashboard",
                section: "Observability",
                keywords: [
                  "performance summary",
                  "RUM overview",
                  "performance dashboard",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "web-vitals",
              name: "rumPerformanceWebVitals",
              component: WebVitalsDashboard,
              meta: {
                title: "Web Vitals",
                titleKey: "rum.webVitals",
                searchable: true,
                icon: "speed",
                section: "Observability",
                keywords: [
                  "Core Web Vitals",
                  "LCP",
                  "FID",
                  "CLS",
                  "TTFB",
                  "web performance",
                  "INP",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "errors",
              name: "rumPerformanceErrors",
              component: ErrorsDashboard,
              meta: {
                title: "Performance Errors",
                titleKey: "rum.errors",
                searchable: true,
                icon: "error_outline",
                section: "Observability",
                keywords: [
                  "JavaScript errors",
                  "runtime errors",
                  "performance errors",
                  "error rate",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "apis",
              name: "rumPerformanceApis",
              component: ApiDashboard,
              meta: {
                title: "Performance APIs",
                titleKey: "rum.api",
                searchable: true,
                icon: "api",
                section: "Observability",
                keywords: [
                  "API monitoring",
                  "network requests",
                  "AJAX",
                  "fetch",
                  "XHR",
                  "API latency",
                ],
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
          ],
        },
      ],
    },
    ...useIngestionRoutes(),
    ...useEnterpriseRoutes(),
    {
      path: "/:catchAll(.*)*",
      component: Error404,
      meta: {
        keepAlive: true,
        title: "404 - Not Found",
      },
    },
  ];

  if (config.isCloud === "false") {
    homeChildRoutes.splice(
      13,
      0,
      {
        path: "/reports",
        name: "reports",
        component: ReportList,
        props: true,
        meta: {
          title: "Reports",
          titleKey: "menu.report",
          searchable: true,
          icon: "summarize",
          section: "Visualization",
          keywords: [
            "scheduled reports",
            "PDF export",
            "email reports",
            "dashboard reports",
          ],
        },
        beforeEnter(to: any, from: any, next: any) {
          routeGuard(to, from, next);
        },
      },
      {
        path: "/reports/create",
        name: "createReport",
        component: CreateReport,
        props: true,
        meta: {
          title: "Create Report",
        },
        beforeEnter(to: any, from: any, next: any) {
          routeGuard(to, from, next);
        },
      },
    );
  }

  return { parentRoutes, homeChildRoutes };
};

export default useRoutes;
