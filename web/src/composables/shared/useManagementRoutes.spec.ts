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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import useManagementRoutes from "./useManagementRoutes";
import config from "@/aws-exports";
import { routeGuard } from "@/utils/zincutils";
import store from "../../test/unit/helpers/store";

// Mock the config module
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "false",
    isCloud: "false",
  },
}));

// Mock the routeGuard function
vi.mock("@/utils/zincutils", () => ({
  routeGuard: vi.fn(),
}));

// Mock dynamic imports
vi.mock("@/components/settings/index.vue", () => ({
  default: {},
}));

vi.mock("@/components/alerts/TemplateList.vue", () => ({
  default: {},
}));

vi.mock("@/components/alerts/AlertsDestinationList.vue", () => ({
  default: {},
}));

describe("useManagementRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config to default values
    config.isEnterprise = "false";
    config.isCloud = "false";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Functionality", () => {
    it("should be a function", () => {
      expect(typeof useManagementRoutes).toBe("function");
    });

    it("should return an array", () => {
      const routes = useManagementRoutes();
      expect(Array.isArray(routes)).toBe(true);
    });

    it("should return exactly one main route when no enterprise/cloud config", () => {
      const routes = useManagementRoutes();
      expect(routes).toHaveLength(1);
    });

    it("should return routes with settings as the main route", () => {
      const routes = useManagementRoutes();
      expect(routes[0].path).toBe("settings");
      expect(routes[0].name).toBe("settings");
    });

    it("should have settings route with correct meta properties", () => {
      const routes = useManagementRoutes();
      expect(routes[0].meta).toEqual({ keepAlive: true, title: "Settings" });
    });

    it("should have settings route with component defined", () => {
      const routes = useManagementRoutes();
      expect(routes[0].component).toBeDefined();
    });

    it("should have settings route with beforeEnter hook", () => {
      const routes = useManagementRoutes();
      expect(typeof routes[0].beforeEnter).toBe("function");
    });

    it("should call routeGuard in settings beforeEnter hook", () => {
      const routes = useManagementRoutes();
      const mockTo = { path: "/settings" };
      const mockFrom = { path: "/" };
      const mockNext = vi.fn();

      routes[0].beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should have children array in settings route", () => {
      const routes = useManagementRoutes();
      expect(Array.isArray(routes[0].children)).toBe(true);
    });

    it("should have at least 4 base children routes", () => {
      const routes = useManagementRoutes();
      expect(routes[0].children.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("Base Children Routes", () => {
    let routes: any;
    
    beforeEach(() => {
      routes = useManagementRoutes();
    });

    it("should have general route as first child", () => {
      const generalRoute = routes[0].children.find((child: any) => child.name === "general");
      expect(generalRoute).toBeDefined();
      expect(generalRoute.path).toBe("general");
    });

    it("should have organizationSettings route", () => {
      const orgRoute = routes[0].children.find((child: any) => child.name === "organizationSettings");
      expect(orgRoute).toBeDefined();
      expect(orgRoute.path).toBe("organization");
    });

    it("should have alertDestinations route", () => {
      const alertDestRoute = routes[0].children.find((child: any) => child.name === "alertDestinations");
      expect(alertDestRoute).toBeDefined();
      expect(alertDestRoute.path).toBe("alert_destinations");
    });

    it("should have alertTemplates route", () => {
      const templateRoute = routes[0].children.find((child: any) => child.name === "alertTemplates");
      expect(templateRoute).toBeDefined();
      expect(templateRoute.path).toBe("templates");
    });

    it("should have beforeEnter hook for general route", () => {
      const generalRoute = routes[0].children.find((child: any) => child.name === "general");
      expect(typeof generalRoute.beforeEnter).toBe("function");
    });

    it("should have beforeEnter hook for organizationSettings route", () => {
      const orgRoute = routes[0].children.find((child: any) => child.name === "organizationSettings");
      expect(typeof orgRoute.beforeEnter).toBe("function");
    });

    it("should have beforeEnter hook for alertDestinations route", () => {
      const alertDestRoute = routes[0].children.find((child: any) => child.name === "alertDestinations");
      expect(typeof alertDestRoute.beforeEnter).toBe("function");
    });

    it("should have beforeEnter hook for alertTemplates route", () => {
      const templateRoute = routes[0].children.find((child: any) => child.name === "alertTemplates");
      expect(typeof templateRoute.beforeEnter).toBe("function");
    });

    it("should call routeGuard in general route beforeEnter", () => {
      const generalRoute = routes[0].children.find((child: any) => child.name === "general");
      const mockTo = { path: "/settings/general" };
      const mockFrom = { path: "/settings" };
      const mockNext = vi.fn();

      generalRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard in organizationSettings route beforeEnter", () => {
      const orgRoute = routes[0].children.find((child: any) => child.name === "organizationSettings");
      const mockTo = { path: "/settings/organization" };
      const mockFrom = { path: "/settings" };
      const mockNext = vi.fn();

      orgRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard in alertDestinations route beforeEnter", () => {
      const alertDestRoute = routes[0].children.find((child: any) => child.name === "alertDestinations");
      const mockTo = { path: "/settings/alert_destinations" };
      const mockFrom = { path: "/settings" };
      const mockNext = vi.fn();

      alertDestRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should call routeGuard in alertTemplates route beforeEnter", () => {
      const templateRoute = routes[0].children.find((child: any) => child.name === "alertTemplates");
      const mockTo = { path: "/settings/templates" };
      const mockFrom = { path: "/settings" };
      const mockNext = vi.fn();

      templateRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should have component defined for each base child route", () => {
      routes[0].children.forEach((child: any) => {
        expect(child.component).toBeDefined();
      });
    });

    it("should have correct path for each base child route", () => {
      const expectedPaths = ["general", "organization", "alert_destinations", "templates"];
      const actualPaths = routes[0].children.slice(0, 4).map((child: any) => child.path);
      expect(actualPaths).toEqual(expectedPaths);
    });

    it("should have unique names for each base child route", () => {
      const names = routes[0].children.slice(0, 4).map((child: any) => child.name);
      const uniqueNames = [...new Set(names)];
      expect(names).toHaveLength(uniqueNames.length);
    });
  });

  describe("Enterprise Routes", () => {
    beforeEach(() => {
      config.isEnterprise = "true";
      config.isCloud = "false";
    });

    it("should include enterprise routes when isEnterprise is true", () => {
      const routes = useManagementRoutes();
      expect(routes[0].children.length).toBeGreaterThan(4);
    });

    it("should have query_management route when enterprise", () => {
      const routes = useManagementRoutes();
      const queryMgmtRoute = routes[0].children.find((child: any) => child.name === "query_management");
      expect(queryMgmtRoute).toBeDefined();
      expect(queryMgmtRoute.path).toBe("query_management");
    });

    it("should have cipherKeys route when enterprise", () => {
      const routes = useManagementRoutes();
      const cipherRoute = routes[0].children.find((child: any) => child.name === "cipherKeys");
      expect(cipherRoute).toBeDefined();
      expect(cipherRoute.path).toBe("cipher_keys");
    });

    it("should have pipelineDestinations route when enterprise", () => {
      const routes = useManagementRoutes();
      const pipelineRoute = routes[0].children.find((child: any) => child.name === "pipelineDestinations");
      expect(pipelineRoute).toBeDefined();
      expect(pipelineRoute.path).toBe("pipeline_destinations");
    });

    it("should have nodes route when enterprise", () => {
      const routes = useManagementRoutes();
      const nodesRoute = routes[0].children.find((child: any) => child.name === "nodes");
      expect(nodesRoute).toBeDefined();
      expect(nodesRoute.path).toBe("nodes");
    });

    it("should have domainManagement route when enterprise", () => {
      const routes = useManagementRoutes();
      const domainRoute = routes[0].children.find((child: any) => child.name === "domainManagement");
      expect(domainRoute).toBeDefined();
      expect(domainRoute.path).toBe("domain_management");
    });

    it("should have regexPatterns route when enterprise", () => {
      const routes = useManagementRoutes();
      const regexRoute = routes[0].children.find((child: any) => child.name === "regexPatterns");
      expect(regexRoute).toBeDefined();
      expect(regexRoute.path).toBe("regex_patterns");
    });

    it("should have correct meta properties for query_management route", () => {
      const routes = useManagementRoutes();
      const queryMgmtRoute = routes[0].children.find((child: any) => child.name === "query_management");
      expect(queryMgmtRoute.meta).toEqual({ keepAlive: true, title: "Query Management" });
    });

    it("should have correct meta properties for cipherKeys route", () => {
      const routes = useManagementRoutes();
      const cipherRoute = routes[0].children.find((child: any) => child.name === "cipherKeys");
      expect(cipherRoute.meta).toEqual({ keepAlive: true, title: "Cipher Keys" });
    });

    it("should have correct meta properties for nodes route", () => {
      const routes = useManagementRoutes();
      const nodesRoute = routes[0].children.find((child: any) => child.name === "nodes");
      expect(nodesRoute.meta).toEqual({ keepAlive: true, title: "Nodes" });
    });

    it("should have correct meta properties for domainManagement route", () => {
      const routes = useManagementRoutes();
      const domainRoute = routes[0].children.find((child: any) => child.name === "domainManagement");
      expect(domainRoute.meta).toEqual({ keepAlive: true, title: "Domain Management" });
    });

    it("should have correct meta properties for regexPatterns route", () => {
      const routes = useManagementRoutes();
      const regexRoute = routes[0].children.find((child: any) => child.name === "regexPatterns");
      expect(regexRoute.meta).toEqual({ keepAlive: true, title: "Regex Patterns" });
    });

    it("should have correct meta properties for pipelineDestinations route", () => {
      const routes = useManagementRoutes();
      const pipelineRoute = routes[0].children.find((child: any) => child.name === "pipelineDestinations");
      expect(pipelineRoute.meta).toEqual({ title: "Pipeline Destinations" });
    });

    it("should have beforeEnter hooks for all enterprise routes", () => {
      const routes = useManagementRoutes();
      const enterpriseRoutes = [
        "query_management", "cipherKeys", "pipelineDestinations", 
        "nodes", "domainManagement", "regexPatterns"
      ];
      
      enterpriseRoutes.forEach(routeName => {
        const route = routes[0].children.find((child: any) => child.name === routeName);
        expect(typeof route.beforeEnter).toBe("function");
      });
    });

    it("should call routeGuard in enterprise route beforeEnter hooks", () => {
      const routes = useManagementRoutes();
      const queryMgmtRoute = routes[0].children.find((child: any) => child.name === "query_management");
      const mockTo = { path: "/settings/query_management" };
      const mockFrom = { path: "/settings" };
      const mockNext = vi.fn();

      queryMgmtRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should have components defined for all enterprise routes", () => {
      const routes = useManagementRoutes();
      const enterpriseRoutes = [
        "query_management", "cipherKeys", "pipelineDestinations", 
        "nodes", "domainManagement", "regexPatterns"
      ];
      
      enterpriseRoutes.forEach(routeName => {
        const route = routes[0].children.find((child: any) => child.name === routeName);
        expect(route.component).toBeDefined();
      });
    });

    it("should have exactly 12 children routes when enterprise is enabled", () => {
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(12); // 4 base + 8 enterprise (query_management, cipherKeys, pipelineDestinations, nodes, domainManagement, regexPatterns, correlationSettings, license)
    });
  });

  describe("Cloud Routes", () => {
    beforeEach(() => {
      config.isEnterprise = "false";
      config.isCloud = "true";
    });

    it("should include cloud routes when isCloud is true", () => {
      const routes = useManagementRoutes();
      expect(routes[0].children.length).toBeGreaterThan(4);
    });

    it("should have orgnizationManagement route when cloud", () => {
      const routes = useManagementRoutes();
      const orgMgmtRoute = routes[0].children.find((child: any) => child.name === "orgnizationManagement");
      expect(orgMgmtRoute).toBeDefined();
      expect(orgMgmtRoute.path).toBe("organization_management");
    });

    it("should have correct meta properties for orgnizationManagement route", () => {
      const routes = useManagementRoutes();
      const orgMgmtRoute = routes[0].children.find((child: any) => child.name === "orgnizationManagement");
      expect(orgMgmtRoute.meta).toEqual({ keepAlive: true, title: "Organization Management" });
    });

    it("should have beforeEnter hook for orgnizationManagement route", () => {
      const routes = useManagementRoutes();
      const orgMgmtRoute = routes[0].children.find((child: any) => child.name === "orgnizationManagement");
      expect(typeof orgMgmtRoute.beforeEnter).toBe("function");
    });

    it("should call routeGuard in orgnizationManagement beforeEnter hook", () => {
      const routes = useManagementRoutes();
      const orgMgmtRoute = routes[0].children.find((child: any) => child.name === "orgnizationManagement");
      const mockTo = { path: "/settings/organization_management" };
      const mockFrom = { path: "/settings" };
      const mockNext = vi.fn();

      orgMgmtRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    it("should have component defined for orgnizationManagement route", () => {
      const routes = useManagementRoutes();
      const orgMgmtRoute = routes[0].children.find((child: any) => child.name === "orgnizationManagement");
      expect(orgMgmtRoute.component).toBeDefined();
    });

    it("should have exactly 5 children routes when cloud is enabled", () => {
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(5); // 4 base + 1 cloud
    });
  });

  describe("Combined Enterprise and Cloud Routes", () => {
    beforeEach(() => {
      config.isEnterprise = "true";
      config.isCloud = "true";
    });

    it("should include both enterprise and cloud routes when both are enabled", () => {
      const routes = useManagementRoutes();
      expect(routes[0].children.length).toBeGreaterThan(10);
    });

    it("should have exactly 13 children routes when both enterprise and cloud are enabled", () => {
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(13); // 4 base + 8 enterprise + 1 cloud
    });

    it("should have all enterprise routes when both are enabled", () => {
      const routes = useManagementRoutes();
      const enterpriseRoutes = [
        "query_management", "cipherKeys", "pipelineDestinations", 
        "nodes", "domainManagement", "regexPatterns"
      ];
      
      enterpriseRoutes.forEach(routeName => {
        const route = routes[0].children.find((child: any) => child.name === routeName);
        expect(route).toBeDefined();
      });
    });

    it("should have cloud route when both are enabled", () => {
      const routes = useManagementRoutes();
      const orgMgmtRoute = routes[0].children.find((child: any) => child.name === "orgnizationManagement");
      expect(orgMgmtRoute).toBeDefined();
    });
  });

  describe("Route Configuration Validation", () => {
    it("should have unique route names across all children", () => {
      config.isEnterprise = "true";
      config.isCloud = "true";
      const routes = useManagementRoutes();
      const names = routes[0].children.map((child: any) => child.name);
      const uniqueNames = [...new Set(names)];
      expect(names).toHaveLength(uniqueNames.length);
    });

    it("should have unique paths across all children", () => {
      config.isEnterprise = "true";
      config.isCloud = "true";
      const routes = useManagementRoutes();
      const paths = routes[0].children.map((child: any) => child.path);
      const uniquePaths = [...new Set(paths)];
      expect(paths).toHaveLength(uniquePaths.length);
    });

    it("should not have empty or undefined route names", () => {
      config.isEnterprise = "true";
      config.isCloud = "true";
      const routes = useManagementRoutes();
      routes[0].children.forEach((child: any) => {
        expect(child.name).toBeDefined();
        expect(child.name).not.toBe("");
        expect(typeof child.name).toBe("string");
      });
    });

    it("should not have empty or undefined route paths", () => {
      config.isEnterprise = "true";
      config.isCloud = "true";
      const routes = useManagementRoutes();
      routes[0].children.forEach((child: any) => {
        expect(child.path).toBeDefined();
        expect(child.path).not.toBe("");
        expect(typeof child.path).toBe("string");
      });
    });

    it("should have valid component imports for all routes", () => {
      config.isEnterprise = "true";
      config.isCloud = "true";
      const routes = useManagementRoutes();
      routes[0].children.forEach((child: any) => {
        expect(child.component).toBeDefined();
        expect(typeof child.component === "function" || typeof child.component === "object").toBe(true);
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle isEnterprise as string 'false'", () => {
      config.isEnterprise = "false";
      config.isCloud = "false";
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(4); // Only base routes
    });

    it("should handle isCloud as string 'false'", () => {
      config.isEnterprise = "false";
      config.isCloud = "false";
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(4); // Only base routes
    });

    it("should handle isEnterprise as undefined", () => {
      (config as any).isEnterprise = undefined;
      config.isCloud = "false";
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(4); // Only base routes
    });

    it("should handle isCloud as undefined", () => {
      config.isEnterprise = "false";
      (config as any).isCloud = undefined;
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(4); // Only base routes
    });

    it("should handle both config values as undefined", () => {
      (config as any).isEnterprise = undefined;
      (config as any).isCloud = undefined;
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(4); // Only base routes
    });

    it("should handle isEnterprise as non-string truthy value", () => {
      (config as any).isEnterprise = true;
      config.isCloud = "false";
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(4); // Only base routes, since comparison is with "true"
    });

    it("should handle isCloud as non-string truthy value", () => {
      config.isEnterprise = "false";
      (config as any).isCloud = true;
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(4); // Only base routes, since comparison is with "true"
    });

    it("should handle empty string for isEnterprise", () => {
      config.isEnterprise = "";
      config.isCloud = "false";
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(4); // Only base routes
    });

    it("should handle empty string for isCloud", () => {
      config.isEnterprise = "false";
      config.isCloud = "";
      const routes = useManagementRoutes();
      expect(routes[0].children).toHaveLength(4); // Only base routes
    });

    it("should return the same structure on multiple calls", () => {
      config.isEnterprise = "true";
      config.isCloud = "true";
      const routes1 = useManagementRoutes();
      const routes2 = useManagementRoutes();
      
      // Compare the structure rather than object references
      expect(routes1.length).toBe(routes2.length);
      expect(routes1[0].path).toBe(routes2[0].path);
      expect(routes1[0].name).toBe(routes2[0].name);
      expect(routes1[0].children.length).toBe(routes2[0].children.length);
      
      // Compare child routes structure
      routes1[0].children.forEach((child1: any, index: number) => {
        const child2 = routes2[0].children[index];
        expect(child1.path).toBe(child2.path);
        expect(child1.name).toBe(child2.name);
      });
    });

    it("should return different structures when config changes", () => {
      config.isEnterprise = "false";
      config.isCloud = "false";
      const routes1 = useManagementRoutes();
      
      config.isEnterprise = "true";
      config.isCloud = "true";
      const routes2 = useManagementRoutes();
      
      expect(routes1[0].children.length).toBeLessThan(routes2[0].children.length);
    });

    it("should maintain immutability of the returned routes array", () => {
      const routes = useManagementRoutes();
      const originalLength = routes[0].children.length;
      
      // Attempt to modify the returned array
      routes[0].children.push({ name: "test", path: "test" });
      
      // Get new routes and verify original structure is maintained
      const newRoutes = useManagementRoutes();
      expect(newRoutes[0].children.length).toBe(originalLength);
    });
  });
});