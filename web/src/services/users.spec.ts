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
import users from "@/services/users";
import http from "@/services/http";

vi.mock("@/services/http");

describe("Users Service", () => {
  const mockHttp = vi.mocked(http);
  const mockOrgId = "test-org";
  const mockUserEmail = "test@example.com";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("should fetch users list with pagination and filters", async () => {
      const mockUsers = {
        data: {
          list: [
            { email: "user1@example.com", name: "User 1" },
            { email: "user2@example.com", name: "User 2" }
          ],
          total: 2
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockUsers)
      } as any);

      const result = await users.list(1, 10, "name", false, "test");

      expect(mockHttp().get).toHaveBeenCalledWith(
        "/api/users?page_num=1&page_size=10&sort_by=name&desc=false&name=test"
      );
      expect(result).toEqual(mockUsers);
    });

    it("should handle empty search name parameter", async () => {
      const mockUsers = { data: { list: [], total: 0 } };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockUsers)
      } as any);

      await users.list(1, 10, "email", true, "");

      expect(mockHttp().get).toHaveBeenCalledWith(
        "/api/users?page_num=1&page_size=10&sort_by=email&desc=true&name="
      );
    });
  });

  describe("create", () => {
    it("should create a new user", async () => {
      const userData = {
        email: "newuser@example.com",
        name: "New User",
        role: "admin"
      };

      const mockResponse = {
        data: { id: 1, ...userData }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await users.create(userData, mockOrgId);

      expect(mockHttp().post).toHaveBeenCalledWith(
        `/api/${mockOrgId}/users`,
        userData
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle user creation errors", async () => {
      const userData = { email: "test@example.com", name: "Test" };
      const mockError = new Error("Email already exists");

      mockHttp.mockReturnValue({
        post: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(users.create(userData, mockOrgId)).rejects.toThrow("Email already exists");
    });
  });

  describe("update", () => {
    it("should update an existing user", async () => {
      const updateData = {
        name: "Updated User",
        role: "viewer"
      };

      const mockResponse = {
        data: { email: mockUserEmail, ...updateData }
      };

      mockHttp.mockReturnValue({
        put: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await users.update(updateData, mockOrgId, mockUserEmail);

      expect(mockHttp().put).toHaveBeenCalledWith(
        `/api/${mockOrgId}/users/${mockUserEmail}`,
        updateData
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("updateexistinguser", () => {
    it("should update existing user using POST method", async () => {
      const updateData = { name: "Updated Name" };
      const mockResponse = { data: { success: true } };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await users.updateexistinguser(updateData, mockOrgId, mockUserEmail);

      expect(mockHttp().post).toHaveBeenCalledWith(
        `/api/${mockOrgId}/users/${mockUserEmail}`,
        updateData
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("delete", () => {
    it("should delete a user", async () => {
      const mockResponse = { data: { message: "User deleted successfully" } };

      mockHttp.mockReturnValue({
        delete: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await users.delete(mockOrgId, mockUserEmail);

      expect(mockHttp().delete).toHaveBeenCalledWith(
        `/api/${mockOrgId}/users/${mockUserEmail}`
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle deletion errors", async () => {
      const mockError = new Error("User not found");

      mockHttp.mockReturnValue({
        delete: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(users.delete(mockOrgId, mockUserEmail)).rejects.toThrow("User not found");
    });
  });

  describe("verifyUser", () => {
    it("should verify if user exists", async () => {
      const mockResponse = { data: { exists: true, verified: true } };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await users.verifyUser(mockUserEmail);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/users/verifyuser/${mockUserEmail}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("addNewUser", () => {
    it("should add a new user to the system", async () => {
      const newUserData = {
        email: "newuser@example.com",
        name: "New User",
        password: "password123"
      };

      const mockResponse = {
        data: { id: 1, email: newUserData.email, name: newUserData.name }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await users.addNewUser(newUserData);

      expect(mockHttp().post).toHaveBeenCalledWith(
        "/api/users/new_user",
        newUserData
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("orgUsers", () => {
    it("should fetch organization users", async () => {
      const mockOrgUsers = {
        data: [
          { email: "admin@example.com", role: "admin" },
          { email: "user@example.com", role: "user" }
        ]
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockOrgUsers)
      } as any);

      const result = await users.orgUsers(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(`/api/${mockOrgId}/users`);
      expect(result).toEqual(mockOrgUsers);
    });
  });

  describe("getRefreshToken", () => {
    it("should get refresh token", async () => {
      const mockTokenResponse = {
        data: { token: "new-refresh-token", expires_at: "2024-12-31" }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockTokenResponse)
      } as any);

      const result = await users.getRefreshToken();

      expect(mockHttp().get).toHaveBeenCalledWith("/api/auth/refresh_token");
      expect(result).toEqual(mockTokenResponse);
    });
  });

  describe("getRoles", () => {
    it("should fetch available roles for organization", async () => {
      const mockRoles = {
        data: ["admin", "user", "viewer", "editor"]
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockRoles)
      } as any);

      const result = await users.getRoles(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(`/api/${mockOrgId}/users/roles`);
      expect(result).toEqual(mockRoles);
    });
  });

  describe("logout", () => {
    it("should logout user", async () => {
      const mockLogoutResponse = {
        data: { message: "Logged out successfully" }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockLogoutResponse)
      } as any);

      const result = await users.logout();

      expect(mockHttp().get).toHaveBeenCalledWith("/config/logout");
      expect(result).toEqual(mockLogoutResponse);
    });
  });

  describe("getUserGroups", () => {
    it("should fetch user groups", async () => {
      const mockGroups = {
        data: [
          { id: 1, name: "Admin Group" },
          { id: 2, name: "User Group" }
        ]
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockGroups)
      } as any);

      const result = await users.getUserGroups(mockOrgId, mockUserEmail);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `api/${mockOrgId}/users/${mockUserEmail}/groups`
      );
      expect(result).toEqual(mockGroups);
    });
  });

  describe("getUserRoles", () => {
    it("should fetch user roles", async () => {
      const mockUserRoles = {
        data: ["admin", "user"]
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockUserRoles)
      } as any);

      const result = await users.getUserRoles(mockOrgId, mockUserEmail);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `api/${mockOrgId}/users/${mockUserEmail}/roles`
      );
      expect(result).toEqual(mockUserRoles);
    });
  });

  describe("invitedUsers", () => {
    it("should fetch invited users", async () => {
      const mockInvites = {
        data: [
          { email: "invite1@example.com", status: "pending" },
          { email: "invite2@example.com", status: "accepted" }
        ]
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockInvites)
      } as any);

      const result = await users.invitedUsers(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(`/api/${mockOrgId}/invites`);
      expect(result).toEqual(mockInvites);
    });
  });

  describe("Error Handling", () => {
    it("should handle network errors across all methods", async () => {
      const networkError = new Error("Network connection failed");
      
      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(networkError),
        post: vi.fn().mockRejectedValue(networkError),
        put: vi.fn().mockRejectedValue(networkError),
        delete: vi.fn().mockRejectedValue(networkError)
      } as any);

      await expect(users.list(1, 10, "name", false, "")).rejects.toThrow("Network connection failed");
      await expect(users.orgUsers(mockOrgId)).rejects.toThrow("Network connection failed");
      await expect(users.create({}, mockOrgId)).rejects.toThrow("Network connection failed");
      await expect(users.update({}, mockOrgId, mockUserEmail)).rejects.toThrow("Network connection failed");
      await expect(users.delete(mockOrgId, mockUserEmail)).rejects.toThrow("Network connection failed");
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

      await expect(users.create({}, mockOrgId)).rejects.toEqual(httpError);
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete user management workflow", async () => {
      const userData = {
        email: "workflow@example.com",
        name: "Workflow User",
        role: "admin"
      };

      mockHttp.mockReturnValue({
        get: vi.fn()
          .mockResolvedValueOnce({ data: { exists: false } }) // verifyUser
          .mockResolvedValueOnce({ data: [{ email: userData.email }] }), // orgUsers
        post: vi.fn().mockResolvedValue({ data: { id: 1, ...userData } }), // create
        put: vi.fn().mockResolvedValue({ data: { ...userData, name: "Updated Name" } }), // update
        delete: vi.fn().mockResolvedValue({ data: { message: "Deleted" } }) // delete
      } as any);

      // Check if user exists
      const verification = await users.verifyUser(userData.email);
      expect(verification.data.exists).toBe(false);

      // Create user
      const createdUser = await users.create(userData, mockOrgId);
      expect(createdUser.data.email).toBe(userData.email);

      // Update user
      const updatedUser = await users.update({ name: "Updated Name" }, mockOrgId, userData.email);
      expect(updatedUser.data.name).toBe("Updated Name");

      // Get org users
      const orgUsersList = await users.orgUsers(mockOrgId);
      expect(orgUsersList.data).toHaveLength(1);

      // Delete user
      const deleteResult = await users.delete(mockOrgId, userData.email);
      expect(deleteResult.data.message).toBe("Deleted");
    });
  });
});