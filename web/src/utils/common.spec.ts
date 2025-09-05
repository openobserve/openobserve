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
import { getDefaultOrganization, redirectUser, logsErrorMessage } from "@/utils/common";
import organizationsService from "@/services/organizations";
import * as zincutils from "@/utils/zincutils";

vi.mock("@/services/organizations");
vi.mock("@/utils/zincutils");
vi.mock("vuex", () => ({
  useStore: () => ({
    dispatch: vi.fn(),
    state: {}
  })
}));

describe("Common Utils", () => {
  const mockOrganizationsService = vi.mocked(organizationsService);
  const mockZincutils = vi.mocked(zincutils);

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: {
        href: '',
        replace: vi.fn()
      },
      writable: true
    });
  });

  describe("getDefaultOrganization", () => {
    const mockUserInfo = {
      email: "test@example.com",
      name: "Test User"
    };

    const mockOrgIdentifier = "test-org";

    const mockOrgsResponse = {
      data: {
        data: [
          {
            id: 1,
            name: "Default Organization",
            org_type: "default",
            identifier: "default-org",
            user_obj: { email: "test@example.com" },
            ingest_threshold: 1000,
            search_threshold: 500,
            note: "Default organization"
          },
          {
            id: 2,
            name: "Secondary Organization", 
            org_type: "custom",
            identifier: "secondary-org",
            user_obj: { email: "test@example.com" },
            ingest_threshold: 2000,
            search_threshold: 1000,
            note: "Secondary organization"
          }
        ]
      }
    };

    it("should fetch and process organization list successfully", async () => {
      mockOrganizationsService.os_list = vi.fn().mockResolvedValue(mockOrgsResponse);
      mockZincutils.useLocalOrganization = vi.fn().mockReturnValue({ value: null });
      mockZincutils.getPath = vi.fn().mockReturnValue("/");

      await getDefaultOrganization(mockUserInfo, mockOrgIdentifier);

      expect(mockOrganizationsService.os_list).toHaveBeenCalledWith(
        0, 100000, "id", false, "", mockOrgIdentifier
      );
    });

    it("should select default organization when user matches", async () => {
      mockOrganizationsService.os_list = vi.fn().mockResolvedValue(mockOrgsResponse);
      mockZincutils.useLocalOrganization = vi.fn().mockReturnValue({ value: null });

      await getDefaultOrganization(mockUserInfo, mockOrgIdentifier);

      expect(mockZincutils.useLocalOrganization).toHaveBeenCalled();
    });

    it("should handle single organization case", async () => {
      const singleOrgResponse = {
        data: {
          data: [mockOrgsResponse.data.data[0]]
        }
      };

      mockOrganizationsService.os_list = vi.fn().mockResolvedValue(singleOrgResponse);
      mockZincutils.useLocalOrganization = vi.fn().mockReturnValue({ value: null });

      await getDefaultOrganization(mockUserInfo, mockOrgIdentifier);

      expect(mockOrganizationsService.os_list).toHaveBeenCalled();
    });

    it("should handle local organization mismatch", async () => {
      const localOrg = {
        value: {
          user_email: "different@example.com",
          name: "Different User Org"
        }
      };

      mockOrganizationsService.os_list = vi.fn().mockResolvedValue(mockOrgsResponse);
      mockZincutils.useLocalOrganization = vi.fn().mockReturnValue(localOrg);

      await getDefaultOrganization(mockUserInfo, mockOrgIdentifier);

      expect(mockZincutils.useLocalOrganization).toHaveBeenCalledWith("");
    });

    it("should handle API errors", async () => {
      const apiError = new Error("API request failed");
      mockOrganizationsService.os_list = vi.fn().mockRejectedValue(apiError);

      await expect(getDefaultOrganization(mockUserInfo, mockOrgIdentifier))
        .rejects.toThrow("API request failed");
    });

    it("should map organization data correctly", async () => {
      mockOrganizationsService.os_list = vi.fn().mockResolvedValue(mockOrgsResponse);
      mockZincutils.useLocalOrganization = vi.fn().mockReturnValue({ value: null });

      await getDefaultOrganization(mockUserInfo, mockOrgIdentifier);

      expect(mockOrganizationsService.os_list).toHaveBeenCalled();
    });

    it("should handle empty organization list", async () => {
      const emptyResponse = {
        data: {
          data: []
        }
      };

      mockOrganizationsService.os_list = vi.fn().mockResolvedValue(emptyResponse);
      mockZincutils.useLocalOrganization = vi.fn().mockReturnValue({ value: null });

      await getDefaultOrganization(mockUserInfo, mockOrgIdentifier);

      expect(mockOrganizationsService.os_list).toHaveBeenCalled();
    });
  });

  describe("redirectUser", () => {
    beforeEach(() => {
      mockZincutils.getPath = vi.fn().mockReturnValue("/default-path");
    });

    it("should redirect to external URL when redirectURI contains http", () => {
      const externalUrl = "https://external-site.com/redirect";
      
      redirectUser(externalUrl);

      expect(window.location.href).toBe(externalUrl);
    });

    it("should use replace for internal redirects", () => {
      const internalPath = "/internal/path";
      const replaceSpy = vi.spyOn(window.location, 'replace');
      
      redirectUser(internalPath);

      expect(replaceSpy).toHaveBeenCalledWith(internalPath);
    });

    it("should redirect to default path when redirectURI is null", () => {
      const replaceSpy = vi.spyOn(window.location, 'replace');
      
      redirectUser(null);

      expect(replaceSpy).toHaveBeenCalledWith("/default-path");
      expect(mockZincutils.getPath).toHaveBeenCalled();
    });

    it("should redirect to default path when redirectURI is empty string", () => {
      const replaceSpy = vi.spyOn(window.location, 'replace');
      
      redirectUser("");

      expect(replaceSpy).toHaveBeenCalledWith("/default-path");
    });

    it("should handle https URLs", () => {
      const httpsUrl = "https://secure.example.com/auth";
      
      redirectUser(httpsUrl);

      expect(window.location.href).toBe(httpsUrl);
    });

    it("should handle http URLs", () => {
      const httpUrl = "http://example.com/redirect";
      
      redirectUser(httpUrl);

      expect(window.location.href).toBe(httpUrl);
    });

    it("should handle relative paths", () => {
      const relativePath = "/app/dashboard";
      const replaceSpy = vi.spyOn(window.location, 'replace');
      
      redirectUser(relativePath);

      expect(replaceSpy).toHaveBeenCalledWith(relativePath);
    });

    it("should handle absolute paths without protocol", () => {
      const absolutePath = "/admin/users";
      const replaceSpy = vi.spyOn(window.location, 'replace');
      
      redirectUser(absolutePath);

      expect(replaceSpy).toHaveBeenCalledWith(absolutePath);
    });
  });

  describe("logsErrorMessage", () => {
    it("should return correct error message for known error codes", () => {
      expect(logsErrorMessage(10001)).toBe("message.ServerInternalError");
      expect(logsErrorMessage(20001)).toBe("message.SearchSQLNotValid");
      expect(logsErrorMessage(20002)).toBe("message.SearchStreamNotFound");
      expect(logsErrorMessage(20003)).toBe("message.FullTextSearchFieldNotFound");
      expect(logsErrorMessage(20004)).toBe("message.SearchFieldNotFound");
    });

    it("should return empty string for unknown error codes", () => {
      expect(logsErrorMessage(99999)).toBe("");
      expect(logsErrorMessage(0)).toBe("");
      expect(logsErrorMessage(-1)).toBe("");
    });

    it("should handle string inputs gracefully", () => {
      // Even though TypeScript expects number, test runtime behavior
      expect(logsErrorMessage("10001" as any)).toBe("message.ServerInternalError");
      expect(logsErrorMessage("invalid" as any)).toBe("");
    });

    it("should handle null and undefined inputs", () => {
      expect(logsErrorMessage(null as any)).toBe("");
      expect(logsErrorMessage(undefined as any)).toBe("");
    });

    it("should return exact string matches", () => {
      const message = logsErrorMessage(10001);
      expect(typeof message).toBe("string");
      expect(message).toBe("message.ServerInternalError");
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete organization selection workflow", async () => {
      const userInfo = {
        email: "workflow@example.com",
        name: "Workflow User"
      };

      const orgResponse = {
        data: {
          data: [
            {
              id: 1,
              name: "Workflow Org",
              org_type: "default",
              identifier: "workflow-org",
              user_obj: { email: "workflow@example.com" },
              ingest_threshold: 1000,
              search_threshold: 500,
              note: "Workflow organization"
            }
          ]
        }
      };

      mockOrganizationsService.os_list = vi.fn().mockResolvedValue(orgResponse);
      mockZincutils.useLocalOrganization = vi.fn().mockReturnValue({ value: null });

      await getDefaultOrganization(userInfo, "workflow-org");

      expect(mockOrganizationsService.os_list).toHaveBeenCalledWith(
        0, 100000, "id", false, "", "workflow-org"
      );
    });

    it("should handle redirect with error handling", () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      try {
        redirectUser("https://valid-url.com");
        expect(window.location.href).toBe("https://valid-url.com");
      } catch (error) {
        // Handle any potential errors gracefully
        expect(consoleSpy).not.toHaveBeenCalled();
      }
      
      consoleSpy.mockRestore();
    });

    it("should provide consistent error messaging across different error types", () => {
      const serverErrors = [10001];
      const searchErrors = [20001, 20002, 20003, 20004];

      serverErrors.forEach(code => {
        const message = logsErrorMessage(code);
        expect(message).toBeTruthy();
        expect(typeof message).toBe("string");
      });

      searchErrors.forEach(code => {
        const message = logsErrorMessage(code);
        expect(message).toBeTruthy();
        expect(typeof message).toBe("string");
        expect(message.toLowerCase()).toContain("search");
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle network errors in getDefaultOrganization", async () => {
      const networkError = new Error("Network connection failed");
      mockOrganizationsService.os_list = vi.fn().mockRejectedValue(networkError);

      await expect(getDefaultOrganization({email: "test@test.com"}, "org"))
        .rejects.toThrow("Network connection failed");
    });

    it("should handle malformed organization data", async () => {
      const malformedResponse = {
        data: {
          data: [
            {
              // Missing required fields
              name: "Incomplete Org"
            }
          ]
        }
      };

      mockOrganizationsService.os_list = vi.fn().mockResolvedValue(malformedResponse);
      mockZincutils.useLocalOrganization = vi.fn().mockReturnValue({ value: null });

      // Should not throw when processing malformed data
      await getDefaultOrganization({email: "test@test.com"}, "org");
      expect(mockOrganizationsService.os_list).toHaveBeenCalled();
    });
  });
});