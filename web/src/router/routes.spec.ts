// Copyright 2025 OpenObserve Inc.
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

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock all heavy imports so the module-level side-effects in routes.ts
// (calling useRoutes() and useOSRoutes() at the top level) resolve cleanly.
// ---------------------------------------------------------------------------

vi.mock("@/composables/shared/router", () => ({
  default: () => ({
    parentRoutes: [
      {
        path: "/login",
        name: "login",
        component: { template: "<div>Login</div>" },
        meta: { title: "Login" },
      },
      {
        path: "/logout",
        name: "logout",
        component: { template: "<div>Logout</div>" },
      },
      {
        path: "/cb",
        name: "callback",
        component: { template: "<div>Callback</div>" },
        meta: { title: "Login Callback" },
      },
    ],
    homeChildRoutes: [
      {
        path: "",
        name: "home",
        component: { template: "<div>Home</div>" },
        meta: { title: "Home" },
      },
      {
        path: "logs",
        name: "logs",
        component: { template: "<div>Logs</div>" },
        meta: { title: "Logs" },
      },
      {
        path: "metrics",
        name: "metrics",
        component: { template: "<div>Metrics</div>" },
        meta: { title: "Metrics" },
      },
      {
        path: "traces",
        name: "traces",
        component: { template: "<div>Traces</div>" },
        meta: { title: "Traces" },
      },
      {
        path: "dashboards",
        name: "dashboards",
        component: { template: "<div>Dashboards</div>" },
        meta: { title: "Dashboards" },
      },
      {
        path: "alerts",
        name: "alertList",
        component: { template: "<div>Alerts</div>" },
        meta: { title: "Alerts" },
      },
      {
        path: "streams",
        name: "logstreams",
        component: { template: "<div>Streams</div>" },
        meta: { title: "Streams" },
      },
      {
        path: "pipeline",
        name: "pipeline",
        component: { template: "<div>Pipeline</div>" },
        meta: { title: "Pipeline" },
        children: [
          {
            path: "functions",
            name: "functionList",
            component: { template: "<div>Functions</div>" },
          },
          {
            path: "enrichment-tables",
            name: "enrichmentTables",
            component: { template: "<div>Enrichment Tables</div>" },
          },
          {
            path: "pipelines",
            name: "pipelines",
            component: { template: "<div>Pipelines</div>" },
            children: [
              {
                path: "edit",
                name: "pipelineEditor",
                component: { template: "<div>Editor</div>" },
              },
              {
                path: "add",
                name: "createPipeline",
                component: { template: "<div>Create</div>" },
              },
            ],
          },
        ],
      },
      {
        path: "rum",
        name: "RUM",
        component: { template: "<div>RUM</div>" },
        meta: { title: "Real User Monitoring" },
        children: [
          {
            path: "sessions",
            name: "Sessions",
            component: { template: "<div>Sessions</div>" },
          },
          {
            path: "errors",
            name: "ErrorTracking",
            component: { template: "<div>Errors</div>" },
          },
          {
            path: "performance",
            name: "RumPerformance",
            component: { template: "<div>Performance</div>" },
            children: [
              {
                path: "overview",
                name: "rumPerformanceSummary",
                component: { template: "<div>Overview</div>" },
              },
            ],
          },
        ],
      },
      {
        path: "about",
        name: "about",
        component: { template: "<div>About</div>" },
        meta: { title: "About" },
      },
    ],
  }),
}));

vi.mock("@/composables/router", () => ({
  default: () => ({
    parentRoutes: [],
    homeChildRoutes: [
      {
        path: "ingestion",
        name: "ingestion",
        component: { template: "<div>Ingestion</div>" },
      },
    ],
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getPath: vi.fn().mockReturnValue("/"),
  mergeRoutes: vi.fn((r1: any[], r2: any[]) => [...(r1 || []), ...(r2 || [])]),
  routeGuard: vi.fn((to: any, from: any, next: any) => next()),
  useLocalUserInfo: vi.fn(),
  useLocalCurrentUser: vi.fn(),
}));

vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false",
    isEnterprise: "false",
  },
}));

// Stub every view / component lazily imported by router.ts at module load time
vi.mock("@/views/HomeView.vue", () => ({
  default: { template: "<div>Home</div>" },
}));
vi.mock("@/views/Dashboards/ImportDashboard.vue", () => ({
  default: { template: "<div>ImportDashboard</div>" },
}));
vi.mock("@/views/About.vue", () => ({
  default: { template: "<div>About</div>" },
}));
vi.mock("@/views/MemberSubscription.vue", () => ({
  default: { template: "<div>MemberSubscription</div>" },
}));
vi.mock("@/views/Error404.vue", () => ({
  default: { template: "<div>404</div>" },
}));
vi.mock("@/views/ShortUrl.vue", () => ({
  default: { template: "<div>ShortUrl</div>" },
}));
vi.mock("@/views/Login.vue", () => ({
  default: { template: "<div>Login</div>" },
}));
vi.mock("@/layouts/MainLayout.vue", () => ({
  default: { template: "<div><router-view /></div>" },
}));
vi.mock("@/composables/shared/useIngestionRoutes", () => ({
  default: () => [],
}));
vi.mock("@/composables/shared/useEnterpriseRoutes", () => ({
  default: () => [],
}));
vi.mock("@/composables/shared/useManagementRoutes", () => ({
  default: () => [],
}));

// ---------------------------------------------------------------------------
// Import the router created by routes.ts (module-level singleton)
// ---------------------------------------------------------------------------
import routerInstance from "@/router/routes";

// ---------------------------------------------------------------------------
// Helper: flatten the nested route tree into a single list of route records
// ---------------------------------------------------------------------------
function flattenRoutes(routes: any[]): any[] {
  return routes.reduce((acc: any[], route: any) => {
    acc.push(route);
    if (route.children && route.children.length) {
      acc.push(...flattenRoutes(route.children));
    }
    return acc;
  }, []);
}

describe("router/routes (singleton)", () => {
  const allRoutes = flattenRoutes(routerInstance.getRoutes());

  // -------------------------------------------------------------------------
  // Router instance sanity checks
  // -------------------------------------------------------------------------
  describe("router instance", () => {
    it("should export a valid router instance with a push method", () => {
      expect(typeof routerInstance.push).toBe("function");
    });

    it("should have routes registered", () => {
      expect(routerInstance.getRoutes().length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Top-level / parent routes
  // -------------------------------------------------------------------------
  describe("parent routes", () => {
    it("should include a /login route", () => {
      const route = allRoutes.find((r) => r.path === "/login");
      expect(route).toBeDefined();
    });

    it("/login route should have meta.title of 'Login'", () => {
      const route = allRoutes.find((r) => r.path === "/login");
      expect(route?.meta?.title).toBe("Login");
    });

    it("should include a /logout route", () => {
      const route = allRoutes.find((r) => r.path === "/logout");
      expect(route).toBeDefined();
    });

    it("should include a /cb callback route", () => {
      const route = allRoutes.find(
        (r) => r.name === "callback" || r.path === "/cb",
      );
      expect(route).toBeDefined();
    });

    it("should include a root '/' layout route", () => {
      const route = allRoutes.find((r) => r.path === "/");
      expect(route).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Child routes (home children)
  // -------------------------------------------------------------------------
  describe("home child routes – core paths", () => {
    it("should include a 'home' route", () => {
      const route = allRoutes.find((r) => r.name === "home");
      expect(route).toBeDefined();
    });

    it("should include a 'logs' route", () => {
      const route = allRoutes.find((r) => r.name === "logs");
      expect(route).toBeDefined();
    });

    it("'logs' route should have meta.title of 'Logs'", () => {
      const route = allRoutes.find((r) => r.name === "logs");
      expect(route?.meta?.title).toBe("Logs");
    });

    it("should include a 'metrics' route", () => {
      const route = allRoutes.find((r) => r.name === "metrics");
      expect(route).toBeDefined();
    });

    it("'metrics' route should have meta.title of 'Metrics'", () => {
      const route = allRoutes.find((r) => r.name === "metrics");
      expect(route?.meta?.title).toBe("Metrics");
    });

    it("should include a 'traces' route", () => {
      const route = allRoutes.find((r) => r.name === "traces");
      expect(route).toBeDefined();
    });

    it("'traces' route should have meta.title of 'Traces'", () => {
      const route = allRoutes.find((r) => r.name === "traces");
      expect(route?.meta?.title).toBe("Traces");
    });

    it("should include a 'dashboards' route", () => {
      const route = allRoutes.find((r) => r.name === "dashboards");
      expect(route).toBeDefined();
    });

    it("should include an 'alertList' route", () => {
      const route = allRoutes.find((r) => r.name === "alertList");
      expect(route).toBeDefined();
    });

    it("'alertList' route should have meta.title of 'Alerts'", () => {
      const route = allRoutes.find((r) => r.name === "alertList");
      expect(route?.meta?.title).toBe("Alerts");
    });

    it("should include a 'logstreams' route", () => {
      const route = allRoutes.find((r) => r.name === "logstreams");
      expect(route).toBeDefined();
    });

    it("should include an 'about' route", () => {
      const route = allRoutes.find((r) => r.name === "about");
      expect(route).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Pipeline nested routes
  // -------------------------------------------------------------------------
  describe("pipeline nested routes", () => {
    it("should include a 'pipeline' parent route", () => {
      const route = allRoutes.find((r) => r.name === "pipeline");
      expect(route).toBeDefined();
    });

    it("should include a 'functionList' child under pipeline", () => {
      const route = allRoutes.find((r) => r.name === "functionList");
      expect(route).toBeDefined();
    });

    it("should include an 'enrichmentTables' child under pipeline", () => {
      const route = allRoutes.find((r) => r.name === "enrichmentTables");
      expect(route).toBeDefined();
    });

    it("should include a 'pipelines' child under pipeline", () => {
      const route = allRoutes.find((r) => r.name === "pipelines");
      expect(route).toBeDefined();
    });

    it("should include a 'pipelineEditor' child under pipelines", () => {
      const route = allRoutes.find((r) => r.name === "pipelineEditor");
      expect(route).toBeDefined();
    });

    it("should include a 'createPipeline' child under pipelines", () => {
      const route = allRoutes.find((r) => r.name === "createPipeline");
      expect(route).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // RUM nested routes
  // -------------------------------------------------------------------------
  describe("RUM nested routes", () => {
    it("should include a 'RUM' parent route", () => {
      const route = allRoutes.find((r) => r.name === "RUM");
      expect(route).toBeDefined();
    });

    it("'RUM' route should have meta.title of 'Real User Monitoring'", () => {
      const route = allRoutes.find((r) => r.name === "RUM");
      expect(route?.meta?.title).toBe("Real User Monitoring");
    });

    it("should include a 'Sessions' child route under RUM", () => {
      const route = allRoutes.find((r) => r.name === "Sessions");
      expect(route).toBeDefined();
    });

    it("should include an 'ErrorTracking' child route under RUM", () => {
      const route = allRoutes.find((r) => r.name === "ErrorTracking");
      expect(route).toBeDefined();
    });

    it("should include a 'RumPerformance' child route under RUM", () => {
      const route = allRoutes.find((r) => r.name === "RumPerformance");
      expect(route).toBeDefined();
    });

    it("should include a 'rumPerformanceSummary' child under RumPerformance", () => {
      const route = allRoutes.find((r) => r.name === "rumPerformanceSummary");
      expect(route).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // OS / ingestion routes contributed by useOSRoutes composable
  // -------------------------------------------------------------------------
  describe("OS ingestion routes", () => {
    it("should include an 'ingestion' route contributed by the OS composable", () => {
      const route = allRoutes.find((r) => r.name === "ingestion");
      expect(route).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Route name uniqueness
  // -------------------------------------------------------------------------
  describe("route name uniqueness", () => {
    it("should not contain duplicate route names", () => {
      const names = allRoutes
        .filter((r) => r.name)
        .map((r) => r.name as string);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });
  });

  // -------------------------------------------------------------------------
  // Meta title presence
  // -------------------------------------------------------------------------
  describe("meta.title presence for key routes", () => {
    const routesRequiringTitles = [
      { name: "logs", expectedTitle: "Logs" },
      { name: "metrics", expectedTitle: "Metrics" },
      { name: "traces", expectedTitle: "Traces" },
      { name: "dashboards", expectedTitle: "Dashboards" },
      { name: "alertList", expectedTitle: "Alerts" },
      { name: "about", expectedTitle: "About" },
      { name: "RUM", expectedTitle: "Real User Monitoring" },
    ];

    routesRequiringTitles.forEach(({ name, expectedTitle }) => {
      it(`'${name}' route should have meta.title set to '${expectedTitle}'`, () => {
        const route = allRoutes.find((r) => r.name === name);
        expect(route?.meta?.title).toBe(expectedTitle);
      });
    });
  });
});
