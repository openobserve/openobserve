import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getGroups,
  getGroup,
  deleteGroup,
  createGroup,
  updateGroup,
  getRoles,
  getRole,
  deleteRole,
  createRole,
  updateRole,
  getResources,
  getRoleUsers,
  getResourcePermission,
} from "./iam";

// Mock http service
vi.mock("./http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}));

import http from "./http";

describe("IAM Service", () => {
  let mockHttp: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp = {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    };
    (http as any).mockReturnValue(mockHttp);
  });

  describe("Groups", () => {
    describe("getGroups", () => {
      it("should get groups with correct URL", async () => {
        await getGroups("test-org");

        expect(mockHttp.get).toHaveBeenCalledWith("/api/test-org/groups");
      });

      it("should handle different organization identifiers", async () => {
        const organizations = [
          "simple-org",
          "org-with-dashes",
          "org_with_underscores",
          "production.environment",
          "12345",
          "ORG-UPPERCASE",
        ];

        for (const org of organizations) {
          await getGroups(org);
          expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/groups`);
        }

        expect(mockHttp.get).toHaveBeenCalledTimes(organizations.length);
      });

      it("should handle empty organization string", async () => {
        await getGroups("");

        expect(mockHttp.get).toHaveBeenCalledWith("/api//groups");
      });

      it("should handle organization with special characters", async () => {
        const specialOrgs = [
          "org@domain.com",
          "org#hash",
          "org$dollar",
          "org%percent",
        ];

        for (const org of specialOrgs) {
          await getGroups(org);
          expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/groups`);
        }
      });
    });

    describe("getGroup", () => {
      it("should get specific group with correct URL", async () => {
        await getGroup("admin-group", "test-org");

        expect(mockHttp.get).toHaveBeenCalledWith("/api/test-org/groups/admin-group");
      });

      it("should handle different group name formats", async () => {
        const groupNames = [
          "simple-group",
          "group_with_underscores",
          "GROUP-UPPERCASE",
          "group.with.dots",
          "123456",
          "special@group",
        ];

        for (const groupName of groupNames) {
          await getGroup(groupName, "test-org");
          expect(mockHttp.get).toHaveBeenCalledWith(`/api/test-org/groups/${groupName}`);
        }
      });

      it("should handle different organizations", async () => {
        const testCases = [
          { group: "admin", org: "org1" },
          { group: "users", org: "production-env" },
          { group: "viewers", org: "dev" },
          { group: "managers", org: "test_org" },
        ];

        for (const { group, org } of testCases) {
          await getGroup(group, org);
          expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/groups/${group}`);
        }
      });

      it("should handle empty parameters", async () => {
        await getGroup("", "");

        expect(mockHttp.get).toHaveBeenCalledWith("/api//groups/");
      });
    });

    describe("deleteGroup", () => {
      it("should delete group with correct URL", async () => {
        await deleteGroup("admin-group", "test-org");

        expect(mockHttp.delete).toHaveBeenCalledWith("/api/test-org/groups/admin-group");
      });

      it("should handle different group names for deletion", async () => {
        const groupNames = [
          "temporary-group",
          "old_group",
          "DEPRECATED_GROUP",
          "group.to.delete",
          "123-old",
        ];

        for (const groupName of groupNames) {
          await deleteGroup(groupName, "test-org");
          expect(mockHttp.delete).toHaveBeenCalledWith(`/api/test-org/groups/${groupName}`);
        }
      });

      it("should handle different organizations for deletion", async () => {
        const organizations = [
          "cleanup-org",
          "maintenance-org", 
          "archived_org",
          "test.environment",
        ];

        for (const org of organizations) {
          await deleteGroup("target-group", org);
          expect(mockHttp.delete).toHaveBeenCalledWith(`/api/${org}/groups/target-group`);
        }
      });
    });

    describe("createGroup", () => {
      it("should create group with correct URL and default payload", async () => {
        await createGroup("new-group", "test-org");

        expect(mockHttp.post).toHaveBeenCalledWith("/api/test-org/groups", {
          name: "new-group",
          users: [],
          roles: [],
        });
      });

      it("should handle different group names for creation", async () => {
        const groupNames = [
          "analytics-team",
          "dev_team",
          "ADMIN_GROUP",
          "group.with.dots",
          "special@group#1",
        ];

        for (const groupName of groupNames) {
          await createGroup(groupName, "test-org");
          expect(mockHttp.post).toHaveBeenCalledWith("/api/test-org/groups", {
            name: groupName,
            users: [],
            roles: [],
          });
        }
      });

      it("should handle different organizations for group creation", async () => {
        const organizations = [
          "new-org",
          "startup-company",
          "enterprise_client",
          "test.environment",
        ];

        for (const org of organizations) {
          await createGroup("standard-group", org);
          expect(mockHttp.post).toHaveBeenCalledWith(`/api/${org}/groups`, {
            name: "standard-group",
            users: [],
            roles: [],
          });
        }
      });

      it("should always create groups with empty users and roles arrays", async () => {
        const testCases = [
          { group: "empty-group-1", org: "org1" },
          { group: "empty-group-2", org: "org2" },
          { group: "empty-group-3", org: "org3" },
        ];

        for (const { group, org } of testCases) {
          await createGroup(group, org);
          expect(mockHttp.post).toHaveBeenCalledWith(`/api/${org}/groups`, {
            name: group,
            users: [],
            roles: [],
          });
        }
      });
    });

    describe("updateGroup", () => {
      it("should update group with correct URL and payload", async () => {
        const updateData = {
          group_name: "admin-group",
          org_identifier: "test-org",
          payload: {
            add_roles: ["admin", "manager"],
            remove_roles: ["viewer"],
            add_users: ["user1@example.com", "user2@example.com"],
            remove_users: ["old-user@example.com"],
          },
        };

        await updateGroup(updateData);

        expect(mockHttp.put).toHaveBeenCalledWith(
          "/api/test-org/groups/admin-group",
          updateData.payload
        );
      });

      it("should handle different update scenarios", async () => {
        const updateScenarios = [
          {
            group_name: "dev-team",
            org_identifier: "development",
            payload: {
              add_roles: ["developer"],
              remove_roles: [],
              add_users: ["newdev@company.com"],
              remove_users: [],
            },
          },
          {
            group_name: "managers",
            org_identifier: "corporate", 
            payload: {
              add_roles: [],
              remove_roles: ["temporary"],
              add_users: [],
              remove_users: ["exmanager@company.com"],
            },
          },
          {
            group_name: "analysts",
            org_identifier: "analytics",
            payload: {
              add_roles: ["data-analyst", "report-viewer"],
              remove_roles: ["admin"],
              add_users: ["analyst1@company.com", "analyst2@company.com"],
              remove_users: ["oldanalyst@company.com"],
            },
          },
        ];

        for (const scenario of updateScenarios) {
          await updateGroup(scenario);
          expect(mockHttp.put).toHaveBeenCalledWith(
            `/api/${scenario.org_identifier}/groups/${scenario.group_name}`,
            scenario.payload
          );
        }
      });

      it("should handle empty arrays in payload", async () => {
        const emptyUpdateData = {
          group_name: "test-group",
          org_identifier: "test-org",
          payload: {
            add_roles: [],
            remove_roles: [],
            add_users: [],
            remove_users: [],
          },
        };

        await updateGroup(emptyUpdateData);

        expect(mockHttp.put).toHaveBeenCalledWith(
          "/api/test-org/groups/test-group",
          emptyUpdateData.payload
        );
      });

      it("should handle large user and role lists", async () => {
        const largeUpdateData = {
          group_name: "large-group",
          org_identifier: "enterprise",
          payload: {
            add_roles: Array.from({ length: 20 }, (_, i) => `role-${i + 1}`),
            remove_roles: Array.from({ length: 10 }, (_, i) => `old-role-${i + 1}`),
            add_users: Array.from({ length: 50 }, (_, i) => `user${i + 1}@company.com`),
            remove_users: Array.from({ length: 25 }, (_, i) => `olduser${i + 1}@company.com`),
          },
        };

        await updateGroup(largeUpdateData);

        expect(mockHttp.put).toHaveBeenCalledWith(
          "/api/enterprise/groups/large-group",
          largeUpdateData.payload
        );
      });
    });
  });

  describe("Roles", () => {
    describe("getRoles", () => {
      it("should get roles with correct URL", async () => {
        await getRoles("test-org");

        expect(mockHttp.get).toHaveBeenCalledWith("/api/test-org/roles");
      });

      it("should handle different organization identifiers", async () => {
        const organizations = [
          "simple-org",
          "org-with-dashes",
          "org_with_underscores",
          "production.environment",
          "12345",
        ];

        for (const org of organizations) {
          await getRoles(org);
          expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/roles`);
        }
      });
    });

    describe("getRole", () => {
      it("should get specific role with correct URL", async () => {
        await getRole("admin-role", "test-org");

        expect(mockHttp.get).toHaveBeenCalledWith("/api/test-org/roles/admin-role");
      });

      it("should handle different role ID formats", async () => {
        const roleIds = [
          "admin",
          "user-role",
          "MANAGER_ROLE",
          "role.with.dots",
          "123456",
          "special@role",
        ];

        for (const roleId of roleIds) {
          await getRole(roleId, "test-org");
          expect(mockHttp.get).toHaveBeenCalledWith(`/api/test-org/roles/${roleId}`);
        }
      });
    });

    describe("deleteRole", () => {
      it("should delete role with correct URL", async () => {
        await deleteRole("admin-role", "test-org");

        expect(mockHttp.delete).toHaveBeenCalledWith("/api/test-org/roles/admin-role");
      });

      it("should handle different role deletions", async () => {
        const rolesToDelete = [
          { roleId: "deprecated-role", org: "cleanup-org" },
          { roleId: "temporary_role", org: "test-environment" },
          { roleId: "OLD-ROLE", org: "maintenance" },
        ];

        for (const { roleId, org } of rolesToDelete) {
          await deleteRole(roleId, org);
          expect(mockHttp.delete).toHaveBeenCalledWith(`/api/${org}/roles/${roleId}`);
        }
      });
    });

    describe("createRole", () => {
      it("should create role with correct URL and payload", async () => {
        await createRole("new-role", "test-org");

        expect(mockHttp.post).toHaveBeenCalledWith("/api/test-org/roles", {
          role: "new-role",
        });
      });

      it("should handle different role names for creation", async () => {
        const roleNames = [
          "data-analyst",
          "system_admin",
          "SECURITY_OFFICER",
          "role.with.dots",
          "support@role",
        ];

        for (const roleName of roleNames) {
          await createRole(roleName, "test-org");
          expect(mockHttp.post).toHaveBeenCalledWith("/api/test-org/roles", {
            role: roleName,
          });
        }
      });

      it("should handle different organizations for role creation", async () => {
        const organizations = [
          "new-company",
          "startup_org",
          "enterprise-client",
          "test.environment",
        ];

        for (const org of organizations) {
          await createRole("standard-role", org);
          expect(mockHttp.post).toHaveBeenCalledWith(`/api/${org}/roles`, {
            role: "standard-role",
          });
        }
      });
    });

    describe("updateRole", () => {
      it("should update role with correct URL and payload", async () => {
        const updateData = {
          role_id: "admin-role",
          org_identifier: "test-org",
          payload: {
            permissions: ["read", "write", "delete"],
            description: "Administrator role with full access",
          },
        };

        await updateRole(updateData);

        expect(mockHttp.put).toHaveBeenCalledWith(
          "/api/test-org/roles/admin-role",
          updateData.payload
        );
      });

      it("should handle different role update scenarios", async () => {
        const updateScenarios = [
          {
            role_id: "viewer",
            org_identifier: "company-a",
            payload: {
              permissions: ["read"],
              description: "Read-only access",
            },
          },
          {
            role_id: "editor",
            org_identifier: "company-b",
            payload: {
              permissions: ["read", "write"],
              description: "Read and write access",
              settings: {
                can_export: true,
                can_share: false,
              },
            },
          },
          {
            role_id: "manager",
            org_identifier: "enterprise",
            payload: {
              permissions: ["read", "write", "manage"],
              description: "Management role",
              constraints: {
                max_users: 50,
                allowed_resources: ["dashboards", "alerts", "reports"],
              },
            },
          },
        ];

        for (const scenario of updateScenarios) {
          await updateRole(scenario);
          expect(mockHttp.put).toHaveBeenCalledWith(
            `/api/${scenario.org_identifier}/roles/${scenario.role_id}`,
            scenario.payload
          );
        }
      });
    });

    describe("getRoleUsers", () => {
      it("should get role users with correct URL", async () => {
        await getRoleUsers("admin-role", "test-org");

        expect(mockHttp.get).toHaveBeenCalledWith("/api/test-org/roles/admin-role/users");
      });

      it("should handle different role names", async () => {
        const roleNames = [
          "admin",
          "user-role",
          "MANAGER_ROLE",
          "role.with.dots",
          "special@role",
        ];

        for (const roleName of roleNames) {
          await getRoleUsers(roleName, "test-org");
          expect(mockHttp.get).toHaveBeenCalledWith(`/api/test-org/roles/${roleName}/users`);
        }
      });

      it("should handle different organizations", async () => {
        const organizations = [
          "company-1",
          "organization_2",
          "enterprise-client",
          "test.environment",
        ];

        for (const org of organizations) {
          await getRoleUsers("standard-role", org);
          expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/roles/standard-role/users`);
        }
      });
    });
  });

  describe("Resources and Permissions", () => {
    describe("getResources", () => {
      it("should get resources with correct URL", async () => {
        await getResources("test-org");

        expect(mockHttp.get).toHaveBeenCalledWith("/api/test-org/resources");
      });

      it("should handle different organization identifiers", async () => {
        const organizations = [
          "simple-org",
          "org-with-dashes", 
          "org_with_underscores",
          "production.environment",
          "12345",
        ];

        for (const org of organizations) {
          await getResources(org);
          expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/resources`);
        }
      });
    });

    describe("getResourcePermission", () => {
      it("should get resource permission with correct URL", async () => {
        await getResourcePermission({
          role_name: "admin-role",
          org_identifier: "test-org",
          resource: "dashboards",
        });

        expect(mockHttp.get).toHaveBeenCalledWith(
          "/api/test-org/roles/admin-role/permissions/dashboards"
        );
      });

      it("should handle different resource types", async () => {
        const resources = [
          "dashboards",
          "alerts",
          "reports",
          "users",
          "logs",
          "metrics",
          "traces",
          "settings",
        ];

        const baseParams = {
          role_name: "admin",
          org_identifier: "test-org",
        };

        for (const resource of resources) {
          await getResourcePermission({
            ...baseParams,
            resource: resource,
          });
          expect(mockHttp.get).toHaveBeenCalledWith(
            `/api/test-org/roles/admin/permissions/${resource}`
          );
        }
      });

      it("should handle different role names", async () => {
        const roleNames = [
          "admin",
          "user-role",
          "MANAGER_ROLE",
          "role.with.dots",
          "special@role",
        ];

        const baseParams = {
          org_identifier: "test-org",
          resource: "dashboards",
        };

        for (const roleName of roleNames) {
          await getResourcePermission({
            ...baseParams,
            role_name: roleName,
          });
          expect(mockHttp.get).toHaveBeenCalledWith(
            `/api/test-org/roles/${roleName}/permissions/dashboards`
          );
        }
      });

      it("should handle different organizations", async () => {
        const organizations = [
          "company-a",
          "organization_b",
          "enterprise-client",
          "test.environment",
        ];

        const baseParams = {
          role_name: "admin",
          resource: "dashboards",
        };

        for (const org of organizations) {
          await getResourcePermission({
            ...baseParams,
            org_identifier: org,
          });
          expect(mockHttp.get).toHaveBeenCalledWith(
            `/api/${org}/roles/admin/permissions/dashboards`
          );
        }
      });

      it("should handle complex permission queries", async () => {
        const complexQueries = [
          {
            role_name: "data-analyst",
            org_identifier: "analytics-company",
            resource: "custom-dashboards",
          },
          {
            role_name: "security-officer",
            org_identifier: "financial-org",
            resource: "audit-logs",
          },
          {
            role_name: "team-lead",
            org_identifier: "software-company",
            resource: "team-metrics",
          },
        ];

        for (const query of complexQueries) {
          await getResourcePermission(query);
          expect(mockHttp.get).toHaveBeenCalledWith(
            `/api/${query.org_identifier}/roles/${query.role_name}/permissions/${query.resource}`
          );
        }
      });
    });
  });

  describe("Integration tests", () => {
    it("should handle complete group lifecycle", async () => {
      const org = "lifecycle-org";
      const groupName = "test-group";

      // Create group
      await createGroup(groupName, org);

      // Get groups list
      await getGroups(org);

      // Get specific group
      await getGroup(groupName, org);

      // Update group
      await updateGroup({
        group_name: groupName,
        org_identifier: org,
        payload: {
          add_roles: ["admin"],
          remove_roles: [],
          add_users: ["user@example.com"],
          remove_users: [],
        },
      });

      // Delete group
      await deleteGroup(groupName, org);

      expect(mockHttp.post).toHaveBeenCalledWith(`/api/${org}/groups`, {
        name: groupName,
        users: [],
        roles: [],
      });
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/groups`);
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/groups/${groupName}`);
      expect(mockHttp.put).toHaveBeenCalledWith(
        `/api/${org}/groups/${groupName}`,
        expect.objectContaining({
          add_roles: ["admin"],
          add_users: ["user@example.com"],
        })
      );
      expect(mockHttp.delete).toHaveBeenCalledWith(`/api/${org}/groups/${groupName}`);
    });

    it("should handle complete role lifecycle", async () => {
      const org = "role-org";
      const roleId = "test-role";

      // Create role
      await createRole(roleId, org);

      // Get roles list
      await getRoles(org);

      // Get specific role
      await getRole(roleId, org);

      // Get role users
      await getRoleUsers(roleId, org);

      // Update role
      await updateRole({
        role_id: roleId,
        org_identifier: org,
        payload: { permissions: ["read", "write"] },
      });

      // Delete role
      await deleteRole(roleId, org);

      expect(mockHttp.post).toHaveBeenCalledWith(`/api/${org}/roles`, { role: roleId });
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/roles`);
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/roles/${roleId}`);
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/roles/${roleId}/users`);
      expect(mockHttp.put).toHaveBeenCalledWith(`/api/${org}/roles/${roleId}`, {
        permissions: ["read", "write"],
      });
      expect(mockHttp.delete).toHaveBeenCalledWith(`/api/${org}/roles/${roleId}`);
    });

    it("should maintain URL consistency across all IAM operations", async () => {
      const org = "consistent-org";

      await getGroups(org);
      await getRoles(org);
      await getResources(org);

      // All should use the same base API pattern
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/groups`);
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/roles`);
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/resources`);
    });
  });
});