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
import type { LocationQuery, LocationQueryRaw, RouteLocationRaw } from "vue-router";
import config from "@/aws-exports";
import { resolveTraceSearchMode, type TraceSearchMode } from "@/ts/interfaces/traces/trace.types";
import store from "@/stores";
import Home from "@/views/HomeView.vue";
import ImportDashboard from "@/views/Dashboards/ImportDashboard.vue";
import About from "@/views/About.vue";
import MemberSubscription from "@/views/MemberSubscription.vue";
import Error404 from "@/views/Error404.vue";
import ShortUrl from "@/views/ShortUrl.vue";
import { hasMetricsEditorParams } from "@/utils/metrics/metricsEditorParams";

const Search = () => import("@/plugins/logs/Index.vue");
const SearchJobInspector = () => import("@/plugins/logs/SearchJobInspector.vue");
const SearchHistory = () => import("@/plugins/logs/SearchHistory.vue");
const SearchSchedulersList = () => import("@/plugins/logs/SearchSchedulersList.vue");
const AppMetrics = () => import("@/plugins/metrics/Index.vue");
const AppMetricsExplorer = () => import("@/plugins/metrics/explorer/MetricsExplorer.vue");
const AppTraces = () => import("@/plugins/traces/Index.vue");
const PromQLQueryBuilder = () => import("@/views/PromQL/QueryBuilder.vue");

const TraceDetails = () => import("@/plugins/traces/TraceDetails.vue");
const SessionDetails = () => import("@/plugins/traces/SessionDetails.vue");

const supportedTraceTab = (tab: unknown): TraceSearchMode =>
  resolveTraceSearchMode(tab, config.isEnterprise === "true");

const canonicalTraceQuery = (
  query: LocationQuery | undefined,
  tab: TraceSearchMode,
): LocationQueryRaw => {
  const canonicalQuery: LocationQueryRaw = { ...(query ?? {}), tab };
  delete canonicalQuery.search_mode;
  return canonicalQuery;
};

const redirectToTraceTab =
  (tab: "service-graph" | "services-catalog") =>
  (to: { query: LocationQuery }): RouteLocationRaw => ({
    name: "traces",
    query: canonicalTraceQuery(to.query, supportedTraceTab(tab)),
  });

// Eager, not lazy: the shell hosts the keep-alive that every DBM tab lives in,
// so it is on the critical path for the first DBM route either way, and it is a
// single `<router-view>`.
import DbmShell from "@/views/DatabaseMonitoring/DbmShell.vue";

const DbmDatabasesPage = () => import("@/views/DatabaseMonitoring/DatabasesPage.vue");
const DbmQueriesPage = () => import("@/views/DatabaseMonitoring/QueriesPage.vue");
const DbmSamplesPage = () => import("@/views/DatabaseMonitoring/SamplesPage.vue");
const DbmQueryDetailPage = () => import("@/views/DatabaseMonitoring/QueryDetailPage.vue");
const DbmActivityPage = () => import("@/views/DatabaseMonitoring/ActivityPage.vue");
const DbmDeadlocksPage = () => import("@/views/DatabaseMonitoring/DeadlocksPage.vue");
const DbmBlockedQueriesPage = () => import("@/views/DatabaseMonitoring/BlockedQueriesPage.vue");
const DbmTableHealthPage = () => import("@/views/DatabaseMonitoring/TableHealthPage.vue");

/**
 * The SECTION gate. Runtime flag only — no build-type conjunct, because the
 * Database Monitoring section itself is not enterprise-only. The build-type
 * gate for its three enterprise tabs is `dbmEnterpriseGuard` below, applied per
 * route; adding an isEnterprise conjunct here would close the whole section on
 * OSS instead.
 *
 * The store is IMPORTED, not read off `window`: nothing in the app ever assigns
 * `window.store`, so the old `(window as any).store` read was permanently
 * `undefined`. On the negative gates elsewhere in this file that fails OPEN and
 * goes unnoticed, but this gate is positive — it made every Database Monitoring
 * route redirect to /traces no matter what `/config` returned, i.e. the feature
 * was unreachable in a browser. `import store from "@/stores"` is the singleton
 * `useEnterpriseRoutes.ts` already uses for exactly this kind of runtime
 * `/config` flag, and it works outside a component where `useStore()` cannot.
 */
/**
 * `main.ts` calls `getConfig()` WITHOUT awaiting it and mounts the app from a
 * `.finally()` on locale loading, so on a cold load (deep link, refresh, or a
 * Playwright `page.goto`) this guard can run before `/config` has come back and
 * `zoConfig` is still `{}`. Treating "not loaded yet" as "disabled" bounced a
 * direct URL to /traces even with the flag on. Only an explicit `false` — a
 * config that HAS loaded and says off — is a redirect; an unloaded config lets
 * the route through, and the page's own `dbmEnabled` check renders the disabled
 * state if it really is off.
 */
const dbMonitoringEnabled = (): boolean => {
  const zoConfig = store?.state?.zoConfig;
  const configLoaded = !!zoConfig && Object.keys(zoConfig).length > 0;
  if (!configLoaded) return true;
  return Boolean(zoConfig.database_monitoring_enabled);
};

/**
 * Guard for the three enterprise-only DBM tabs — Deadlocks, Blocked queries and
 * Table health, whose reads an OSS backend answers 403 on. Disabling the tabs
 * cannot stop a PASTED or bookmarked URL, so each route needs its own guard.
 *
 * It lands on the DBM overview, keeping the reader inside the section they
 * aimed at, rather than on a page that renders empty because every fetch was
 * refused. The scope travels so the window and filters survive the bounce.
 *
 * `isEnterprise` is a STRING — compared against the literal `"true"`, never
 * coerced, since `Boolean("false")` is true and would open the gate on OSS.
 * Same shape as the `serviceGraph` guard below.
 */
const dbmEnterpriseGuard = (to: any, from: any, next: any) => {
  if (config.isEnterprise !== "true") {
    next({ name: "dbmDatabases", query: to.query });
    return;
  }
  routeGuard(to, from, next);
};

const ViewDashboard = () => import("@/views/Dashboards/ViewDashboard.vue");
const AddPanel = () => import("@/views/Dashboards/addPanel/AddPanel.vue");
const StreamExplorer = () => import("@/views/StreamExplorer.vue");
const LogStream = () => import("@/views/LogStream.vue");
const Dashboards = () => import("@/views/Dashboards/Dashboards.vue");
const AlertList = () => import("@/components/alerts/AlertList.vue");
const AlertsDestinationList = () => import("@/components/alerts/AlertsDestinationList.vue");
const TemplateList = () => import("@/components/alerts/TemplateList.vue");
const AlertLibrary = () => import("@/views/AlertLibrary/AlertLibrary.vue");

const Functions = () => import("@/views/Functions.vue");
const FunctionList = () => import("@/components/functions/FunctionList.vue");
const EnrichmentTableList = () => import("@/components/functions/EnrichmentTableList.vue");
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

const PerformanceSummary = () => import("@/components/rum/performance/PerformanceSummary.vue");
const WebVitalsDashboard = () => import("@/components/rum/performance/WebVitalsDashboard.vue");
const ErrorsDashboard = () => import("@/components/rum/performance/ErrorsDashboard.vue");
const ApiDashboard = () => import("@/components/rum/performance/ApiDashboard.vue");
const PipelineEditor = () => import("@/components/pipeline/PipelineEditor.vue");
const PipelinesList = () => import("@/components/pipeline/PipelinesList.vue");

const ImportPipeline = () => import("@/components/pipeline/ImportPipeline.vue");

import useIngestionRoutes from "./useIngestionRoutes";
import useEnterpriseRoutes from "./useEnterpriseRoutes";
import useManagementRoutes from "./useManagementRoutes";
import Login from "@/views/Login.vue";

const useRoutes = () => {
  const parentRoutes: any = [
    {
      path: "/login",
      component: Login,
      meta: {
        titleKey: "login.login",
      },
    },
    {
      path: "/logout",
      beforeEnter(_to: any, _from: any, _next: any) {
        // Clear backend auth cookies before redirecting to login
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
        titleKey: "routeTitles.loginCallback",
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
        titleKey: "menu.home",
      },
    },
    // TEMPORARY: preview route for the OEmptyState design sample. Remove once
    // the empty-state design is approved (along with src/views/EmptyStateDemo.vue).
    {
      path: "empty-state-demo",
      name: "emptyStateDemo",
      component: () => import("@/views/EmptyStateDemo.vue"),
      meta: {
        keepAlive: false,
        titleKey: "routeTitles.emptyStateDemo",
      },
    },
    {
      path: "logs",
      name: "logs",
      component: Search,
      meta: {
        keepAlive: true,
        titleKey: "menu.search",
      },
      beforeEnter(to: any, from: any, next: any) {
        // Back-compat: Search History / Scheduler used to be `?action=…` overlays
        // on /logs. Redirect old bookmarks / shared links to the standalone routes.
        const action = to.query?.action;
        if (action === "history") {
          next({ name: "searchHistory", query: { org_identifier: to.query?.org_identifier } });
          return;
        }
        if (action === "search_scheduler") {
          next({ name: "searchScheduler", query: { org_identifier: to.query?.org_identifier } });
          return;
        }
        routeGuard(to, from, next);
      },
    },
    {
      path: "logs/inspector",
      name: "searchJobInspector",
      component: SearchJobInspector,
      meta: {
        keepAlive: false,
        titleKey: "logs.searchJobInspector.title",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      // Standalone page (was a `?action=history` overlay on /logs). Not
      // enterprise-gated — available in OSS; the component itself shows an
      // "enable usage reporting" message when zoConfig.usage_enabled is off.
      path: "logs/search-history",
      name: "searchHistory",
      component: SearchHistory,
      meta: {
        keepAlive: false,
        titleKey: "search_history.title",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      // Standalone page (was a `?action=search_scheduler` overlay on /logs).
      // Enterprise-only: the scheduled-search endpoints 403 in OSS, so a
      // hand-typed URL is bounced back to the logs page.
      path: "logs/search-scheduler",
      name: "searchScheduler",
      component: SearchSchedulersList,
      meta: {
        keepAlive: false,
        titleKey: "routeTitles.searchScheduler",
      },
      beforeEnter(to: any, from: any, next: any) {
        if (config.isEnterprise !== "true") {
          next({ name: "logs" });
          return;
        }
        routeGuard(to, from, next);
      },
    },
    {
      // The zero-query browse grid.
      //
      // Back-compat: a `/metrics` URL carrying editor-specific params (the
      // `metrics_data` blob, or anything in METRICS_PARAMS) is a deep link
      // created before the explorer existed — a shared chart, a link from logs
      // or an alert. Those redirect to the editor with query and hash intact,
      // so every existing link keeps working.
      path: "metrics",
      name: "metrics",
      component: AppMetricsExplorer,
      meta: {
        keepAlive: false,
        titleKey: "menu.metrics",
      },
      beforeEnter(to: any, from: any, next: any) {
        if (hasMetricsEditorParams(to.query) && to.query.mode !== "visualize") {
          routeGuard(to, from, () =>
            next({
              name: "metricsEditor",
              query: to.query,
              hash: to.hash,
              replace: true,
            }),
          );
          return;
        }
        routeGuard(to, from, next);
      },
    },
    {
      // Stays registered in BOTH flag states, so editor bookmarks created while
      // the explorer was enabled survive a rollback.
      path: "metrics/editor",
      name: "metricsEditor",
      component: AppMetrics,
      meta: {
        keepAlive: true,
        titleKey: "menu.metrics",
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
        titleKey: "metrics.queryBuilder.title",
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
        titleKey: "menu.traces",
      },
      beforeEnter(to: any, from: any, next: any) {
        const tab = supportedTraceTab(to.query?.tab);
        if (to.query?.tab !== tab || to.query?.search_mode !== undefined) {
          next({
            name: "traces",
            query: canonicalTraceQuery(to.query, tab),
            hash: to.hash,
            replace: true,
          });
          return;
        }
        routeGuard(to, from, next);
      },
    },
    {
      path: "traces/service-graph",
      redirect: redirectToTraceTab("service-graph"),
    },
    {
      path: "traces/services",
      redirect: redirectToTraceTab("services-catalog"),
    },
    {
      path: "infra/databases",
      component: DbmShell,
      beforeEnter(to: any, from: any, next: any) {
        if (!dbMonitoringEnabled()) {
          next({ name: "traces", query: to.query });
          return;
        }
        routeGuard(to, from, next);
      },
      children: [
        {
          path: "",
          name: "dbmDatabases",
          component: DbmDatabasesPage,
          meta: {
            keepAlive: true,
            title: "Databases",
          },
        },
        {
          path: "queries",
          name: "dbmQueries",
          component: DbmQueriesPage,
          meta: {
            keepAlive: true,
            title: "Databases",
          },
        },
        {
          path: "samples",
          name: "dbmSamples",
          component: DbmSamplesPage,
          meta: {
            keepAlive: true,
            title: "Databases",
          },
        },
        {
          path: "activity",
          name: "dbmActivity",
          component: DbmActivityPage,
          meta: {
            keepAlive: true,
            title: "Databases",
          },
        },
        {
          path: "deadlocks",
          name: "dbmDeadlocks",
          component: DbmDeadlocksPage,
          beforeEnter: dbmEnterpriseGuard,
          meta: {
            keepAlive: true,
            title: "Databases",
          },
        },
        {
          // `blocking` rather than `blocked`: the URL names the phenomenon the
          // page is about, and both perspectives of it live on this one route.
          path: "blocking",
          name: "dbmBlocking",
          component: DbmBlockedQueriesPage,
          beforeEnter: dbmEnterpriseGuard,
          meta: {
            keepAlive: true,
            title: "Databases",
          },
        },
        {
          path: "table-health",
          name: "dbmTableHealth",
          component: DbmTableHealthPage,
          beforeEnter: dbmEnterpriseGuard,
          meta: {
            keepAlive: true,
            title: "Databases",
          },
        },
        {
          // The query id travels as a query param rather than a path segment:
          // it is opaque, can be long, and the page needs the rest of the scope
          // (stream, database, window) alongside it for the URL to be shareable
          // — which is the whole point of the incident-summary permalink.
          // `keepAlive` is deliberately off: a cached instance would show the
          // previous query's charts when arriving from a different span.
          path: "query",
          name: "dbmQueryDetail",
          component: DbmQueryDetailPage,
          meta: {
            title: "Query detail",
          },
        },
      ],
    },
    {
      // Database Monitoring moved from `traces/databases` to `infra/databases`.
      // Every old link keeps working: the wildcard carries the tab segment
      // (`queries`, `deadlocks`, `table-health`, …) and the `query` object is
      // forwarded, so a permalink's scope filters and time range survive the
      // hop rather than dumping the reader on an unfiltered Databases tab.
      path: "traces/databases/:dbmPath(.*)*",
      redirect: (to: any) => ({
        path: `/infra/databases${to.params.dbmPath?.length ? `/${[to.params.dbmPath].flat().join("/")}` : ""}`,
        query: to.query,
      }),
    },
    {
      path: "traces/trace-details",
      name: "traceDetails",
      component: TraceDetails,
      meta: {
        titleKey: "routeTitles.traceDetails",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "traces/session-details",
      name: "sessionDetails",
      component: SessionDetails,
      meta: {
        titleKey: "routeTitles.sessionDetails",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      // Redirect the oldest Service Graph URL to the canonical in-page tab.
      path: "service-graph",
      redirect: redirectToTraceTab("service-graph"),
    },
    {
      name: "streamExplorer",
      path: "streams/stream-explore",
      component: StreamExplorer,
      props: true,
      meta: {
        titleKey: "routeTitles.streamExplorer",
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
        titleKey: "menu.index",
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
        titleKey: "menu.about",
      },
    },
    {
      path: "dashboards",
      name: "dashboards",
      component: Dashboards,
      meta: {
        keepAlive: false,
        titleKey: "menu.dashboard",
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
        titleKey: "routeTitles.viewDashboard",
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
        titleKey: "dashboard.importDashboard",
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
        titleKey: "panel.addPanel",
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
        titleKey: "billing.memberSubscription.title",
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
        titleKey: "pipeline.pipelineLabel",
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
              component: () => import("@/components/pipelines/PipelineHistory.vue"),
              meta: {
                titleKey: "pipeline.history",
              },
              beforeEnter(to: any, from: any, next: any) {
                routeGuard(to, from, next);
              },
            },
            {
              path: "backfill",
              name: "pipelineBackfill",
              component: () => import("@/components/pipelines/BackfillJobsList.vue"),
              meta: {
                titleKey: "routeTitles.pipelineBackfillJobs",
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
      path: "slos",
      name: "sloList",
      component: () => import("@/views/slos/SloList.vue"),
      meta: {
        titleKey: "menu.slos",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      // Literal segments before the {slo_id} catch-all, matching the router's
      // ordering rule.
      path: "slos/add",
      name: "addSlo",
      component: () => import("@/views/slos/AddSlo.vue"),
      meta: {
        titleKey: "slos.newTitle",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "slos/edit/:slo_id",
      name: "editSlo",
      component: () => import("@/views/slos/AddSlo.vue"),
      meta: {
        titleKey: "slos.editTitle",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "slos/:slo_id",
      name: "sloDetail",
      component: () => import("@/views/slos/SloDetail.vue"),
      meta: {
        titleKey: "routeTitles.sloDetail",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "alerts",
      name: "alertList",
      component: AlertList,
      meta: {
        titleKey: "menu.alerts",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      // Notification destinations and templates: alerting configuration, so
      // they moved out of /settings (which wrapped them in the Settings shell)
      // and into the Reliability rail group.
      //
      // Top-level and FLAT, not under /alerts: they are siblings of Alerts, not
      // sub-pages of it. Nesting them made the URL claim otherwise, and the rail
      // believed it — /alerts/destinations lit up Alerts as well, because that
      // is exactly how a real drill-down like /alerts/detail/:id behaves. Every
      // other Reliability section is top-level too (/alerts, /slos, /incidents).
      //
      // The route NAMES are unchanged — every call site navigates by name — and
      // the old /settings/* paths still redirect here for existing bookmarks.
      path: "alert-destinations",
      name: "alertDestinations",
      component: AlertsDestinationList,
      meta: {
        titleKey: "alert_destinations.header",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      path: "alert-templates",
      name: "alertTemplates",
      component: TemplateList,
      meta: {
        titleKey: "alert_templates.header",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      // The curated alert catalog — a sibling of Alerts for the same reason
      // Destinations and Templates are: flat, so the rail lights exactly one
      // entry. The four pages present as peer tabs (AlertSectionTabs), which is
      // presentation only and does not imply nesting.
      path: "alert-library",
      name: "alertLibrary",
      component: AlertLibrary,
      meta: {
        titleKey: "alert_library.header",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      // Alert Sources feeds Incidents (correlation, resolve lifecycle) — same
      // Reliability workflow as Alerts/SLOs/Incidents/Destinations/Templates
      // above, so it's flat and top-level for the same reason those are.
      // Moved out of /settings/alert_sources, which redirects here.
      //
      // Enterprise/cloud-only (unlike destinations/templates): the route stays
      // registered so the redirect below has somewhere to land, but bounces to
      // Alerts on OSS builds — mirrors the anomaly-detection routes above.
      path: "alert-sources",
      name: "alertSources",
      component: () => import("@/components/alerts/ExternalAlertSourcesList.vue"),
      meta: {
        titleKey: "alert_sources.header",
      },
      beforeEnter(to: any, from: any, next: any) {
        const store = (window as any).store;
        const isOss = store?.state?.zoConfig?.build_type === "opensource";
        if (isOss || (config.isEnterprise !== "true" && config.isCloud !== "true")) {
          next({ name: "alertList", query: { org_identifier: to.query.org_identifier } });
          return;
        }
        routeGuard(to, from, next);
      },
    },
    {
      // Alert status page. Replaces the row-click side panel, and is where a
      // multi-alert's per-group state lives (alerts_2.md §5.4).
      path: "alerts/detail/:alert_id",
      name: "alertDetail",
      component: () => import("@/views/alerts/AlertDetail.vue"),
      meta: {
        titleKey: "routeTitles.alertDetail",
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
        titleKey: "alerts.addAlertMode",
      },
      beforeEnter(to: any, from: any, next: any) {
        routeGuard(to, from, next);
      },
    },
    {
      // Editing used to be a query on the LIST route (`?action=update`), which
      // meant mounting the whole list, fetching every alert, then fetching the
      // one being edited — the user watched the list render before the editor
      // replaced it. A route of its own goes straight to the form, mirroring
      // editAnomalyDetection below.
      path: "alerts/edit/:alert_id",
      name: "editAlert",
      component: () => import("@/views/AddAlertView.vue"),
      meta: {
        titleKey: "routeTitles.editAlert",
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
        titleKey: "alerts.addAnomalyMode",
      },
      beforeEnter(to: any, from: any, next: any) {
        const store = (window as any).store;
        const isOss = store?.state?.zoConfig?.build_type === "opensource";
        if (isOss || (config.isEnterprise !== "true" && config.isCloud !== "true")) {
          next({ name: "alertList", query: { org_identifier: to.query.org_identifier } });
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
        titleKey: "alerts.editAnomalyMode",
      },
      beforeEnter(to: any, from: any, next: any) {
        const store = (window as any).store;
        const isOss = store?.state?.zoConfig?.build_type === "opensource";
        if (isOss || (config.isEnterprise !== "true" && config.isCloud !== "true")) {
          next({ name: "alertList", query: { org_identifier: to.query.org_identifier } });
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
        titleKey: "alerts.history",
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
        titleKey: "alerts.insights.title",
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
        titleKey: "correlation.importSemanticGroups.title",
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
        titleKey: "rum.title",
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
          path: "source-maps",
          name: "SourceMaps",
          component: SourceMaps,
          meta: {
            keepAlive: true,
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
        titleKey: "routeTitles.notFound",
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
          titleKey: "menu.report",
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
          titleKey: "routeTitles.createReport",
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
