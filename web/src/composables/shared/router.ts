// Copyright 2023 OpenObserve Inc.
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
} from "@/utils/zincutils";
import Home from "@/views/HomeView.vue";
import ImportDashboard from "@/views/Dashboards/ImportDashboard.vue";
import About from "@/views/About.vue";
import MemberSubscription from "@/views/MemberSubscription.vue";
import Error404 from "@/views/Error404.vue";
import ShortUrl from "@/views/ShortUrl.vue";

const Search = () => import("@/plugins/logs/Index.vue");
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
      },
    },
    {
      path: "logs",
      name: "logs",
      component: Search,
      meta: {
        keepAlive: true,
        title: "Logs",
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
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "functions",
          name: "functionList",
          component: FunctionList,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "enrichment-tables",
          name: "enrichmentTables",
          component: EnrichmentTableList,
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
        },
        {
          path: "pipelines",
          name: "pipelines",
          component: PipelinesList,
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
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "alerts/history",
      name: "alertHistory",
      component: () => import("@/components/alerts/AlertHistory.vue"),
      meta: {
        title: "Alert History",
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
          path: "performance",
          name: "RumPerformance",
          component: AppPerformance,
          props: true,
          meta: {
            keepAlive: true,
          },
          beforeEnter(to: any, from: any, next: any) {
            routeGuard(to, from, next);
          },
          children: [
            {
              path: "overview",
              name: "rumPerformanceSummary",
              component: PerformanceSummary,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "web-vitals",
              name: "rumPerformanceWebVitals",
              component: WebVitalsDashboard,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "errors",
              name: "rumPerformanceErrors",
              component: ErrorsDashboard,
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "apis",
              name: "rumPerformanceApis",
              component: ApiDashboard,
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
