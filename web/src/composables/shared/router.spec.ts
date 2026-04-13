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
vi.mock("@/utils/zincutils", () => ({
  routeGuard: vi.fn((to: any, from: any, next: any) => next()),
  useLocalUserInfo: vi.fn(),
  useLocalCurrentUser: vi.fn(),
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
vi.mock("@/plugins/logs/SearchJobInspector.vue", () => ({ default: { name: "SearchJobInspector" } }));
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
vi.mock("@/components/functions/AssociatedStreamFunction.vue", () => ({ default: { name: "AssociatedStreamFunction" } }));
vi.mock("@/components/functions/EnrichmentTableList.vue", () => ({ default: { name: "EnrichmentTableList" } }));
vi.mock("@/views/RUM/RealUserMonitoring.vue", () => ({ default: { name: "RealUserMonitoring" } }));
vi.mock("@/views/RUM/SessionViewer.vue", () => ({ default: { name: "SessionViewer" } }));
vi.mock("@/views/RUM/ErrorViewer.vue", () => ({ default: { name: "ErrorViewer" } }));
vi.mock("@/views/RUM/AppPerformance.vue", () => ({ default: { name: "AppPerformance" } }));
vi.mock("@/views/RUM/AppErrors.vue", () => ({ default: { name: "AppErrors" } }));
vi.mock("@/views/RUM/AppSessions.vue", () => ({ default: { name: "AppSessions" } }));
vi.mock("@/components/reports/ReportList.vue", () => ({ default: { name: "ReportList" } }));
vi.mock("@/components/reports/CreateReport.vue", () => ({ default: { name: "CreateReport" } }));
vi.mock("@/components/rum/performance/PerformanceSummary.vue", () => ({ default: { name: "PerformanceSummary" } }));
vi.mock("@/components/rum/performance/WebVitalsDashboard.vue", () => ({ default: { name: "WebVitalsDashboard" } }));
vi.mock("@/components/rum/performance/ErrorsDashboard.vue", () => ({ default: { name: "ErrorsDashboard" } }));
vi.mock("@/components/rum/performance/ApiDashboard.vue", () => ({ default: { name: "ApiDashboard" } }));
vi.mock("@/components/pipeline/PipelineEditor.vue", () => ({ default: { name: "PipelineEditor" } }));
vi.mock("@/components/pipeline/PipelinesList.vue", () => ({ default: { name: "PipelinesList" } }));
vi.mock("@/components/pipeline/ImportPipeline.vue", () => ({ default: { name: "ImportPipeline" } }));
vi.mock("@/views/AddAlertView.vue", () => ({ default: { name: "AddAlertView" } }));
vi.mock("@/components/alerts/AlertHistory.vue", () => ({ default: { name: "AlertHistory" } }));
vi.mock("@/components/alerts/AlertInsights.vue", () => ({ default: { name: "AlertInsights" } }));
vi.mock("@/components/alerts/ImportSemanticGroups.vue", () => ({ default: { name: "ImportSemanticGroups" } }));
vi.mock("@/components/pipelines/PipelineHistory.vue", () => ({ default: { name: "PipelineHistory" } }));
vi.mock("@/components/pipelines/BackfillJobsList.vue", () => ({ default: { name: "BackfillJobsList" } }));

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
      expect(loginRoute.meta.title).toBe("Login");
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
      expect(cbRoute.meta.title).toBe("Login Callback");
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
      expect(homeRoute.meta.title).toBe("Home");
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
      expect(logsRoute.meta.title).toBe("Logs");
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
      expect(metricsRoute.meta.title).toBe("Metrics");
    });

    it("should have beforeEnter guard that calls routeGuard for metrics route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const { homeChildRoutes } = useRoutes();
      const metricsRoute = findRoute(homeChildRoutes, "metrics");

      const mockNext = vi.fn();
      metricsRoute.beforeEnter({}, {}, mockNext);
      expect(routeGuard).toHaveBeenCalledTimes(1);
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
      expect(tracesRoute.meta.title).toBe("Traces");
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

    it("should include service-graph redirect route", () => {
      const { homeChildRoutes } = useRoutes();
      const route = homeChildRoutes.find((r: any) => r.path === "service-graph");
      expect(route).toBeDefined();
      expect(route.redirect).toBe("/traces");
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
      expect(route.meta.title).toBe("Dashboards");
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
      expect(route.meta.title).toBe("Streams");
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
      expect(route.meta.title).toBe("About");
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
      expect(route.meta.title).toBe("Pipeline");
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
      expect(route.meta.title).toBe("Pipeline History");
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
      expect(route.meta.title).toBe("Pipeline Backfill Jobs");
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
      expect(route.meta.title).toBe("Alerts");
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
      expect(route.meta.title).toBe("Real User Monitoring");
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
      expect(route.meta.title).toBe("Member Subscription");
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
      expect(route.meta.title).toBe("Reports");
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
      expect(route.meta.title).toBe("Create Report");
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
      expect(lastRoute.meta.title).toBe("404 - Not Found");
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

      const mockTo = {};
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

    it("should have component defined for every top-level homeChildRoute that is not a redirect", () => {
      const { homeChildRoutes } = useRoutes();
      homeChildRoutes.forEach((route: any) => {
        if (!route.redirect) {
          expect(route.component).toBeDefined();
        }
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
});
