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

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import domainManagement from "./domainManagement";
import http from "./http";

// Mock the http service with a scoped namespace
vi.mock("./http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    put: vi.fn(),
  })),
}));

// Mock Vuex store with scoped namespace
vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      selectedOrganization: {
        identifier: "test-org",
      },
    },
  })),
}));

describe("domainManagement Service", () => {
  let mockHttpInstance: any;
  
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    vi.resetAllMocks();
    
    // Create a mock HTTP instance
    mockHttpInstance = {
      get: vi.fn(),
      put: vi.fn(),
    };
    
    // Make http() return our mock instance
    (http as any).mockReturnValue(mockHttpInstance);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  afterAll(() => {
    // Final cleanup
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("getDomainRestrictions", () => {
    it("should call GET endpoint with correct metaOrg parameter", async () => {
      const metaOrg = "test-meta-org";
      const mockResponse = {
        data: {
          domains: [
            {
              domain: "example.com",
              allow_all_users: true,
              allowed_emails: [],
            },
          ],
        },
      };

      mockHttpInstance.get.mockResolvedValue(mockResponse);

      const result = await domainManagement.getDomainRestrictions(metaOrg);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${metaOrg}/domain_management`
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle API errors gracefully", async () => {
      const metaOrg = "test-meta-org";
      const errorMessage = "Network error";
      
      mockHttpInstance.get.mockRejectedValue(new Error(errorMessage));

      await expect(
        domainManagement.getDomainRestrictions(metaOrg)
      ).rejects.toThrow(errorMessage);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${metaOrg}/domain_management`
      );
    });

    it("should handle empty response", async () => {
      const metaOrg = "test-meta-org";
      const mockResponse = { data: null };

      mockHttpInstance.get.mockResolvedValue(mockResponse);

      const result = await domainManagement.getDomainRestrictions(metaOrg);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${metaOrg}/domain_management`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("updateDomainRestrictions", () => {
    it("should call PUT endpoint with correct parameters", async () => {
      const metaOrg = "test-meta-org";
      const domainData = {
        domains: [
          {
            domain: "example.com",
            allow_all_users: false,
            allowed_emails: ["user@example.com"],
          },
        ],
      };
      const mockResponse = { success: true };

      mockHttpInstance.put.mockResolvedValue(mockResponse);

      const result = await domainManagement.updateDomainRestrictions(
        metaOrg,
        domainData as any
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${metaOrg}/domain_management`,
        domainData
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle update errors", async () => {
      const metaOrg = "test-meta-org";
      const domainData = {
        domains: [
          {
            domain: "example.com",
            allow_all_users: true,
            allowed_emails: [],
          },
        ],
      };
      const errorMessage = "Update failed";
      
      mockHttpInstance.put.mockRejectedValue(new Error(errorMessage));

      await expect(
        domainManagement.updateDomainRestrictions(metaOrg, domainData as any)
      ).rejects.toThrow(errorMessage);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${metaOrg}/domain_management`,
        domainData
      );
    });

    it("should handle complex domain configurations", async () => {
      const metaOrg = "test-meta-org";
      const complexDomainData = {
        domains: [
          {
            domain: "company.com",
            allow_all_users: false,
            allowed_emails: [
              "admin@company.com",
              "user1@company.com",
              "user2@company.com",
            ],
          },
          {
            domain: "partner.org",
            allow_all_users: true,
            allowed_emails: [],
          },
        ],
      };
      const mockResponse = { success: true, updated: 2 };

      mockHttpInstance.put.mockResolvedValue(mockResponse);

      const result = await domainManagement.updateDomainRestrictions(
        metaOrg,
        complexDomainData as any
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${metaOrg}/domain_management`,
        complexDomainData
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle empty domain data", async () => {
      const metaOrg = "test-meta-org";
      const emptyDomainData = { domains: [] };
      const mockResponse = { success: true };

      mockHttpInstance.put.mockResolvedValue(mockResponse);

      const result = await domainManagement.updateDomainRestrictions(
        metaOrg,
        emptyDomainData as any
      );

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${metaOrg}/domain_management`,
        emptyDomainData
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("Edge Cases", () => {
    it("should handle special characters in metaOrg", async () => {
      const metaOrg = "test-org-with-special-chars_123";
      const mockResponse = { data: { domains: [] } };

      mockHttpInstance.get.mockResolvedValue(mockResponse);

      await domainManagement.getDomainRestrictions(metaOrg);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${metaOrg}/domain_management`
      );
    });

    it("should handle undefined metaOrg parameter", async () => {
      const metaOrg = undefined as any;

      mockHttpInstance.get.mockResolvedValue({ data: null });

      await domainManagement.getDomainRestrictions(metaOrg);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${metaOrg}/domain_management`
      );
    });
  });
});
