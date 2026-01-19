import { describe, it, expect, vi, beforeEach } from "vitest";
import useRateLimiter from "./useRateLimiter";

// Mock dependencies
vi.mock("vuex", () => ({
  useStore: vi.fn(),
}));

vi.mock("quasar", () => ({
  useQuasar: vi.fn(() => ({})),
}));

vi.mock("@/services/rate_limit", () => ({
  default: {
    getApiLimits: vi.fn(),
    getRoleLimits: vi.fn(),
    getModules: vi.fn(),
  },
}));

import { useStore } from "vuex";
import rateLimiterService from "@/services/rate_limit";

describe("useRateLimiter", () => {
  let mockStore: any;
  let rateLimiterInstance: ReturnType<typeof useRateLimiter>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockStore = {
      state: {
        allApiLimitsByOrgId: {},
        allRoleLimitsByOrgIdByRole: {},
        modulesToDisplay: {},
      },
      dispatch: vi.fn(),
    };
    
    (useStore as any).mockReturnValue(mockStore);
    rateLimiterInstance = useRateLimiter();
  });

  describe("getApiLimitsByOrganization", () => {
    it("should fetch and transform API limits correctly", async () => {
      const mockApiResponse = {
        data: {
          users: {
            list: 100,
            get: 200,
            create: 50,
            update: 75,
            delete: 25,
          },
          dashboards: {
            list: 150,
            get: 300,
            create: 100,
          },
          alerts: {
            list: 80,
            delete: 40,
          },
        },
      };

      (rateLimiterService.getApiLimits as any).mockResolvedValue(mockApiResponse);

      const result = await rateLimiterInstance.getApiLimitsByOrganization("test-org");

      expect(rateLimiterService.getApiLimits).toHaveBeenCalledWith("test-org", "second");
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      
      // Check users module transformation
      const usersModule = result.find((module: any) => module.module_name === "users");
      expect(usersModule).toEqual({
        module_name: "users",
        list: 100,
        get: 200,
        create: 50,
        update: 75,
        delete: 25,
      });

      // Check dashboards module transformation  
      const dashboardsModule = result.find((module: any) => module.module_name === "dashboards");
      expect(dashboardsModule).toEqual({
        module_name: "dashboards",
        list: 150,
        get: 300,
        create: 100,
        update: "-",
        delete: "-",
      });

      // Check alerts module transformation
      const alertsModule = result.find((module: any) => module.module_name === "alerts");
      expect(alertsModule).toEqual({
        module_name: "alerts",
        list: 80,
        get: "-",
        create: "-",
        update: "-",
        delete: 40,
      });
    });

    it("should sort modules alphabetically by name", async () => {
      const mockApiResponse = {
        data: {
          zebra: { list: 10 },
          alpha: { get: 20 },
          beta: { create: 30 },
        },
      };

      (rateLimiterService.getApiLimits as any).mockResolvedValue(mockApiResponse);

      const result = await rateLimiterInstance.getApiLimitsByOrganization("test-org");

      expect(result[0].module_name).toBe("alpha");
      expect(result[1].module_name).toBe("beta");
      expect(result[2].module_name).toBe("zebra");
    });

    it("should handle modules with missing operations", async () => {
      const mockApiResponse = {
        data: {
          incomplete: {
            list: 50,
            // missing get, create, update, delete
          },
          empty: {
            // no operations at all
          },
        },
      };

      (rateLimiterService.getApiLimits as any).mockResolvedValue(mockApiResponse);

      const result = await rateLimiterInstance.getApiLimitsByOrganization("test-org");

      const incompleteModule = result.find((module: any) => module.module_name === "incomplete");
      expect(incompleteModule).toEqual({
        module_name: "incomplete",
        list: 50,
        get: "-",
        create: "-",
        update: "-",
        delete: "-",
      });

      const emptyModule = result.find((module: any) => module.module_name === "empty");
      expect(emptyModule).toEqual({
        module_name: "empty",
        list: "-",
        get: "-",
        create: "-",
        update: "-",
        delete: "-",
      });
    });

    it("should dispatch to store correctly", async () => {
      const mockApiResponse = {
        data: {
          test_module: { list: 100 },
        },
      };

      (rateLimiterService.getApiLimits as any).mockResolvedValue(mockApiResponse);

      await rateLimiterInstance.getApiLimitsByOrganization("test-org");

      expect(mockStore.dispatch).toHaveBeenCalledTimes(2);
      
      // Check first dispatch for API limits
      expect(mockStore.dispatch).toHaveBeenNthCalledWith(1, "setApiLimitsByOrgId", {
        "test-org_second": expect.arrayContaining([
          expect.objectContaining({
            module_name: "test_module",
          }),
        ]),
      });

      // Check second dispatch for role limits reset
      expect(mockStore.dispatch).toHaveBeenNthCalledWith(2, "setRoleLimitsByOrgIdByRole", {
        "test-org": [],
      });
    });

    it("should handle empty API response", async () => {
      const mockApiResponse = { data: {} };

      (rateLimiterService.getApiLimits as any).mockResolvedValue(mockApiResponse);

      const result = await rateLimiterInstance.getApiLimitsByOrganization("test-org");

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle API errors gracefully", async () => {
      const mockError = new Error("API Error");
      (rateLimiterService.getApiLimits as any).mockRejectedValue(mockError);

      console.log = vi.fn();

      const result = await rateLimiterInstance.getApiLimitsByOrganization("test-org");

      expect(console.log).toHaveBeenCalledWith(mockError);
      expect(result).toBeUndefined();
    });

    it("should handle different organization identifiers", async () => {
      const mockApiResponse = { data: { test: { list: 10 } } };
      (rateLimiterService.getApiLimits as any).mockResolvedValue(mockApiResponse);

      const organizations = ["org1", "company-2", "test_org_123", "12345"];

      for (const org of organizations) {
        await rateLimiterInstance.getApiLimitsByOrganization(org);
        expect(rateLimiterService.getApiLimits).toHaveBeenCalledWith(org, "second");
      }
    });

    it("should handle numeric and zero limits", async () => {
      const mockApiResponse = {
        data: {
          limits_test: {
            list: 0,
            get: -1,
            create: 999999,
          },
        },
      };

      (rateLimiterService.getApiLimits as any).mockResolvedValue(mockApiResponse);

      const result = await rateLimiterInstance.getApiLimitsByOrganization("test-org");

      const module = result.find((m: any) => m.module_name === "limits_test");
      expect(module.list).toBe(0);
      expect(module.get).toBe(-1);
      expect(module.create).toBe(999999);
    });
  });

  describe("getRoleLimitsByOrganization", () => {
    it("should fetch and transform role limits correctly", async () => {
      const mockRoleResponse = {
        data: {
          users: {
            list: 50,
            get: 100,
            create: 25,
          },
          reports: {
            list: 30,
            delete: 15,
          },
        },
      };

      (rateLimiterService.getRoleLimits as any).mockResolvedValue(mockRoleResponse);

      const result = await rateLimiterInstance.getRoleLimitsByOrganization("test-org", "admin");

      expect(rateLimiterService.getRoleLimits).toHaveBeenCalledWith("test-org", "admin", "second");
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);

      // Check users module
      const usersModule = result.find((module: any) => module.module_name === "users");
      expect(usersModule).toEqual({
        module_name: "users",
        list: 50,
        get: 100,
        create: 25,
        update: "-",
        delete: "-",
      });

      // Check reports module
      const reportsModule = result.find((module: any) => module.module_name === "reports");
      expect(reportsModule).toEqual({
        module_name: "reports",
        list: 30,
        get: "-",
        create: "-",
        update: "-",
        delete: 15,
      });
    });

    it("should sort role modules alphabetically", async () => {
      const mockRoleResponse = {
        data: {
          zzz_module: { list: 10 },
          aaa_module: { get: 20 },
          mmm_module: { create: 30 },
        },
      };

      (rateLimiterService.getRoleLimits as any).mockResolvedValue(mockRoleResponse);

      const result = await rateLimiterInstance.getRoleLimitsByOrganization("test-org", "user");

      expect(result[0].module_name).toBe("aaa_module");
      expect(result[1].module_name).toBe("mmm_module");
      expect(result[2].module_name).toBe("zzz_module");
    });

    it("should dispatch role limits to store correctly", async () => {
      const mockRoleResponse = {
        data: {
          test_module: { list: 25 },
        },
      };

      mockStore.state.allRoleLimitsByOrgIdByRole = {
        "test-org": {
          "existing-role": [{ module_name: "existing" }],
        },
      };

      (rateLimiterService.getRoleLimits as any).mockResolvedValue(mockRoleResponse);

      await rateLimiterInstance.getRoleLimitsByOrganization("test-org", "admin");

      expect(mockStore.dispatch).toHaveBeenCalledWith("setRoleLimitsByOrgIdByRole", {
        "test-org": {
          "existing-role": [{ module_name: "existing" }],
          "admin_second": expect.arrayContaining([
            expect.objectContaining({
              module_name: "test_module",
            }),
          ]),
        },
      });
    });

    it("should handle different role names", async () => {
      const mockRoleResponse = { data: { test: { list: 10 } } };
      (rateLimiterService.getRoleLimits as any).mockResolvedValue(mockRoleResponse);

      const roles = ["admin", "user", "manager", "viewer", "editor"];

      for (const role of roles) {
        await rateLimiterInstance.getRoleLimitsByOrganization("test-org", role);
        expect(rateLimiterService.getRoleLimits).toHaveBeenCalledWith("test-org", role, "second");
      }
    });

    it("should handle role limits API errors gracefully", async () => {
      const mockError = new Error("Role API Error");
      (rateLimiterService.getRoleLimits as any).mockRejectedValue(mockError);

      console.log = vi.fn();

      const result = await rateLimiterInstance.getRoleLimitsByOrganization("test-org", "admin");

      expect(console.log).toHaveBeenCalledWith(mockError);
      expect(result).toBeUndefined();
    });

    it("should handle empty role response", async () => {
      const mockRoleResponse = { data: {} };

      (rateLimiterService.getRoleLimits as any).mockResolvedValue(mockRoleResponse);

      const result = await rateLimiterInstance.getRoleLimitsByOrganization("test-org", "admin");

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it("should preserve existing role data in store", async () => {
      mockStore.state.allRoleLimitsByOrgIdByRole = {
        "test-org": {
          "role1": [{ module_name: "module1" }],
          "role2": [{ module_name: "module2" }],
        },
        "other-org": {
          "role3": [{ module_name: "module3" }],
        },
      };

      const mockRoleResponse = {
        data: {
          new_module: { list: 50 },
        },
      };

      (rateLimiterService.getRoleLimits as any).mockResolvedValue(mockRoleResponse);

      await rateLimiterInstance.getRoleLimitsByOrganization("test-org", "new-role");

      expect(mockStore.dispatch).toHaveBeenCalledWith("setRoleLimitsByOrgIdByRole", {
        "test-org": {
          "role1": [{ module_name: "module1" }],
          "role2": [{ module_name: "module2" }],
          "new-role_second": expect.any(Array),
        },
        "other-org": {
          "role3": [{ module_name: "module3" }],
        },
      });
    });
  });

  describe("getModulesToDisplay", () => {
    it("should fetch and transform modules correctly", async () => {
      const mockModulesResponse = {
        data: ["users", "dashboards", "alerts", "reports"],
      };

      (rateLimiterService.getModules as any).mockResolvedValue(mockModulesResponse);

      const result = await rateLimiterInstance.getModulesToDisplay("test-org");

      expect(rateLimiterService.getModules).toHaveBeenCalledWith("test-org");
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(4);

      // Check transformation
      expect(result).toContainEqual({ label: "users", value: "users" });
      expect(result).toContainEqual({ label: "dashboards", value: "dashboards" });
      expect(result).toContainEqual({ label: "alerts", value: "alerts" });
      expect(result).toContainEqual({ label: "reports", value: "reports" });
    });

    it("should sort modules alphabetically", async () => {
      const mockModulesResponse = {
        data: ["zebra", "alpha", "beta", "gamma"],
      };

      (rateLimiterService.getModules as any).mockResolvedValue(mockModulesResponse);

      const result = await rateLimiterInstance.getModulesToDisplay("test-org");

      expect(result[0]).toEqual({ label: "alpha", value: "alpha" });
      expect(result[1]).toEqual({ label: "beta", value: "beta" });
      expect(result[2]).toEqual({ label: "gamma", value: "gamma" });
      expect(result[3]).toEqual({ label: "zebra", value: "zebra" });
    });

    it("should dispatch modules to store correctly", async () => {
      const mockModulesResponse = {
        data: ["module1", "module2"],
      };

      mockStore.state.modulesToDisplay = {
        "existing-org": [{ label: "existing", value: "existing" }],
      };

      (rateLimiterService.getModules as any).mockResolvedValue(mockModulesResponse);

      await rateLimiterInstance.getModulesToDisplay("test-org");

      expect(mockStore.dispatch).toHaveBeenCalledWith("setModulesToDisplay", {
        "existing-org": [{ label: "existing", value: "existing" }],
        "test-org": [
          { label: "module1", value: "module1" },
          { label: "module2", value: "module2" },
        ],
      });
    });

    it("should handle empty modules response", async () => {
      const mockModulesResponse = { data: [] };

      (rateLimiterService.getModules as any).mockResolvedValue(mockModulesResponse);

      const result = await rateLimiterInstance.getModulesToDisplay("test-org");

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle modules API errors gracefully", async () => {
      const mockError = new Error("Modules API Error");
      (rateLimiterService.getModules as any).mockRejectedValue(mockError);

      const result = await rateLimiterInstance.getModulesToDisplay("test-org");

      expect(result).toBeUndefined();
    });

    it("should handle different organization identifiers", async () => {
      const mockModulesResponse = { data: ["test-module"] };
      (rateLimiterService.getModules as any).mockResolvedValue(mockModulesResponse);

      const organizations = ["org-1", "company_2", "test.org", "12345"];

      for (const org of organizations) {
        await rateLimiterInstance.getModulesToDisplay(org);
        expect(rateLimiterService.getModules).toHaveBeenCalledWith(org);
      }
    });

    it("should handle modules with special characters", async () => {
      const mockModulesResponse = {
        data: ["module_with_underscores", "module-with-dashes", "module.with.dots"],
      };

      (rateLimiterService.getModules as any).mockResolvedValue(mockModulesResponse);

      const result = await rateLimiterInstance.getModulesToDisplay("test-org");

      expect(result).toContainEqual({ label: "module_with_underscores", value: "module_with_underscores" });
      expect(result).toContainEqual({ label: "module-with-dashes", value: "module-with-dashes" });
      expect(result).toContainEqual({ label: "module.with.dots", value: "module.with.dots" });
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow for organization setup", async () => {
      const orgId = "integration-org";

      // Mock all service calls
      const mockApiResponse = { data: { users: { list: 100 } } };
      const mockRoleResponse = { data: { users: { get: 50 } } };
      const mockModulesResponse = { data: ["users", "alerts"] };

      (rateLimiterService.getApiLimits as any).mockResolvedValue(mockApiResponse);
      (rateLimiterService.getRoleLimits as any).mockResolvedValue(mockRoleResponse);
      (rateLimiterService.getModules as any).mockResolvedValue(mockModulesResponse);

      // Execute workflow
      const apiLimits = await rateLimiterInstance.getApiLimitsByOrganization(orgId);
      const roleLimits = await rateLimiterInstance.getRoleLimitsByOrganization(orgId, "admin");
      const modules = await rateLimiterInstance.getModulesToDisplay(orgId);

      // Verify results
      expect(apiLimits).toBeDefined();
      expect(roleLimits).toBeDefined();
      expect(modules).toBeDefined();

      // Verify service calls
      expect(rateLimiterService.getApiLimits).toHaveBeenCalledWith(orgId, "second");
      expect(rateLimiterService.getRoleLimits).toHaveBeenCalledWith(orgId, "admin", "second");
      expect(rateLimiterService.getModules).toHaveBeenCalledWith(orgId);

      // Verify store dispatches
      expect(mockStore.dispatch).toHaveBeenCalledTimes(4); // 2 for API limits, 1 for role limits, 1 for modules
    });

    it("should handle error scenarios gracefully", async () => {
      const orgId = "error-org";

      // Mock errors
      (rateLimiterService.getApiLimits as any).mockRejectedValue(new Error("API Error"));
      (rateLimiterService.getRoleLimits as any).mockRejectedValue(new Error("Role Error"));
      (rateLimiterService.getModules as any).mockRejectedValue(new Error("Modules Error"));

      console.log = vi.fn();

      // Execute calls
      const apiLimits = await rateLimiterInstance.getApiLimitsByOrganization(orgId);
      const roleLimits = await rateLimiterInstance.getRoleLimitsByOrganization(orgId, "admin");
      const modules = await rateLimiterInstance.getModulesToDisplay(orgId);

      // Verify error handling
      expect(apiLimits).toBeUndefined();
      expect(roleLimits).toBeUndefined();
      expect(modules).toBeUndefined();
      expect(console.log).toHaveBeenCalledTimes(2);
    });

    it("should maintain consistent data transformation across all methods", async () => {
      const commonData = {
        users: { list: 100, get: 200 },
        alerts: { create: 50, delete: 25 },
      };

      (rateLimiterService.getApiLimits as any).mockResolvedValue({ data: commonData });
      (rateLimiterService.getRoleLimits as any).mockResolvedValue({ data: commonData });

      const apiResult = await rateLimiterInstance.getApiLimitsByOrganization("test-org");
      const roleResult = await rateLimiterInstance.getRoleLimitsByOrganization("test-org", "admin");

      // Both should have same structure and sorting
      expect(apiResult.map((m: any) => m.module_name)).toEqual(roleResult.map((m: any) => m.module_name));
      expect(apiResult[0].module_name).toBe("alerts");
      expect(apiResult[1].module_name).toBe("users");
    });
  });
});