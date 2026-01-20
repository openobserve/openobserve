import { describe, it, expect, beforeEach, vi } from "vitest";
import useEnterpriseRoutes from "./useEnterpriseRoutes";
import store from "@/test/unit/helpers/store";

// Mock the config module with mutable reference
vi.mock("@/aws-exports", () => {
  const config = {
    aws_mobile_analytics_app_id: "ab7e9321f83c45a8967ff3b9bd90e83a",
    aws_mobile_analytics_app_region: "us-west-2",
    openReplayKey: undefined,
    sentryDSN: undefined,
    zincQuotaThreshold: undefined,
    enableAnalytics: undefined,
    isCloud: "false",
    isEnterprise: "false",
    freePlan: "free",
    paidPlan: "pay-as-you-go",
    enterprisePlan: "enterprise",
    ooApplicationID: undefined,
    ooClientToken: undefined,
    ooSite: undefined,
    ooService: undefined,
    ooOrgIdentifier: undefined,
    environment: undefined,
    ddAPPID: undefined,
    ddClientToken: undefined,
    ddSite: undefined,
  };

  return {
    default: config,
  };
});

// Mock routeGuard
vi.mock("@/utils/zincutils", () => ({
  routeGuard: vi.fn((to, from, next) => next()),
}));

// Mock all component imports
vi.mock("@/views/IdentityAccessManagement.vue", () => ({
  default: vi.fn(() => ({ name: "IdentityAccessManagement" })),
}));

vi.mock("@/components/iam/serviceAccounts/ServiceAccountsList.vue", () => ({
  default: vi.fn(() => ({ name: "ServiceAccountsList" })),
}));

vi.mock("@/components/iam/groups/AppGroups.vue", () => ({
  default: vi.fn(() => ({ name: "AppGroups" })),
}));

vi.mock("@/components/iam/roles/AppRoles.vue", () => ({
  default: vi.fn(() => ({ name: "AppRoles" })),
}));

vi.mock("@/components/iam/roles/EditRole.vue", () => ({
  default: vi.fn(() => ({ name: "EditRole" })),
}));

vi.mock("@/components/iam/groups/EditGroup.vue", () => ({
  default: vi.fn(() => ({ name: "EditGroup" })),
}));

vi.mock("@/components/iam/quota/Quota.vue", () => ({
  default: vi.fn(() => ({ name: "Quota" })),
}));

vi.mock("@/components/iam/organizations/AppOrganizations.vue", () => ({
  default: vi.fn(() => ({ name: "AppOrganizations" })),
}));

vi.mock("@/components/actionScripts/ActionScripts.vue", () => ({
  default: vi.fn(() => ({ name: "ActionScripts" })),
}));

vi.mock("@/views/User.vue", () => ({
  default: vi.fn(() => ({ name: "Users" })),
}));

describe("useEnterpriseRoutes.ts", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset config to default state
    const config = await import("@/aws-exports");
    config.default.isCloud = "false";
    config.default.isEnterprise = "false";
  });

  describe("Basic Functionality", () => {
    // Test 1: Should return routes array
    it("should return routes array", () => {
      const routes = useEnterpriseRoutes();
      expect(routes).toBeInstanceOf(Array);
    });

    // Test 2: Should return non-empty array
    it("should return non-empty array", () => {
      const routes = useEnterpriseRoutes();
      expect(routes.length).toBeGreaterThan(0);
    });

    // Test 3: Should be a function
    it("should be a function", () => {
      expect(typeof useEnterpriseRoutes).toBe("function");
    });

    // Test 4: Should not require parameters
    it("should not require parameters", () => {
      expect(useEnterpriseRoutes.length).toBe(0);
    });

    // Test 5: Should return same structure on multiple calls
    it("should return consistent structure on multiple calls", () => {
      const routes1 = useEnterpriseRoutes();
      const routes2 = useEnterpriseRoutes();

      // Compare structure without function instances
      expect(routes1.length).toBe(routes2.length);
      expect(routes1.map((r) => ({ path: r.path, name: r.name }))).toEqual(
        routes2.map((r) => ({ path: r.path, name: r.name })),
      );
    });
  });

  describe("Basic Routes (OSS)", () => {
    // Test 6: Should include iam route
    it("should include iam route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      expect(iamRoute).toBeDefined();
    });

    // Test 7: Should have correct iam route path
    it("should have correct iam route path", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      expect(iamRoute.path).toBe("iam");
    });

    // Test 8: Should have iam route component
    it("should have iam route component", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      expect(iamRoute.component).toBeDefined();
    });

    // Test 9: Should have iam route beforeEnter guard
    it("should have iam route beforeEnter guard", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      expect(typeof iamRoute.beforeEnter).toBe("function");
    });

    // Test 10: Should have iam children array
    it("should have iam children array", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      expect(iamRoute.children).toBeInstanceOf(Array);
    });

    // Test 11: Should include users child route
    it("should include users child route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const usersRoute = iamRoute.children.find(
        (child: any) => child.name === "users",
      );
      expect(usersRoute).toBeDefined();
    });

    // Test 12: Should have correct users route path
    it("should have correct users route path", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const usersRoute = iamRoute.children.find(
        (child: any) => child.name === "users",
      );
      expect(usersRoute.path).toBe("users");
    });

    // Test 13: Should have users route component
    it("should have users route component", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const usersRoute = iamRoute.children.find(
        (child: any) => child.name === "users",
      );
      expect(usersRoute.component).toBeDefined();
    });

    // Test 14: Should have users route beforeEnter guard
    it("should have users route beforeEnter guard", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const usersRoute = iamRoute.children.find(
        (child: any) => child.name === "users",
      );
      expect(typeof usersRoute.beforeEnter).toBe("function");
    });

    // Test 15: Should include serviceAccounts child route
    it("should include serviceAccounts child route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const serviceAccountsRoute = iamRoute.children.find(
        (child: any) => child.name === "serviceAccounts",
      );
      expect(serviceAccountsRoute).toBeDefined();
    });

    // Test 16: Should have correct serviceAccounts route path
    it("should have correct serviceAccounts route path", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const serviceAccountsRoute = iamRoute.children.find(
        (child: any) => child.name === "serviceAccounts",
      );
      expect(serviceAccountsRoute.path).toBe("serviceAccounts");
    });

    // Test 17: Should include organizations child route
    it("should include organizations child route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const organizationsRoute = iamRoute.children.find(
        (child: any) => child.name === "organizations",
      );
      expect(organizationsRoute).toBeDefined();
    });

    // Test 18: Should have correct organizations route path
    it("should have correct organizations route path", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const organizationsRoute = iamRoute.children.find(
        (child: any) => child.name === "organizations",
      );
      expect(organizationsRoute.path).toBe("organizations");
    });

    // Test 19: Should have 3 children in basic configuration
    it("should have 3 children in basic configuration", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      expect(iamRoute.children.length).toBe(3);
    });

    // Test 20: Should have only 1 route in basic configuration
    it("should have only 1 route in basic configuration", () => {
      const routes = useEnterpriseRoutes();
      expect(routes.length).toBe(1);
    });
  });

  describe("Cloud Configuration", () => {
    beforeEach(async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = "true";
      config.default.isEnterprise = "false";
    });

    // Test 21: Should add actions route when isCloud is true
    it("should add actions route when isCloud is true", () => {
      const routes = useEnterpriseRoutes();
      const actionsRoute = routes.find(
        (route: any) => route.name === "actionScripts",
      );
      expect(actionsRoute).toBeDefined();
    });

    // Test 22: Should have correct actions route path
    it("should have correct actions route path", () => {
      const routes = useEnterpriseRoutes();
      const actionsRoute = routes.find(
        (route: any) => route.name === "actionScripts",
      );
      expect(actionsRoute.path).toBe("actions");
    });

    // Test 23: Should have actions route component
    it("should have actions route component", () => {
      const routes = useEnterpriseRoutes();
      const actionsRoute = routes.find(
        (route: any) => route.name === "actionScripts",
      );
      expect(actionsRoute.component).toBeDefined();
    });

    // Test 24: Should have actions route beforeEnter guard
    it("should have actions route beforeEnter guard", () => {
      const routes = useEnterpriseRoutes();
      const actionsRoute = routes.find(
        (route: any) => route.name === "actionScripts",
      );
      expect(typeof actionsRoute.beforeEnter).toBe("function");
    });

    // Test 25: Should add groups child route
    it("should add groups child route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const groupsRoute = iamRoute.children.find(
        (child: any) => child.name === "groups",
      );
      expect(groupsRoute).toBeDefined();
    });

    // Test 26: Should have correct groups route path
    it("should have correct groups route path", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const groupsRoute = iamRoute.children.find(
        (child: any) => child.name === "groups",
      );
      expect(groupsRoute.path).toBe("groups");
    });

    // Test 27: Should add editGroup child route
    it("should add editGroup child route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const editGroupRoute = iamRoute.children.find(
        (child: any) => child.name === "editGroup",
      );
      expect(editGroupRoute).toBeDefined();
    });

    // Test 28: Should have correct editGroup route path
    it("should have correct editGroup route path", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const editGroupRoute = iamRoute.children.find(
        (child: any) => child.name === "editGroup",
      );
      expect(editGroupRoute.path).toBe("groups/edit/:group_name");
    });

    // Test 29: Should add roles child route
    it("should add roles child route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const rolesRoute = iamRoute.children.find(
        (child: any) => child.name === "roles",
      );
      expect(rolesRoute).toBeDefined();
    });

    // Test 30: Should add editRole child route
    it("should add editRole child route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const editRoleRoute = iamRoute.children.find(
        (child: any) => child.name === "editRole",
      );
      expect(editRoleRoute).toBeDefined();
    });

    // Test 31: Should have correct editRole route path
    it("should have correct editRole route path", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const editRoleRoute = iamRoute.children.find(
        (child: any) => child.name === "editRole",
      );
      expect(editRoleRoute.path).toBe("roles/edit/:role_name");
    });

    // Test 32: Should add quota child route
    it("should add quota child route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const quotaRoute = iamRoute.children.find(
        (child: any) => child.name === "quota",
      );
      expect(quotaRoute).toBeDefined();
    });

    // Test 33: Should have 9 children in cloud configuration
    it("should have 9 children in cloud configuration", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      expect(iamRoute.children.length).toBe(9);
    });

    // Test 34: Should have 4 routes in cloud configuration (iam + 2 incident routes + actions)
    it("should have 4 routes in cloud configuration", () => {
      const routes = useEnterpriseRoutes();
      expect(routes.length).toBe(4);
    });
  });

  describe("Enterprise Configuration", () => {
    beforeEach(async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = "false";
      config.default.isEnterprise = "true";
    });

    // Test 35: Should add actions route when isEnterprise is true
    it("should add actions route when isEnterprise is true", () => {
      const routes = useEnterpriseRoutes();
      const actionsRoute = routes.find(
        (route: any) => route.name === "actionScripts",
      );
      expect(actionsRoute).toBeDefined();
    });

    // Test 36: Should add enterprise IAM routes
    it("should add enterprise IAM routes", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      expect(iamRoute.children.length).toBe(8);
    });

    // Test 37: Should have enterprise routes structure (iam + 2 incident routes + actions)
    it("should have enterprise routes structure", () => {
      const routes = useEnterpriseRoutes();
      expect(routes.length).toBe(4);
    });
  });

  describe("Both Cloud and Enterprise Configuration", () => {
    beforeEach(async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = "true";
      config.default.isEnterprise = "true";
    });

    // Test 38: Should add all routes when both flags are true (iam + 2 incident routes + actions)
    it("should add all routes when both flags are true", () => {
      const routes = useEnterpriseRoutes();
      expect(routes.length).toBe(4);
    });

    // Test 39: Should have all IAM children when both flags are true
    it("should have all IAM children when both flags are true", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      expect(iamRoute.children.length).toBe(9);
    });
  });

  describe("Route Guard Functionality", () => {
    // Test 40: Should call routeGuard for iam route
    it("should call routeGuard for iam route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();

      iamRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    // Test 41: Should call routeGuard for users route
    it("should call routeGuard for users route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const usersRoute = iamRoute.children.find(
        (child: any) => child.name === "users",
      );

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();

      usersRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    // Test 42: Should call routeGuard for serviceAccounts route
    it("should call routeGuard for serviceAccounts route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const serviceAccountsRoute = iamRoute.children.find(
        (child: any) => child.name === "serviceAccounts",
      );

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();

      serviceAccountsRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    // Test 43: Should call routeGuard for organizations route
    it("should call routeGuard for organizations route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const organizationsRoute = iamRoute.children.find(
        (child: any) => child.name === "organizations",
      );

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();

      organizationsRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });
  });

  describe("Cloud/Enterprise Route Guards", () => {
    beforeEach(async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = "true";
      config.default.isEnterprise = "false";
    });

    // Test 44: Should call routeGuard for actions route
    it("should call routeGuard for actions route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const routes = useEnterpriseRoutes();
      const actionsRoute = routes.find(
        (route: any) => route.name === "actionScripts",
      );

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();

      actionsRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    // Test 45: Should call routeGuard for groups route
    it("should call routeGuard for groups route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const groupsRoute = iamRoute.children.find(
        (child: any) => child.name === "groups",
      );

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();

      groupsRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    // Test 46: Should call routeGuard for editGroup route
    it("should call routeGuard for editGroup route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const editGroupRoute = iamRoute.children.find(
        (child: any) => child.name === "editGroup",
      );

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();

      editGroupRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    // Test 47: Should call routeGuard for roles route
    it("should call routeGuard for roles route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const rolesRoute = iamRoute.children.find(
        (child: any) => child.name === "roles",
      );

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();

      rolesRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    // Test 48: Should call routeGuard for editRole route
    it("should call routeGuard for editRole route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const editRoleRoute = iamRoute.children.find(
        (child: any) => child.name === "editRole",
      );

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();

      editRoleRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });

    // Test 49: Should call routeGuard for quota route
    it("should call routeGuard for quota route", async () => {
      const { routeGuard } = await import("@/utils/zincutils");
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const quotaRoute = iamRoute.children.find(
        (child: any) => child.name === "quota",
      );

      const mockTo = {};
      const mockFrom = {};
      const mockNext = vi.fn();

      quotaRoute.beforeEnter(mockTo, mockFrom, mockNext);
      expect(routeGuard).toHaveBeenCalledWith(mockTo, mockFrom, mockNext);
    });
  });

  describe("Route Structure Validation", () => {
    // Test 50: Should have valid route structure for all basic routes
    it("should have valid route structure for all basic routes", () => {
      const routes = useEnterpriseRoutes();
      routes.forEach((route: any) => {
        expect(route).toHaveProperty("path");
        expect(route).toHaveProperty("name");
        expect(route).toHaveProperty("component");
        expect(route).toHaveProperty("beforeEnter");
        expect(typeof route.path).toBe("string");
        expect(typeof route.name).toBe("string");
        expect(typeof route.beforeEnter).toBe("function");
      });
    });

    // Test 51: Should have valid route structure for all iam children
    it("should have valid route structure for all iam children", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      iamRoute.children.forEach((child: any) => {
        expect(child).toHaveProperty("path");
        expect(child).toHaveProperty("name");
        expect(child).toHaveProperty("component");
        expect(child).toHaveProperty("beforeEnter");
        expect(typeof child.path).toBe("string");
        expect(typeof child.name).toBe("string");
        expect(typeof child.beforeEnter).toBe("function");
      });
    });
  });

  describe("Component Imports", () => {
    // Test 52: Should have component function for iam route
    it("should have component function for iam route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      expect(typeof iamRoute.component).toBe("function");
    });

    // Test 53: Should have component for users route
    it("should have component for users route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const usersRoute = iamRoute.children.find(
        (child: any) => child.name === "users",
      );
      expect(usersRoute.component).toBeDefined();
    });

    // Test 54: Should have component for serviceAccounts route
    it("should have component for serviceAccounts route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const serviceAccountsRoute = iamRoute.children.find(
        (child: any) => child.name === "serviceAccounts",
      );
      expect(serviceAccountsRoute.component).toBeDefined();
    });

    // Test 55: Should have component for organizations route
    it("should have component for organizations route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const organizationsRoute = iamRoute.children.find(
        (child: any) => child.name === "organizations",
      );
      expect(organizationsRoute.component).toBeDefined();
    });
  });

  describe("Cloud/Enterprise Component Imports", () => {
    beforeEach(async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = "true";
      config.default.isEnterprise = "false";
    });

    // Test 56: Should have component for actions route
    it("should have component for actions route", () => {
      const routes = useEnterpriseRoutes();
      const actionsRoute = routes.find(
        (route: any) => route.name === "actionScripts",
      );
      expect(typeof actionsRoute.component).toBe("function");
    });

    // Test 57: Should have component for groups route
    it("should have component for groups route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const groupsRoute = iamRoute.children.find(
        (child: any) => child.name === "groups",
      );
      expect(typeof groupsRoute.component).toBe("function");
    });

    // Test 58: Should have component for editGroup route
    it("should have component for editGroup route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const editGroupRoute = iamRoute.children.find(
        (child: any) => child.name === "editGroup",
      );
      expect(typeof editGroupRoute.component).toBe("function");
    });

    // Test 59: Should have component for roles route
    it("should have component for roles route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const rolesRoute = iamRoute.children.find(
        (child: any) => child.name === "roles",
      );
      expect(typeof rolesRoute.component).toBe("function");
    });

    // Test 60: Should have component for editRole route
    it("should have component for editRole route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const editRoleRoute = iamRoute.children.find(
        (child: any) => child.name === "editRole",
      );
      expect(typeof editRoleRoute.component).toBe("function");
    });

    // Test 61: Should have component for quota route
    it("should have component for quota route", () => {
      const routes = useEnterpriseRoutes();
      const iamRoute = routes.find((route: any) => route.name === "iam");
      const quotaRoute = iamRoute.children.find(
        (child: any) => child.name === "quota",
      );
      expect(typeof quotaRoute.component).toBe("function");
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    // Test 62: Should handle config with undefined values
    it("should handle config with undefined values", async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = undefined;
      config.default.isEnterprise = undefined;

      const routes = useEnterpriseRoutes();
      expect(routes.length).toBe(1); // Should fallback to basic routes only
    });

    // Test 63: Should handle config with null values
    it("should handle config with null values", async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = null;
      config.default.isEnterprise = null;

      const routes = useEnterpriseRoutes();
      expect(routes.length).toBe(1); // Should fallback to basic routes only
    });

    // Test 64: Should handle config with non-string values
    it("should handle config with non-string values", async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = true;
      config.default.isEnterprise = false;

      const routes = useEnterpriseRoutes();
      expect(routes.length).toBe(1); // Should only add routes when string "true"
    });

    // Test 65: Should handle config with empty string values
    it("should handle config with empty string values", async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = "";
      config.default.isEnterprise = "";

      const routes = useEnterpriseRoutes();
      expect(routes.length).toBe(1); // Should fallback to basic routes only
    });

    // Test 66: Should handle mixed string cases
    it("should handle mixed string cases", async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = "True";
      config.default.isEnterprise = "TRUE";

      const routes = useEnterpriseRoutes();
      expect(routes.length).toBe(1); // Should be case sensitive, only "true" should work
    });

    // Test 67: Should maintain iam route as first element
    it("should maintain iam route as first element", async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = "true";
      config.default.isEnterprise = "true";

      const routes = useEnterpriseRoutes();
      expect(routes[0].name).toBe("iam");
    });

    // Test 68: Should properly add children routes without mutating original
    it("should properly add children routes without mutating original", async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = "false";
      config.default.isEnterprise = "false";

      const routes1 = useEnterpriseRoutes();
      const originalChildrenCount = routes1[0].children.length;

      config.default.isCloud = "true";
      const routes2 = useEnterpriseRoutes();
      const newChildrenCount = routes2[0].children.length;

      expect(newChildrenCount).toBeGreaterThan(originalChildrenCount);
    });

    // Test 69: Should not add duplicate routes when called multiple times
    it("should not add duplicate routes when called multiple times", async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = "true";
      config.default.isEnterprise = "true";

      const routes1 = useEnterpriseRoutes();
      const routes2 = useEnterpriseRoutes();

      expect(routes1.length).toBe(routes2.length);
      expect(routes1[0].children.length).toBe(routes2[0].children.length);
    });

    // Test 70: Should handle route name uniqueness
    it("should handle route name uniqueness", async () => {
      const config = await import("@/aws-exports");
      config.default.isCloud = "true";
      config.default.isEnterprise = "true";

      const routes = useEnterpriseRoutes();
      const allRouteNames = routes.map((route: any) => route.name);
      const allChildNames = routes[0].children.map((child: any) => child.name);
      const allNames = [...allRouteNames, ...allChildNames];

      const uniqueNames = [...new Set(allNames)];
      expect(uniqueNames.length).toBe(allNames.length); // No duplicates
    });
  });
});
