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

import { describe, it, expect, vi, beforeEach } from "vitest";
import useRoutes from "./router";
import config from "@/aws-exports";
import enLocale from "@/locales/languages/en-US.json";

// Routes store an i18n KEY in `meta.titleKey` (src/router/index.ts translates it
// per navigation), so assert the English copy the key still resolves to — a typo'd
// or removed key resolves to undefined and fails.
const enTitle = (titleKey: string) =>
  titleKey.split(".").reduce<any>((node, part) => node?.[part], enLocale);

// ---------------------------------------------------------------------------
// Config mock — mutable so individual tests can change isCloud / isEnterprise
// ---------------------------------------------------------------------------
vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false",
    isEnterprise: "false",
  },
}));

// ---------------------------------------------------------------------------
// Utility mocks
// ---------------------------------------------------------------------------
// `router.ts` imports the store singleton (the Database Monitoring gate reads
// `zoConfig` outside a component, where `useStore()` cannot reach), and
// `stores/index.ts` calls these at module scope to seed its initial state. A
// mock missing them throws on import and takes the whole suite down with it,
// so every export the store touches is stubbed here.
vi.mock("@/utils/zincutils", () => ({
  routeGuard: vi.fn((to: any, from: any, next: any) => next()),
  useLocalUserInfo: vi.fn(),
  useLocalCurrentUser: vi.fn(),
  // The three `stores/index.ts` calls at module scope to seed its state.
  useLocalOrganization: vi.fn(),
  useLocalTimezone: vi.fn(),
  invalidateLoginData: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Static view / component mocks
// ---------------------------------------------------------------------------
vi.mock("@/views/HomeView.vue", () => ({ default: { name: "HomeView" } }));
vi.mock("@/views/Login.vue", () => ({ default: { name: "Login" } }));
vi.mock("@/views/About.vue", () => ({ default: { name: "About" } }));
vi.mock("@/views/MemberSubscription.vue", () => ({ default: { name: "MemberSubscription" } }));
vi.mock("@/views/Error404.vue", () => ({ default: { name: "Error404" } }));
vi.mock("@/views/ShortUrl.vue", () => ({ default: { name: "ShortUrl" } }));
vi.mock("@/views/Dashboards/ImportDashboard.vue", () => ({ default: { name: "ImportDashboard" } }));
vi.mock("@/views/Functions.vue", () => ({ default: { name: "Functions" } }));
vi.mock("@/views/LogStream.vue", () => ({ default: { name: "LogStream" } }));
vi.mock("@/views/StreamExplorer.vue", () => ({ default: { name: "StreamExplorer" } }));

// ---------------------------------------------------------------------------
// Dynamic component mocks
// ---------------------------------------------------------------------------
vi.mock("@/plugins/logs/Index.vue", () => ({ default: { name: "Search" } }));
vi.mock("@/plugins/logs/SearchJobInspector.vue", () => ({
  default: { name: "SearchJobInspector" },
}));
vi.mock("@/plugins/metrics/Index.vue", () => ({ default: { name: "AppMetrics" } }));
vi.mock("@/plugins/traces/Index.vue", () => ({ default: { name: "AppTraces" } }));
vi.mock("@/plugins/traces/TraceDetails.vue", () => ({ default: { name: "TraceDetails" } }));
vi.mock("@/views/PromQL/QueryBuilder.vue", () => ({ default: { name: "PromQLQueryBuilder" } }));
vi.mock("@/views/Dashboards/ViewDashboard.vue", () => ({ default: { name: "ViewDashboard" } }));
vi.mock("@/views/Dashboards/addPanel/AddPanel.vue", () => ({ default: { name: "AddPanel" } }));
vi.mock("@/views/Dashboards/Dashboards.vue", () => ({ default: { name: "Dashboards" } }));
vi.mock("@/components/alerts/AlertList.vue", () => ({ default: { name: "AlertList" } }));
vi.mock("@/components/settings/index.vue", () => ({ default: { name: "Settings" } }));
vi.mock("@/components/functions/FunctionList.vue", () => ({ default: { name: "FunctionList" } }));
vi.mock("@/components/functions/AssociatedStreamFunction.vue", () => ({
  default: { name: "AssociatedStreamFunction" },
}));
vi.mock("@/components/functions/EnrichmentTableList.vue", () => ({
  default: { name: "EnrichmentTableList" },
}));
vi.mock("@/views/RUM/RealUserMonitoring.vue", () => ({ default: { name: "RealUserMonitoring" } }));
vi.mock("@/views/RUM/SessionViewer.vue", () => ({ default: { name: "SessionViewer" } }));
vi.mock("@/views/RUM/ErrorViewer.vue", () => ({ default: { name: "ErrorViewer" } }));
vi.mock("@/views/RUM/AppPerformance.vue", () => ({ default: { name: "AppPerformance" } }));
vi.mock("@/views/RUM/AppErrors.vue", () => ({ default: { name: "AppErrors" } }));
vi.mock("@/views/RUM/AppSessions.vue", () => ({ default: { name: "AppSessions" } }));
vi.mock("@/components/reports/ReportList.vue", () => ({ default: { name: "ReportList" } }));
vi.mock("@/components/reports/CreateReport.vue", () => ({ default: { name: "CreateReport" } }));
vi.mock("@/components/rum/performance/PerformanceSummary.vue", () => ({
  default: { name: "PerformanceSummary" },
}));
vi.mock("@/components/rum/performance/WebVitalsDashboard.vue", () => ({
  default: { name: "WebVitalsDashboard" },
}));
vi.mock("@/components/rum/performance/ErrorsDashboard.vue", () => ({
  default: { name: "ErrorsDashboard" },
}));
vi.mock("@/components/rum/performance/ApiDashboard.vue", () => ({
  default: { name: "ApiDashboard" },
}));
vi.mock("@/components/pipeline/PipelineEditor.vue", () => ({
  default: { name: "PipelineEditor" },
}));
vi.mock("@/components/pipeline/PipelinesList.vue", () => ({ default: { name: "PipelinesList" } }));
vi.mock("@/components/pipeline/ImportPipeline.vue", () => ({
  default: { name: "ImportPipeline" },
}));
vi.mock("@/views/AddAlertView.vue", () => ({ default: { name: "AddAlertView" } }));
vi.mock("@/components/alerts/AlertHistory.vue", () => ({ default: { name: "AlertHistory" } }));
vi.mock("@/components/alerts/AlertInsights.vue", () => ({ default: { name: "AlertInsights" } }));
vi.mock("@/components/alerts/ImportSemanticGroups.vue", () => ({
  default: { name: "ImportSemanticGroups" },
}));
vi.mock("@/components/pipelines/PipelineHistory.vue", () => ({
  default: { name: "PipelineHistory" },
}));
vi.mock("@/components/pipelines/BackfillJobsList.vue", () => ({
  default: { name: "BackfillJobsList" },
}));

// ---------------------------------------------------------------------------
// Sub-composable mocks — return empty arrays so counts are deterministic
// ---------------------------------------------------------------------------
vi.mock("./useIngestionRoutes", () => ({
  default: vi.fn(() => [{ path: "ingestion", name: "ingestion", component: {} }]),
}));

vi.mock("./useEnterpriseRoutes", () => ({
  default: vi.fn(() => [{ path: "iam", name: "iam", component: {}, children: [] }]),
}));

vi.mock("./useManagementRoutes", () => ({
  default: vi.fn(() => [{ path: "settings", name: "settings", component: {}, children: [] }]),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a route by name in a flat or nested list. */
function findRoute(routes: any[], name: string): any | undefined {
  for (const route of routes) {
    if (route.name === name) return route;
    if (route.children) {
      const found = findRoute(route.children, name);
      if (found) return found;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRoutes (router.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.isCloud = "false";
    config.isEnterprise = "false";
  });

  // =========================================================================
  // 1. Basic Functionality
  // =========================================================================
  describe("Basic Functionality", () => {
    it("should be a function", () => {
      expect(typeof useRoutes).toBe("function");
    });

    it("should not require parameters", () => {
      expect(useRoutes.length).toBe(0);
    });

    it("should return an object", () => {
      const result = useRoutes();
      expect(typeof result).toBe("object");
      expect(result).not.toBeNull();
    });

    it("should return parentRoutes as an array", () => {
      const { parentRoutes } = useRoutes();
      expect(Array.isArray(parentRoutes)).toBe(true);
    });

    it("should return homeChildRoutes as an array", () => {
      const { homeChildRoutes } = useRoutes();
      expect(Array.isArray(homeChildRoutes)).toBe(true);
    });

    it("should return non-empty parentRoutes", () => {
      const { parentRoutes } = useRoutes();
      expect(parentRoutes.length).toBeGreaterThan(0);
    });

    it("should return non-empty homeChildRoutes", () => {
      const { homeChildRoutes } = useRoutes();
      expect(homeChildRoutes.length).toBeGreaterThan(0);
    });

    it("should return consistent structure on multiple calls", () => {
      const result1 = useRoutes();
      const result2 = useRoutes();
      expect(result1.parentRoutes.length).toBe(result2.parentRoutes.length);
      expect(result1.homeChildRoutes.map((r: any) => r.name || r.path)).toEqual(
        result2.homeChildRoutes.map((r: any) => r.name || r.path),
      );
    });
  });

  // =========================================================================
  // 2. parentRoutes — /login
  // =========================================================================
  describe("parentRoutes — /login", () => {
    it("should include /login route", () => {
      const { parentRoutes } = useRoutes();
      const loginRoute = parentRoutes.find((r: any) => r.path === "/login");
      expect(loginRoute).toBeDefined();
    });

    it("should have Login component for /login", () => {
      const { parentRoutes } = useRoutes();
      const loginRoute = parentRoutes.find((r: any) => r.path === "/login");
      expect(loginRoute.component).toBeDefined();
    });

    it("should have correct meta title for /login", () => {
      const { parentRoutes } = useRoutes();
      const loginRoute = parentRoutes.find((r: any) => r.path === "/login");
      expect(enTitle(loginRoute.meta.titleKey)).toBe("Login");
    });
  });

  // =========================================================================
  // 3. parentRoutes — /logout
  // =========================================================================
  describe("parentRoutes — /logout", () => {
    it("should include /logout route", () => {
      const { parentRoutes } = useRoutes();
      const logoutRoute = parentRoutes.find((r: any) => r.path === "/logout");
      expect(logoutRoute).toBeDefined();
    });

    it("should have beforeEnter guard for /logout", () => {
      const { parentRoutes } = useRoutes();
      const logoutRoute = parentRoutes.find((r: any) => r.path === "/logout");
      expect(typeof logoutRoute.beforeEnter).toBe("function");
    });

    it("should call invalidateLoginData in /logout beforeEnter", async () => {
      const { invalidateLoginData } = await import("@/utils/zincutils");
      const { parentRoutes } = useRoutes();
      const logoutRoute = parentRoutes.find((r: any) => r.path === "/logout");

      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: { href: "" },
      });

      logoutRoute.beforeEnter({}, {}, vi.fn());
      expect(invalidateLoginData).toHaveBeenCalledTimes(1);

      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    });

    it("should call useLocalCurrentUser in /logout beforeEnter", async () => {
      const { useLocalCurrentUser } = await import("@/utils/zincutils");
      const { parentRoutes } = useRoutes();
      const logoutRoute = parentRoutes.find((r: any) => r.path === "/logout");

      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: { href: "" },
      });

      logoutRoute.beforeEnter({}, {}, vi.fn());
      expect(useLocalCurrentUser).toHaveBeenCalledWith("", true);

      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    });

    it("should call useLocalUserInfo in /logout beforeEnter", async () => {
      const { useLocalUserInfo } = await import("@/utils/zincutils");
      const { parentRoutes } = useRoutes();
      const logoutRoute = parentRoutes.find((r: any) => r.path === "/logout");

      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: { href: "" },
      });

      logoutRoute.beforeEnter({}, {}, vi.fn());
      expect(useLocalUserInfo).toHaveBeenCalledWith("", true);

      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    });

    it("should redirect window.location.href to /login in /logout beforeEnter", () => {
      const { parentRoutes } = useRoutes();
      const logoutRoute = parentRoutes.find((r: any) => r.path === "/logout");

      const mockLocation = { href: "" };
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: mockLocation,
      });

      logoutRoute.beforeEnter({}, {}, vi.fn());
      expect(mockLocation.href).toBe("/login");
    });
  });

  // =========================================================================
  // 4. parentRoutes — /cb callback
  // =========================================================================
  describe("parentRoutes — /cb callback", () => {
    it("should include /cb route", () => {
      const { parentRoutes } = useRoutes();
      const cbRoute = parentRoutes.find((r: any) => r.path === "/cb");
      expect(cbRoute).toBeDefined();
    });

    it("should have name 'callback' for /cb route", () => {
      const { parentRoutes } = useRoutes();
      const cbRoute = parentRoutes.find((r: any) => r.path === "/cb");
      expect(cbRoute.name).toBe("callback");
    });

    it("should have Login component for /cb route", () => {
      const { parentRoutes } = useRoutes();
      const cbRoute = parentRoutes.find((r: any) => r.path === "/cb");
      expect(cbRoute.component).toBeDefined();
    });

    it("should have meta title 'Login Callback' for /cb route", () => {
      const { parentRoutes } = useRoutes();
      const cbRoute = parentRoutes.find((r: any) => r.path === "/cb");
      expect(enTitle(cbRoute.meta.titleKey)).toBe("Login Callback");
    });
  });

  // =========================================================================
  // 5. homeChildRoutes — home route
  // =========================================================================
  describe("homeChildRoutes — home route", () => {
    it("should include home route", () => {
      const { homeChildRoutes } = useRoutes();
      const homeRoute = findRoute(homeChildRoutes, "home");
      expect(homeRoute).toBeDefined();
    });

    it("should have empty string path for home route", () => {
      const { homeChildRoutes } = useRoutes();
      const homeRoute = findRoute(homeChildRoutes, "home");
      expect(homeRoute.path).toBe("");
    });

    it("should have keepAlive true for home route", () => {
      const { homeChildRoutes } = useRoutes();
      const homeRoute = findRoute(homeChildRoutes, "home");
      expect(homeRoute.meta.keepAlive).toBe(true);
    });

    it("should have meta title 'Home' for home route", () => {
      const { homeChildRoutes } = useRoutes();
      const homeRoute = findRoute(homeChildRoutes, "home");
      expect(enTitle(homeRoute.meta.titleKey)).toBe("Home");
    });

    it("should have component defined for home route", () => {
      const { homeChildRoutes } = useRoutes();
      const homeRoute = findRoute(homeChildRoutes, "home");
      expect(homeRoute.component).toBeDefined();
    });
  });

  // =========================================================================
  // 6. homeChildRoutes — logs route
  // =========================================================================
  describe("homeChildRoutes — logs route", () => {
    it("should include logs route", () => {
      const { homeChildRoutes } = useRoutes();
      const logsRoute = findRoute(homeChildRoutes, "logs");
      expect(logsRoute).toBeDefined();
    });

    it("should have path 'logs' for logs route", () => {
      const { homeChildRoutes } = useRoutes();
      const logsRoute = findRoute(homeChildRoutes, "logs");
      expect(logsRoute.path).toBe("logs");
    });

    it("should have meta title 'Logs' for logs route", () => {
      const { homeChildRoutes } = useRoutes();
      const logsRoute = findRoute(homeChildRoutes, "logs");
      expect(enTitle(logsRoute.meta.titleKey)).toBe("Logs");
    });

    it("should have keepAlive true for logs route", () => {
      const { homeChildRoutes } = useRoutes();
      const logsRoute = findRoute(homeChildRoutes, "logs");
      expect(logsRoute.meta.keepAlive).toBe(true);
    });

    it("should have beforeEnter guard for logs route", () => {
      const { homeChildRoutes } = useRoutes();
      const logsRoute = findRoute(homeChildRoutes, "logs");
      expect(typeof logsRoute.beforeEnter).toBe("function");
    });

    it("should call routeGuard in logs route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const logsRoute = findRoute(homeChildRoutes, "logs");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();

      logsRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should include searchJobInspector route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "searchJobInspector");
      expect(route).toBeDefined();
    });

    it("should have correct path for searchJobInspector route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "searchJobInspector");
      expect(route.path).toBe("logs/inspector");
    });
  });

  // =========================================================================
  // 7. homeChildRoutes — metrics route
  // =========================================================================
  describe("homeChildRoutes — metrics route", () => {
    it("should include metrics route", () => {
      const { homeChildRoutes } = useRoutes();
      const metricsRoute = findRoute(homeChildRoutes, "metrics");
      expect(metricsRoute).toBeDefined();
    });

    it("should have path 'metrics' for metrics route", () => {
      const { homeChildRoutes } = useRoutes();
      const metricsRoute = findRoute(homeChildRoutes, "metrics");
      expect(metricsRoute.path).toBe("metrics");
    });

    it("should have meta title 'Metrics' for metrics route", () => {
      const { homeChildRoutes } = useRoutes();
      const metricsRoute = findRoute(homeChildRoutes, "metrics");
      expect(enTitle(metricsRoute.meta.titleKey)).toBe("Metrics");
    });

    it("should have beforeEnter guard that calls routeGuard for metrics route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const metricsRoute = findRoute(homeChildRoutes, "metrics");

      const mockNext = vi.fn();
      metricsRoute.beforeEnter({}, {}, mockNext);
      expect(routeGuard).toHaveBeenCalledTimes(1);
    });

    // The back-compat redirect and its Visualize exception. routeGuard is mocked
    // to pass its next() straight through, so a redirect surfaces as next() being
    // called with a `{ name: "metricsEditor" }` target, and a plain admit as
    // next() with no args.
    it("redirects a legacy metrics_data deep link (no mode) to the editor route", () => {
      const { homeChildRoutes } = useRoutes();
      const metricsRoute = findRoute(homeChildRoutes, "metrics");

      const next = vi.fn();
      metricsRoute.beforeEnter({ query: { metrics_data: "abc" }, hash: "" }, {}, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "metricsEditor",
          query: { metrics_data: "abc" },
          replace: true,
        }),
      );
    });

    it("redirects other editor params (e.g. stream_name) to the editor route", () => {
      const { homeChildRoutes } = useRoutes();
      const metricsRoute = findRoute(homeChildRoutes, "metrics");

      const next = vi.fn();
      metricsRoute.beforeEnter({ query: { stream_name: "cpu" }, hash: "" }, {}, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: "metricsEditor" }));
    });

    it("keeps a mode=visualize link in the explorer — no editor redirect", () => {
      // The explorer's in-page Visualize owns metrics_data and rehydrates it
      // itself; redirecting would kick the user out on every refresh.
      const { homeChildRoutes } = useRoutes();
      const metricsRoute = findRoute(homeChildRoutes, "metrics");

      const next = vi.fn();
      metricsRoute.beforeEnter(
        { query: { metrics_data: "abc", mode: "visualize" }, hash: "" },
        {},
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(); // admitted, not redirected
    });

    it("does not redirect a plain /metrics visit", () => {
      const { homeChildRoutes } = useRoutes();
      const metricsRoute = findRoute(homeChildRoutes, "metrics");

      const next = vi.fn();
      metricsRoute.beforeEnter({ query: {}, hash: "" }, {}, next);

      expect(next).toHaveBeenCalledWith();
    });

    it("does not redirect an explore/workspace link (no editor params)", () => {
      const { homeChildRoutes } = useRoutes();
      const metricsRoute = findRoute(homeChildRoutes, "metrics");

      const next = vi.fn();
      metricsRoute.beforeEnter(
        { query: { mode: "workspace", sort_by: "z-a" }, hash: "" },
        {},
        next,
      );

      expect(next).toHaveBeenCalledWith();
    });

    it("should include promqlBuilder route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "promqlBuilder");
      expect(route).toBeDefined();
    });

    it("should have correct path for promqlBuilder route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "promqlBuilder");
      expect(route.path).toBe("promql-builder");
    });
  });

  // =========================================================================
  // 8. homeChildRoutes — traces route
  // =========================================================================
  describe("homeChildRoutes — traces route", () => {
    it("should include traces route", () => {
      const { homeChildRoutes } = useRoutes();
      const tracesRoute = findRoute(homeChildRoutes, "traces");
      expect(tracesRoute).toBeDefined();
    });

    it("should have path 'traces' for traces route", () => {
      const { homeChildRoutes } = useRoutes();
      const tracesRoute = findRoute(homeChildRoutes, "traces");
      expect(tracesRoute.path).toBe("traces");
    });

    it("should have meta title 'Traces' for traces route", () => {
      const { homeChildRoutes } = useRoutes();
      const tracesRoute = findRoute(homeChildRoutes, "traces");
      expect(enTitle(tracesRoute.meta.titleKey)).toBe("Traces");
    });

    it("should have beforeEnter guard for traces route", () => {
      const { homeChildRoutes } = useRoutes();
      const tracesRoute = findRoute(homeChildRoutes, "traces");
      expect(typeof tracesRoute.beforeEnter).toBe("function");
    });

    it("should include traceDetails route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "traceDetails");
      expect(route).toBeDefined();
    });

    it("should have correct path for traceDetails route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "traceDetails");
      expect(route.path).toBe("traces/trace-details");
    });

    it("redirects the standalone Service Graph path to the canonical query tab", () => {
      config.isEnterprise = "true";
      const { homeChildRoutes } = useRoutes();
      const route = homeChildRoutes.find((candidate) => candidate.path === "traces/service-graph");
      if (!route || typeof route.redirect !== "function") {
        throw new Error("Missing Service Graph legacy redirect");
      }

      expect(
        route.redirect({
          query: { org_identifier: "default", period: "7d", search_mode: "spans" },
        }),
      ).toEqual({
        name: "traces",
        query: { org_identifier: "default", period: "7d", tab: "service-graph" },
      });
    });

    it("redirects the standalone Service Graph path to Traces in OSS", () => {
      const { homeChildRoutes } = useRoutes();
      const route = homeChildRoutes.find((candidate) => candidate.path === "traces/service-graph");
      if (!route || typeof route.redirect !== "function") {
        throw new Error("Missing Service Graph legacy redirect");
      }

      expect(route.redirect({ query: { org_identifier: "default", stream: "traces" } })).toEqual({
        name: "traces",
        query: { org_identifier: "default", stream: "traces", tab: "spans" },
      });
    });

    it("redirects the standalone Service Catalog path to the canonical query tab", () => {
      const { homeChildRoutes } = useRoutes();
      const route = homeChildRoutes.find((candidate) => candidate.path === "traces/services");
      if (!route || typeof route.redirect !== "function") {
        throw new Error("Missing Service Catalog legacy redirect");
      }

      expect(route.redirect({ query: { org_identifier: "default", from: "1", to: "2" } })).toEqual({
        name: "traces",
        query: {
          org_identifier: "default",
          from: "1",
          to: "2",
          tab: "services-catalog",
        },
      });
    });

    it("keeps the oldest Service Graph path as a query-preserving redirect", () => {
      config.isEnterprise = "true";
      const { homeChildRoutes } = useRoutes();
      const route = homeChildRoutes.find((candidate) => candidate.path === "service-graph");
      if (!route || typeof route.redirect !== "function") {
        throw new Error("Missing oldest Service Graph redirect");
      }

      expect(route.redirect({ query: { org_identifier: "default" } })).toEqual({
        name: "traces",
        query: { org_identifier: "default", tab: "service-graph" },
      });
    });

    it("normalizes an unsupported Service Graph tab before entering Traces in OSS", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "traces");
      const next = vi.fn();

      route.beforeEnter(
        {
          query: { org_identifier: "default", stream: "traces", tab: "service-graph" },
          hash: "",
        },
        {},
        next,
      );

      expect(next).toHaveBeenCalledWith({
        name: "traces",
        query: { org_identifier: "default", stream: "traces", tab: "spans" },
        hash: "",
        replace: true,
      });
      expect(routeGuard).not.toHaveBeenCalled();
    });

    it("removes legacy search_mode from an otherwise valid Traces URL", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "traces");
      const next = vi.fn();

      route.beforeEnter(
        {
          query: {
            org_identifier: "default",
            stream: "traces",
            tab: "spans",
            search_mode: "traces",
          },
          hash: "#results",
        },
        {},
        next,
      );

      expect(next).toHaveBeenCalledWith({
        name: "traces",
        query: { org_identifier: "default", stream: "traces", tab: "spans" },
        hash: "#results",
        replace: true,
      });
      expect(routeGuard).not.toHaveBeenCalled();
    });

    it("does not expose standalone Service Graph or Service Catalog route names", () => {
      const { homeChildRoutes } = useRoutes();
      expect(findRoute(homeChildRoutes, "serviceGraph")).toBeUndefined();
      expect(findRoute(homeChildRoutes, "servicesCatalog")).toBeUndefined();
    });
  });

  // =========================================================================
  // 8b. Database Monitoring — the enterprise-only tabs
  // =========================================================================
  /**
   * Deadlocks, Blocked queries and Table health read endpoints the OSS backend
   * answers 403 on. Disabling the tabs cannot stop a PASTED URL, so each of the
   * three routes carries its own guard. It lands on the DBM overview — the
   * section the reader is already inside — rather than a page that renders
   * empty because every fetch was refused.
   */
  describe("homeChildRoutes — Database Monitoring enterprise gate", () => {
    const GATED = ["dbmDeadlocks", "dbmBlocking", "dbmTableHealth"] as const;
    const OPEN = ["dbmDatabases", "dbmQueries", "dbmSamples", "dbmActivity"] as const;

    it.each(GATED)("redirects %s to the DBM overview on an OSS build", (name) => {
      config.isEnterprise = "false";
      const { homeChildRoutes } = useRoutes();
      const next = vi.fn();
      findRoute(homeChildRoutes, name).beforeEnter({ query: { range: "360" } }, {}, next);
      expect(next).toHaveBeenCalledWith({ name: "dbmDatabases", query: { range: "360" } });
    });

    it.each(GATED)("lets %s through on an enterprise build", async (name) => {
      config.isEnterprise = "true";
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const to = { query: {} };
      const next = vi.fn();
      findRoute(homeChildRoutes, name).beforeEnter(to, {}, next);
      expect(routeGuard).toHaveBeenCalledWith(to, {}, next);
    });

    /** Only the literal string unlocks — a truthy-string check would fail open. */
    it.each(["", "TRUE", "1", "yes"])("treats isEnterprise=%p as OSS", (value) => {
      config.isEnterprise = value;
      const { homeChildRoutes } = useRoutes();
      const next = vi.fn();
      findRoute(homeChildRoutes, "dbmDeadlocks").beforeEnter({ query: {} }, {}, next);
      expect(next).toHaveBeenCalledWith({ name: "dbmDatabases", query: {} });
    });

    /** The four OSS tabs must stay reachable — the gate is three routes, not the section. */
    it.each(OPEN)("leaves %s reachable on an OSS build", (name) => {
      config.isEnterprise = "false";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, name);
      // No child guard of its own: the parent's Database Monitoring guard is
      // the only thing standing between an OSS reader and these four pages.
      expect(route.beforeEnter).toBeUndefined();
    });

    /** Routes stay REGISTERED on OSS — an unregistered route is a 404, not a redirect. */
    it.each(GATED)("keeps %s registered on an OSS build", (name) => {
      config.isEnterprise = "false";
      const { homeChildRoutes } = useRoutes();
      expect(findRoute(homeChildRoutes, name)).toBeDefined();
    });
  });

  // =========================================================================
  // 9. homeChildRoutes — dashboards routes
  // =========================================================================
  describe("homeChildRoutes — dashboards routes", () => {
    it("should include dashboards route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "dashboards");
      expect(route).toBeDefined();
    });

    it("should have path 'dashboards' for dashboards route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "dashboards");
      expect(route.path).toBe("dashboards");
    });

    it("should have meta title 'Dashboards' for dashboards route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "dashboards");
      expect(enTitle(route.meta.titleKey)).toBe("Dashboards");
    });

    it("should include viewDashboard route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "viewDashboard");
      expect(route).toBeDefined();
    });

    it("should have correct path for viewDashboard route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "viewDashboard");
      expect(route.path).toBe("/dashboards/view");
    });

    it("should have props true for viewDashboard route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "viewDashboard");
      expect(route.props).toBe(true);
    });

    it("should include importDashboard route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "importDashboard");
      expect(route).toBeDefined();
    });

    it("should have correct path for importDashboard route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "importDashboard");
      expect(route.path).toBe("/dashboards/import");
    });

    it("should include addPanel route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "addPanel");
      expect(route).toBeDefined();
    });

    it("should have correct path for addPanel route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "addPanel");
      expect(route.path).toBe("/dashboards/add_panel");
    });
  });

  // =========================================================================
  // 10. homeChildRoutes — streams routes
  // =========================================================================
  describe("homeChildRoutes — streams routes", () => {
    it("should include logstreams route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "logstreams");
      expect(route).toBeDefined();
    });

    it("should have path 'streams' for logstreams route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "logstreams");
      expect(route.path).toBe("streams");
    });

    it("should have meta title 'Streams' for logstreams route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "logstreams");
      expect(enTitle(route.meta.titleKey)).toBe("Streams");
    });

    it("should include streamExplorer route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "streamExplorer");
      expect(route).toBeDefined();
    });

    it("should have correct path for streamExplorer route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "streamExplorer");
      expect(route.path).toBe("streams/stream-explore");
    });

    it("should have props true for streamExplorer route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "streamExplorer");
      expect(route.props).toBe(true);
    });
  });

  // =========================================================================
  // 11. homeChildRoutes — about route
  // =========================================================================
  describe("homeChildRoutes — about route", () => {
    it("should include about route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "about");
      expect(route).toBeDefined();
    });

    it("should have path 'about' for about route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "about");
      expect(route.path).toBe("about");
    });

    it("should have meta title 'About' for about route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "about");
      expect(enTitle(route.meta.titleKey)).toBe("About");
    });

    it("should have keepAlive true for about route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "about");
      expect(route.meta.keepAlive).toBe(true);
    });
  });

  // =========================================================================
  // 12. homeChildRoutes — pipeline route and children
  // =========================================================================
  describe("homeChildRoutes — pipeline route and children", () => {
    it("should include pipeline route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipeline");
      expect(route).toBeDefined();
    });

    it("should have path 'pipeline' for pipeline route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipeline");
      expect(route.path).toBe("pipeline");
    });

    it("should have meta title 'Pipeline' for pipeline route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipeline");
      expect(enTitle(route.meta.titleKey)).toBe("Pipeline");
    });

    it("should have beforeEnter guard for pipeline route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipeline");
      expect(typeof route.beforeEnter).toBe("function");
    });

    it("should have children array for pipeline route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipeline");
      expect(Array.isArray(route.children)).toBe(true);
    });

    it("should include functionList child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "functionList");
      expect(route).toBeDefined();
    });

    it("should have path 'functions' for functionList child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "functionList");
      expect(route.path).toBe("functions");
    });

    it("should include enrichmentTables child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "enrichmentTables");
      expect(route).toBeDefined();
    });

    it("should have path 'enrichment-tables' for enrichmentTables child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "enrichmentTables");
      expect(route.path).toBe("enrichment-tables");
    });

    it("should include pipelines child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelines");
      expect(route).toBeDefined();
    });

    it("should have path 'pipelines' for pipelines child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelines");
      expect(route.path).toBe("pipelines");
    });

    it("should have children for pipelines child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelines");
      expect(Array.isArray(route.children)).toBe(true);
    });

    it("should include pipelineEditor route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelineEditor");
      expect(route).toBeDefined();
    });

    it("should have path 'edit' for pipelineEditor route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelineEditor");
      expect(route.path).toBe("edit");
    });

    it("should include createPipeline route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "createPipeline");
      expect(route).toBeDefined();
    });

    it("should have path 'add' for createPipeline route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "createPipeline");
      expect(route.path).toBe("add");
    });

    it("should include importPipeline route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "importPipeline");
      expect(route).toBeDefined();
    });

    it("should have path 'import' for importPipeline route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "importPipeline");
      expect(route.path).toBe("import");
    });

    it("should include pipelineHistory route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelineHistory");
      expect(route).toBeDefined();
    });

    it("should have path 'history' for pipelineHistory route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelineHistory");
      expect(route.path).toBe("history");
    });

    it("should have meta title 'Pipeline History' for pipelineHistory route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelineHistory");
      expect(enTitle(route.meta.titleKey)).toBe("Pipeline History");
    });

    it("should include pipelineBackfill route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelineBackfill");
      expect(route).toBeDefined();
    });

    it("should have path 'backfill' for pipelineBackfill route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelineBackfill");
      expect(route.path).toBe("backfill");
    });

    it("should have meta title 'Pipeline Backfill Jobs' for pipelineBackfill route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelineBackfill");
      expect(enTitle(route.meta.titleKey)).toBe("Pipeline Backfill Jobs");
    });

    it("should call routeGuard in pipeline route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipeline");

      const mockNext = vi.fn();
      route.beforeEnter({}, {}, mockNext);
      expect(routeGuard).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 13. homeChildRoutes — alerts routes
  // =========================================================================
  describe("homeChildRoutes — alerts routes", () => {
    it("should include alertList route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "alertList");
      expect(route).toBeDefined();
    });

    it("should have path 'alerts' for alertList route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "alertList");
      expect(route.path).toBe("alerts");
    });

    it("should have meta title 'Alerts' for alertList route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "alertList");
      expect(enTitle(route.meta.titleKey)).toBe("Alerts");
    });

    it("should include addAlert route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "addAlert");
      expect(route).toBeDefined();
    });

    it("should have path 'alerts/add' for addAlert route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "addAlert");
      expect(route.path).toBe("alerts/add");
    });

    it("should include alertHistory route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "alertHistory");
      expect(route).toBeDefined();
    });

    it("should have path 'alerts/history' for alertHistory route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "alertHistory");
      expect(route.path).toBe("alerts/history");
    });

    it("should include alertInsights route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "alertInsights");
      expect(route).toBeDefined();
    });

    it("should have path 'alerts/insights' for alertInsights route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "alertInsights");
      expect(route.path).toBe("alerts/insights");
    });

    it("should include importSemanticGroups route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "importSemanticGroups");
      expect(route).toBeDefined();
    });

    it("should call routeGuard in alertList route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "alertList");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });
  });

  // =========================================================================
  // 14. homeChildRoutes — anomaly detection guard logic
  // =========================================================================
  describe("homeChildRoutes — anomaly detection guard", () => {
    it("should include addAnomalyDetection route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "addAnomalyDetection");
      expect(route).toBeDefined();
    });

    it("should have path 'alerts/anomaly/add' for addAnomalyDetection route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "addAnomalyDetection");
      expect(route.path).toBe("alerts/anomaly/add");
    });

    it("should include editAnomalyDetection route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "editAnomalyDetection");
      expect(route).toBeDefined();
    });

    it("should have path 'alerts/anomaly/edit/:anomaly_id' for editAnomalyDetection route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "editAnomalyDetection");
      expect(route.path).toBe("alerts/anomaly/edit/:anomaly_id");
    });

    it("should redirect addAnomalyDetection to alertList when build_type is opensource", () => {
      (window as any).store = {
        state: { zoConfig: { build_type: "opensource" } },
      };

      config.isCloud = "true";
      config.isEnterprise = "true";

      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "addAnomalyDetection");

      const mockNext = vi.fn();
      const mockTo = { query: { org_identifier: "test_org" } };
      route.beforeEnter(mockTo, {}, mockNext);

      expect(mockNext).toHaveBeenCalledWith({
        name: "alertList",
        query: { org_identifier: "test_org" },
      });

      delete (window as any).store;
    });

    it("should redirect addAnomalyDetection to alertList when not enterprise and not cloud", () => {
      (window as any).store = {
        state: { zoConfig: { build_type: "enterprise" } },
      };

      config.isCloud = "false";
      config.isEnterprise = "false";

      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "addAnomalyDetection");

      const mockNext = vi.fn();
      const mockTo = { query: { org_identifier: "test_org" } };
      route.beforeEnter(mockTo, {}, mockNext);

      expect(mockNext).toHaveBeenCalledWith({
        name: "alertList",
        query: { org_identifier: "test_org" },
      });

      delete (window as any).store;
    });

    it("should call routeGuard for addAnomalyDetection when enterprise and not OSS", async () => {
      const { routeGuard } = await import("@/utils/zincutils");

      (window as any).store = {
        state: { zoConfig: { build_type: "enterprise" } },
      };

      config.isCloud = "false";
      config.isEnterprise = "true";

      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "addAnomalyDetection");

      const mockNext = vi.fn();
      const mockTo = { query: { org_identifier: "test_org" } };
      route.beforeEnter(mockTo, {}, mockNext);

      expect(routeGuard).toHaveBeenCalled();

      delete (window as any).store;
    });

    it("should call routeGuard for addAnomalyDetection when cloud and not OSS", async () => {
      const { routeGuard } = await import("@/utils/zincutils");

      (window as any).store = {
        state: { zoConfig: { build_type: "cloud" } },
      };

      config.isCloud = "true";
      config.isEnterprise = "false";

      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "addAnomalyDetection");

      const mockNext = vi.fn();
      const mockTo = { query: { org_identifier: "test_org" } };
      route.beforeEnter(mockTo, {}, mockNext);

      expect(routeGuard).toHaveBeenCalled();

      delete (window as any).store;
    });

    it("should redirect editAnomalyDetection to alertList when build_type is opensource", () => {
      (window as any).store = {
        state: { zoConfig: { build_type: "opensource" } },
      };

      config.isCloud = "true";
      config.isEnterprise = "true";

      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "editAnomalyDetection");

      const mockNext = vi.fn();
      const mockTo = { query: { org_identifier: "my_org" } };
      route.beforeEnter(mockTo, {}, mockNext);

      expect(mockNext).toHaveBeenCalledWith({
        name: "alertList",
        query: { org_identifier: "my_org" },
      });

      delete (window as any).store;
    });

    it("should redirect editAnomalyDetection to alertList when not enterprise and not cloud", () => {
      (window as any).store = {
        state: { zoConfig: { build_type: "enterprise" } },
      };

      config.isCloud = "false";
      config.isEnterprise = "false";

      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "editAnomalyDetection");

      const mockNext = vi.fn();
      const mockTo = { query: { org_identifier: "my_org" } };
      route.beforeEnter(mockTo, {}, mockNext);

      expect(mockNext).toHaveBeenCalledWith({
        name: "alertList",
        query: { org_identifier: "my_org" },
      });

      delete (window as any).store;
    });
  });

  // =========================================================================
  // 15. homeChildRoutes — RUM route and children
  // =========================================================================
  describe("homeChildRoutes — RUM route and children", () => {
    it("should include RUM route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "RUM");
      expect(route).toBeDefined();
    });

    it("should have path 'rum' for RUM route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "RUM");
      expect(route.path).toBe("rum");
    });

    it("should have meta title 'Real User Monitoring' for RUM route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "RUM");
      expect(enTitle(route.meta.titleKey)).toBe("Real User Monitoring");
    });

    it("should have beforeEnter guard for RUM route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "RUM");
      expect(typeof route.beforeEnter).toBe("function");
    });

    it("should have children array for RUM route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "RUM");
      expect(Array.isArray(route.children)).toBe(true);
    });

    it("should include Sessions child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "Sessions");
      expect(route).toBeDefined();
    });

    it("should have path 'sessions' for Sessions child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "Sessions");
      expect(route.path).toBe("sessions");
    });

    it("should include SessionViewer child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "SessionViewer");
      expect(route).toBeDefined();
    });

    it("should have path 'sessions/view/:id' for SessionViewer route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "SessionViewer");
      expect(route.path).toBe("sessions/view/:id");
    });

    it("should include ErrorTracking child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "ErrorTracking");
      expect(route).toBeDefined();
    });

    it("should have path 'errors' for ErrorTracking route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "ErrorTracking");
      expect(route.path).toBe("errors");
    });

    it("should include ErrorViewer child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "ErrorViewer");
      expect(route).toBeDefined();
    });

    it("should have path 'errors/view/:id' for ErrorViewer route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "ErrorViewer");
      expect(route.path).toBe("errors/view/:id");
    });

    it("should include RumPerformance child route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "RumPerformance");
      expect(route).toBeDefined();
    });

    it("should have path 'performance' for RumPerformance route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "RumPerformance");
      expect(route.path).toBe("performance");
    });

    it("should have children for RumPerformance route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "RumPerformance");
      expect(Array.isArray(route.children)).toBe(true);
    });

    it("should include rumPerformanceSummary route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "rumPerformanceSummary");
      expect(route).toBeDefined();
    });

    it("should have path 'overview' for rumPerformanceSummary route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "rumPerformanceSummary");
      expect(route.path).toBe("overview");
    });

    it("should include rumPerformanceWebVitals route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "rumPerformanceWebVitals");
      expect(route).toBeDefined();
    });

    it("should have path 'web-vitals' for rumPerformanceWebVitals route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "rumPerformanceWebVitals");
      expect(route.path).toBe("web-vitals");
    });

    it("should include rumPerformanceErrors route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "rumPerformanceErrors");
      expect(route).toBeDefined();
    });

    it("should have path 'errors' for rumPerformanceErrors route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "rumPerformanceErrors");
      expect(route.path).toBe("errors");
    });

    it("should include rumPerformanceApis route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "rumPerformanceApis");
      expect(route).toBeDefined();
    });

    it("should have path 'apis' for rumPerformanceApis route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "rumPerformanceApis");
      expect(route.path).toBe("apis");
    });

    it("should call routeGuard in RUM route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "RUM");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });
  });

  // =========================================================================
  // 16. homeChildRoutes — shortUrl route
  // =========================================================================
  describe("homeChildRoutes — shortUrl route", () => {
    it("should include shortUrl route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "shortUrl");
      expect(route).toBeDefined();
    });

    it("should have path 'short/:id' for shortUrl route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "shortUrl");
      expect(route.path).toBe("short/:id");
    });

    it("should have props true for shortUrl route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "shortUrl");
      expect(route.props).toBe(true);
    });

    it("should have beforeEnter guard for shortUrl route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "shortUrl");
      expect(typeof route.beforeEnter).toBe("function");
    });
  });

  // =========================================================================
  // 17. homeChildRoutes — member_subscription route
  // =========================================================================
  describe("homeChildRoutes — member_subscription route", () => {
    it("should include member_subscription route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "member_subscription");
      expect(route).toBeDefined();
    });

    it("should have path 'member_subscription' for member_subscription route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "member_subscription");
      expect(route.path).toBe("member_subscription");
    });

    it("should have meta title 'Member Subscription' for member_subscription route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "member_subscription");
      expect(enTitle(route.meta.titleKey)).toBe("Member Subscription");
    });
  });

  // =========================================================================
  // 18. homeChildRoutes — reports routes (non-cloud)
  // =========================================================================
  describe("homeChildRoutes — reports routes (non-cloud)", () => {
    it("should include reports route when isCloud is 'false'", () => {
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "reports");
      expect(route).toBeDefined();
    });

    it("should have path '/reports' for reports route when isCloud is 'false'", () => {
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "reports");
      expect(route.path).toBe("/reports");
    });

    it("should have meta title 'Reports' for reports route", () => {
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "reports");
      expect(enTitle(route.meta.titleKey)).toBe("Reports");
    });

    it("should have props true for reports route", () => {
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "reports");
      expect(route.props).toBe(true);
    });

    it("should include createReport route when isCloud is 'false'", () => {
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "createReport");
      expect(route).toBeDefined();
    });

    it("should have path '/reports/create' for createReport route", () => {
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "createReport");
      expect(route.path).toBe("/reports/create");
    });

    it("should have meta title 'Create Report' for createReport route", () => {
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "createReport");
      expect(enTitle(route.meta.titleKey)).toBe("Create Report");
    });

    it("should splice reports routes at index 13", () => {
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const reportsRoute = homeChildRoutes[13];
      expect(reportsRoute.name).toBe("reports");
    });

    it("should splice createReport route at index 14", () => {
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const createReportRoute = homeChildRoutes[14];
      expect(createReportRoute.name).toBe("createReport");
    });

    it("should have beforeEnter guard for reports route", () => {
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "reports");
      expect(typeof route.beforeEnter).toBe("function");
    });

    it("should have beforeEnter guard for createReport route", () => {
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "createReport");
      expect(typeof route.beforeEnter).toBe("function");
    });

    it("should call routeGuard in reports route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      config.isCloud = "false";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "reports");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });
  });

  // =========================================================================
  // 19. homeChildRoutes — reports routes absent when cloud
  // =========================================================================
  describe("homeChildRoutes — reports routes absent when cloud", () => {
    it("should NOT include reports route when isCloud is 'true'", () => {
      config.isCloud = "true";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "reports");
      expect(route).toBeUndefined();
    });

    it("should NOT include createReport route when isCloud is 'true'", () => {
      config.isCloud = "true";
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "createReport");
      expect(route).toBeUndefined();
    });
  });

  // =========================================================================
  // 20. homeChildRoutes — spreads from sub-composables
  // =========================================================================
  describe("homeChildRoutes — spreads from sub-composables", () => {
    it("should include route from useIngestionRoutes", async () => {
      const useIngestionRoutes = (await import("./useIngestionRoutes")).default;
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "ingestion");
      expect(useIngestionRoutes).toHaveBeenCalled();
      expect(route).toBeDefined();
    });

    it("should include route from useEnterpriseRoutes", async () => {
      const useEnterpriseRoutes = (await import("./useEnterpriseRoutes")).default;
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "iam");
      expect(useEnterpriseRoutes).toHaveBeenCalled();
      expect(route).toBeDefined();
    });

    it("should include route from useManagementRoutes", async () => {
      const useManagementRoutes = (await import("./useManagementRoutes")).default;
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "settings");
      expect(useManagementRoutes).toHaveBeenCalled();
      expect(route).toBeDefined();
    });
  });

  // =========================================================================
  // 21. homeChildRoutes — 404 catch-all
  // =========================================================================
  describe("homeChildRoutes — 404 catch-all", () => {
    it("should include catch-all route as last item", () => {
      const { homeChildRoutes } = useRoutes();
      const lastRoute = homeChildRoutes[homeChildRoutes.length - 1];
      expect(lastRoute.path).toBe("/:catchAll(.*)*");
    });

    it("should have meta title '404 - Not Found' for catch-all route", () => {
      const { homeChildRoutes } = useRoutes();
      const lastRoute = homeChildRoutes[homeChildRoutes.length - 1];
      expect(enTitle(lastRoute.meta.titleKey)).toBe("404 - Not Found");
    });

    it("should have keepAlive true for catch-all route", () => {
      const { homeChildRoutes } = useRoutes();
      const lastRoute = homeChildRoutes[homeChildRoutes.length - 1];
      expect(lastRoute.meta.keepAlive).toBe(true);
    });

    it("should have component defined for catch-all route", () => {
      const { homeChildRoutes } = useRoutes();
      const lastRoute = homeChildRoutes[homeChildRoutes.length - 1];
      expect(lastRoute.component).toBeDefined();
    });
  });

  // =========================================================================
  // 22. Route Guard Invocations — sampling across major routes
  // =========================================================================
  describe("Route Guard Invocations", () => {
    it("should call routeGuard for searchJobInspector route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "searchJobInspector");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for promqlBuilder route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "promqlBuilder");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for traces route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "traces");

      const mockTo = { query: { tab: "traces" } };
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for streamExplorer route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "streamExplorer");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for logstreams route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "logstreams");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for dashboards route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "dashboards");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for viewDashboard route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "viewDashboard");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for functionList route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "functionList");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for enrichmentTables route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "enrichmentTables");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for member_subscription route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "member_subscription");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for shortUrl route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "shortUrl");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for pipelineEditor route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelineEditor");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for pipelineHistory route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelineHistory");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for pipelineBackfill route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "pipelineBackfill");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for Sessions route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "Sessions");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard for rumPerformanceSummary route beforeEnter", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const route = findRoute(homeChildRoutes, "rumPerformanceSummary");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();
      route.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });
  });

  // =========================================================================
  // 23. Edge cases
  // =========================================================================
  describe("Edge Cases", () => {
    it("should have exactly 3 parentRoutes", () => {
      const { parentRoutes } = useRoutes();
      expect(parentRoutes).toHaveLength(3);
    });

    it("should have unique paths in parentRoutes", () => {
      const { parentRoutes } = useRoutes();
      const paths = parentRoutes.map((r: any) => r.path);
      const uniquePaths = [...new Set(paths)];
      expect(paths).toHaveLength(uniquePaths.length);
    });

    it("should have component or beforeEnter defined for every parentRoute", () => {
      const { parentRoutes } = useRoutes();
      parentRoutes.forEach((route: any) => {
        const hasComponent = route.component !== undefined;
        const hasBeforeEnter = typeof route.beforeEnter === "function";
        expect(hasComponent || hasBeforeEnter).toBe(true);
      });
    });

    it("should return more homeChildRoutes when isCloud is 'false' (reports injected)", () => {
      config.isCloud = "false";
      const { homeChildRoutes: nonCloudRoutes } = useRoutes();

      config.isCloud = "true";
      const { homeChildRoutes: cloudRoutes } = useRoutes();

      expect(nonCloudRoutes.length).toBe(cloudRoutes.length + 2);
    });

    /**
     * A top-level route must RESOLVE to something: either it renders a component,
     * it redirects, or it is a grouping parent whose children render.
     *
     * The third case is deliberate and load-bearing. `traces/databases` is a
     * componentless parent: it exists to own the path prefix and to apply the
     * Database Monitoring guard ONCE for every sub-view, while each child page
     * renders its own OPageLayout. Giving the parent a shell component instead
     * would nest two page layouts and push the child's header down — the bug
     * documented at Functions.vue:18-22. So the invariant is "resolves to
     * something", not "has a component".
     */
    it("should resolve every top-level homeChildRoute to a component, a redirect, or children", () => {
      const { homeChildRoutes } = useRoutes();
      homeChildRoutes.forEach((route: any) => {
        const resolves =
          route.component !== undefined ||
          route.redirect !== undefined ||
          (Array.isArray(route.children) && route.children.length > 0);
        expect(resolves, `route ${route.path} renders nothing`).toBe(true);
      });
    });

    /** ...and a componentless parent's children must themselves render. */
    it("should have a component on every child of a componentless parent route", () => {
      const { homeChildRoutes } = useRoutes();
      homeChildRoutes
        .filter((route: any) => !route.component && !route.redirect)
        .forEach((parent: any) => {
          expect(parent.children?.length).toBeGreaterThan(0);
          parent.children.forEach((child: any) => {
            expect(child.component, `${parent.path}/${child.path} renders nothing`).toBeDefined();
          });
        });
    });

    it("should have string path for every top-level homeChildRoute", () => {
      const { homeChildRoutes } = useRoutes();
      homeChildRoutes.forEach((route: any) => {
        expect(typeof route.path).toBe("string");
      });
    });

    it("should not produce duplicate names among top-level homeChildRoutes that have a name", () => {
      const { homeChildRoutes } = useRoutes();
      const names = homeChildRoutes
        .filter((r: any) => r.name !== undefined)
        .map((r: any) => r.name);
      const uniqueNames = [...new Set(names)];
      expect(names).toHaveLength(uniqueNames.length);
    });
  });

  // Route meta is untyped (`parentRoutes: any`), so a typo in a titleKey cannot be
  // caught by the compiler — this is the gate instead. An unresolvable key would
  // put the raw key in the browser tab.
  describe("meta.titleKey", () => {
    it("should only use i18n keys that exist in en-US.json", () => {
      const collect = (routes: any[]): string[] =>
        routes.flatMap((route) => [
          ...(route?.meta?.titleKey ? [route.meta.titleKey] : []),
          ...collect(route?.children ?? []),
        ]);

      const { parentRoutes, homeChildRoutes } = useRoutes();
      const titleKeys = collect([...parentRoutes, ...homeChildRoutes]);
      expect(titleKeys.length).toBeGreaterThan(0);

      for (const titleKey of titleKeys) {
        expect(enTitle(titleKey), `no en-US message for "${titleKey}"`).toBeTypeOf("string");
      }
    });
  });
});
