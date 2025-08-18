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

import { describe, expect, it, vi, beforeEach } from "vitest";
import organizations from "@/services/organizations";
import http from "@/services/http";

vi.mock("@/services/http");

describe("Organizations Service", () => {
  const mockHttp = vi.mocked(http);
  const mockOrgId = "test-org";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("os_list", () => {
    it("should fetch organizations list with all parameters", async () => {
      const mockOrganizations = {
        data: {
          list: [
            { id: 1, name: "Org 1", identifier: "org1" },
            { id: 2, name: "Org 2", identifier: "org2" }
          ],
          total: 2
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockOrganizations)
      } as any);

      const result = await organizations.os_list(1, 10, "name", false, "test", mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        "/api/organizations?page_num=1&page_size=10&sort_by=name&desc=false&name=test"
      );
      expect(result).toEqual(mockOrganizations);
    });

    it("should handle empty search parameters", async () => {
      const mockOrganizations = { data: { list: [], total: 0 } };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockOrganizations)
      } as any);

      await organizations.os_list(1, 20, "id", true, "", "");

      expect(mockHttp().get).toHaveBeenCalledWith(
        "/api/organizations?page_num=1&page_size=20&sort_by=id&desc=true&name="
      );
    });
  });

  describe("list", () => {
    it("should fetch organizations list", async () => {
      const mockOrganizations = {
        data: {
          list: [{ id: 1, name: "Test Org", identifier: "test" }],
          total: 1
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockOrganizations)
      } as any);

      const result = await organizations.list(1, 10, "name", false, "test");

      expect(mockHttp().get).toHaveBeenCalledWith(
        "/api/organizations?page_num=1&page_size=10&sort_by=name&desc=false&name=test"
      );
      expect(result).toEqual(mockOrganizations);
    });
  });

  describe("create", () => {
    it("should create a new organization", async () => {
      const orgData = {
        name: "New Organization",
        identifier: "new-org",
        description: "Test organization"
      };

      const mockResponse = {
        data: { id: 1, ...orgData }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await organizations.create(orgData);

      expect(mockHttp().post).toHaveBeenCalledWith("/api/organizations", orgData);
      expect(result).toEqual(mockResponse);
    });

    it("should handle organization creation errors", async () => {
      const orgData = { name: "Test Org" };
      const mockError = new Error("Organization already exists");

      mockHttp.mockReturnValue({
        post: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(organizations.create(orgData)).rejects.toThrow("Organization already exists");
    });
  });

  describe("add_members", () => {
    it("should add members to organization", async () => {
      const memberData = {
        emails: ["user1@example.com", "user2@example.com"],
        role: "admin"
      };

      const mockResponse = {
        data: { message: "Members added successfully" }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await organizations.add_members(memberData, mockOrgId);

      expect(mockHttp().post).toHaveBeenCalledWith(
        `api/${mockOrgId}/invites`,
        memberData
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("process_subscription", () => {
    it("should process subscription with action", async () => {
      const subscriptionId = "sub-123";
      const action = "activate";
      const mockResponse = { data: { status: "activated" } };

      mockHttp.mockReturnValue({
        put: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await organizations.process_subscription(subscriptionId, action, mockOrgId);

      expect(mockHttp().put).toHaveBeenCalledWith(
        `api/${mockOrgId}/member_subscription/${subscriptionId}?action=${action}`,
        {}
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("get_associated_members", () => {
    it("should fetch associated members", async () => {
      const mockMembers = {
        data: [
          { email: "member1@example.com", role: "admin" },
          { email: "member2@example.com", role: "user" }
        ]
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockMembers)
      } as any);

      const result = await organizations.get_associated_members(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `api/${mockOrgId}/organizations/associated_members`
      );
      expect(result).toEqual(mockMembers);
    });
  });

  describe("update_member_role", () => {
    it("should update member role", async () => {
      const memberData = {
        email: "user@example.com",
        role: "editor"
      };

      const mockResponse = {
        data: { email: memberData.email, role: memberData.role }
      };

      mockHttp.mockReturnValue({
        put: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await organizations.update_member_role(memberData, mockOrgId);

      expect(mockHttp().put).toHaveBeenCalledWith(
        `api/${mockOrgId}/users/${memberData.email}`,
        memberData
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("verify_identifier", () => {
    it("should verify organization identifier", async () => {
      const identifier = "test-org-id";
      const mockResponse = { data: { available: true } };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await organizations.verify_identifier(identifier);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `api/organizations/verify_identifier/${identifier}`
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle identifier verification for unavailable names", async () => {
      const identifier = "taken-org-id";
      const mockResponse = { data: { available: false } };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await organizations.verify_identifier(identifier);

      expect(result.data.available).toBe(false);
    });
  });

  describe("get_organization_passcode", () => {
    it("should fetch organization passcode", async () => {
      const mockPasscode = { data: { passcode: "ABC123" } };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockPasscode)
      } as any);

      const result = await organizations.get_organization_passcode(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(`/api/${mockOrgId}/passcode`);
      expect(result).toEqual(mockPasscode);
    });
  });

  describe("update_organization_passcode", () => {
    it("should update organization passcode", async () => {
      const mockResponse = { data: { passcode: "NEW123" } };

      mockHttp.mockReturnValue({
        put: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await organizations.update_organization_passcode(mockOrgId);

      expect(mockHttp().put).toHaveBeenCalledWith(
        `api/${mockOrgId}/passcode`,
        {}
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("get_organization_summary", () => {
    it("should fetch organization summary", async () => {
      const mockSummary = {
        data: {
          users: 10,
          streams: 5,
          storage_used: "1.5GB",
          queries_today: 150
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockSummary)
      } as any);

      const result = await organizations.get_organization_summary(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(`/api/${mockOrgId}/summary`);
      expect(result).toEqual(mockSummary);
    });
  });

  describe("get_organization_settings", () => {
    it("should fetch organization settings", async () => {
      const mockSettings = {
        data: {
          max_users: 100,
          retention_days: 30,
          features: ["analytics", "alerts"]
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockSettings)
      } as any);

      const result = await organizations.get_organization_settings(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(`/api/${mockOrgId}/settings`);
      expect(result).toEqual(mockSettings);
    });
  });

  describe("post_organization_settings", () => {
    it("should update organization settings", async () => {
      const settingsData = {
        max_users: 200,
        retention_days: 60,
        features: ["analytics", "alerts", "custom_dashboards"]
      };

      const mockResponse = {
        data: { message: "Settings updated successfully" }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await organizations.post_organization_settings(mockOrgId, settingsData);

      expect(mockHttp().post).toHaveBeenCalledWith(
        `/api/${mockOrgId}/settings`,
        settingsData
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("get_admin_org", () => {
    it("should fetch admin organizations with large page size", async () => {
      const mockAdminOrgs = {
        data: {
          list: [
            { id: 1, name: "Admin Org 1" },
            { id: 2, name: "Admin Org 2" }
          ],
          total: 2
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockAdminOrgs)
      } as any);

      const result = await organizations.get_admin_org(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/organizations?page_size=1000000`
      );
      expect(result).toEqual(mockAdminOrgs);
    });
  });

  describe("extend_trial_period", () => {
    it("should extend trial period", async () => {
      const extensionData = {
        days: 30,
        reason: "Customer evaluation"
      };

      const mockResponse = {
        data: { 
          message: "Trial period extended",
          new_expiry_date: "2024-12-31"
        }
      };

      mockHttp.mockReturnValue({
        put: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await organizations.extend_trial_period(mockOrgId, extensionData);

      expect(mockHttp().put).toHaveBeenCalledWith(
        `/api/${mockOrgId}/extend_trial_period`,
        extensionData
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("Error Handling", () => {
    it("should handle network errors", async () => {
      const networkError = new Error("Network connection failed");
      
      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(networkError),
        post: vi.fn().mockRejectedValue(networkError),
        put: vi.fn().mockRejectedValue(networkError)
      } as any);

      await expect(organizations.list(1, 10, "name", false, "")).rejects.toThrow("Network connection failed");
      await expect(organizations.create({})).rejects.toThrow("Network connection failed");
      await expect(organizations.update_member_role({}, mockOrgId)).rejects.toThrow("Network connection failed");
    });

    it("should handle HTTP error responses", async () => {
      const httpError = {
        response: {
          status: 403,
          data: { message: "Insufficient permissions" }
        }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockRejectedValue(httpError)
      } as any);

      await expect(organizations.create({})).rejects.toEqual(httpError);
    });

    it("should handle validation errors", async () => {
      const validationError = {
        response: {
          status: 400,
          data: {
            message: "Validation failed",
            errors: ["Name is required", "Identifier must be unique"]
          }
        }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockRejectedValue(validationError)
      } as any);

      await expect(organizations.create({})).rejects.toEqual(validationError);
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete organization management workflow", async () => {
      const orgData = {
        name: "Test Organization",
        identifier: "test-org",
        description: "Test description"
      };

      const memberData = {
        emails: ["admin@example.com"],
        role: "admin"
      };

      const settingsData = {
        max_users: 100,
        retention_days: 30
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockImplementation((url: string) => {
          if (url.includes('/verify_identifier/')) {
            return Promise.resolve({ data: { available: true } });
          } else if (url.includes('/passcode')) {
            return Promise.resolve({ data: { passcode: "ABC123" } });
          } else if (url.includes('/summary')) {
            return Promise.resolve({ data: { users: 1, streams: 0 } });
          }
          return Promise.resolve({ data: {} });
        }),
        post: vi.fn().mockImplementation((url: string) => {
          if (url.includes('/organizations')) {
            return Promise.resolve({ data: { id: 1, ...orgData } });
          } else if (url.includes('/invites')) {
            return Promise.resolve({ data: { message: "Member added" } });
          } else if (url.includes('/settings')) {
            return Promise.resolve({ data: { message: "Settings updated" } });
          }
          return Promise.resolve({ data: {} });
        }),
        put: vi.fn().mockResolvedValue({ data: { passcode: "NEW123" } })
      } as any);

      // Verify identifier availability
      const verification = await organizations.verify_identifier(orgData.identifier);
      expect(verification.data.available).toBe(true);

      // Create organization
      const createdOrg = await organizations.create(orgData);
      expect(createdOrg.data.name).toBe(orgData.name);

      // Add members
      const memberResult = await organizations.add_members(memberData, orgData.identifier);
      expect(memberResult.data.message).toBe("Member added");

      // Update settings
      const settingsResult = await organizations.post_organization_settings(orgData.identifier, settingsData);
      expect(settingsResult.data.message).toBe("Settings updated");

      // Get summary
      const summary = await organizations.get_organization_summary(orgData.identifier);
      expect(summary.data.users).toBe(1);

      // Update passcode
      const passcodeResult = await organizations.update_organization_passcode(orgData.identifier);
      expect(passcodeResult.data.passcode).toBe("NEW123");
    });
  });
});