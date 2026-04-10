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

import { describe, expect, it, beforeEach, vi } from "vitest";
import azureMarketplace from "@/services/azureMarketplace";
import http from "@/services/http";

vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("azureMarketplace service", () => {
  let mockHttpInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    (http as any).mockReturnValue(mockHttpInstance);
  });

  describe("linkSubscription", () => {
    it("should make POST request with token in body", async () => {
      mockHttpInstance.post.mockResolvedValue({
        data: {
          success: true,
          customer_identifier: "cust-azure-123",
        },
      });

      await azureMarketplace.linkSubscription(
        "test-org",
        "azure-marketplace-token-xyz"
      );

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/azure-marketplace/link-subscription",
        { token: "azure-marketplace-token-xyz" }
      );
    });

    it("should use the org_identifier in the URL", async () => {
      mockHttpInstance.post.mockResolvedValue({
        data: { success: true, customer_identifier: "cust-1" },
      });

      await azureMarketplace.linkSubscription("prod-org", "token-abc");

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/prod-org/azure-marketplace/link-subscription",
        { token: "token-abc" }
      );
    });

    it("should handle different org and token combinations", async () => {
      mockHttpInstance.post.mockResolvedValue({
        data: { success: true, customer_identifier: "cust" },
      });

      const cases = [
        { org: "org1", token: "tok-111" },
        { org: "staging-env", token: "AZURE_MP_TOKEN_STAGING" },
        { org: "my_org", token: "eyJhbGciOiJSUzI1Ni..." },
      ];

      for (const { org, token } of cases) {
        await azureMarketplace.linkSubscription(org, token);
        expect(mockHttpInstance.post).toHaveBeenCalledWith(
          `/api/${org}/azure-marketplace/link-subscription`,
          { token }
        );
      }
    });

    it("should return the response data", async () => {
      const responseData = {
        success: true,
        customer_identifier: "cust-azure-linked-456",
        message: "Azure subscription linked successfully",
      };
      mockHttpInstance.post.mockResolvedValue({ data: responseData });

      const result = await azureMarketplace.linkSubscription(
        "test-org",
        "link-token"
      );

      expect(result).toEqual({ data: responseData });
    });

    it("should use 'azure-marketplace' path segment (not 'aws-marketplace')", async () => {
      mockHttpInstance.post.mockResolvedValue({
        data: { success: true, customer_identifier: "c" },
      });

      await azureMarketplace.linkSubscription("test-org", "token");

      const callUrl: string = mockHttpInstance.post.mock.calls[0][0];
      expect(callUrl).toContain("azure-marketplace");
      expect(callUrl).not.toContain("aws-marketplace");
    });

    it("should propagate errors from the POST request", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("Invalid Azure token"));

      await expect(
        azureMarketplace.linkSubscription("test-org", "bad-token")
      ).rejects.toThrow("Invalid Azure token");
    });

    it("should propagate HTTP 400 error responses", async () => {
      const httpError = {
        response: {
          status: 400,
          data: { message: "Token already redeemed" },
        },
      };
      mockHttpInstance.post.mockRejectedValue(httpError);

      await expect(
        azureMarketplace.linkSubscription("test-org", "used-token")
      ).rejects.toEqual(httpError);
    });

    it("should propagate HTTP 401 unauthorized errors", async () => {
      const httpError = {
        response: {
          status: 401,
          data: { message: "Unauthorized" },
        },
      };
      mockHttpInstance.post.mockRejectedValue(httpError);

      await expect(
        azureMarketplace.linkSubscription("test-org", "unauth-token")
      ).rejects.toEqual(httpError);
    });

    it("should propagate network errors", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("Network error"));

      await expect(
        azureMarketplace.linkSubscription("test-org", "net-error-token")
      ).rejects.toThrow("Network error");
    });

    it("should handle response without message field", async () => {
      const responseData = {
        success: true,
        customer_identifier: "cust-no-msg",
      };
      mockHttpInstance.post.mockResolvedValue({ data: responseData });

      const result = await azureMarketplace.linkSubscription(
        "test-org",
        "valid-token"
      );

      expect(result.data.success).toBe(true);
      expect(result.data.customer_identifier).toBe("cust-no-msg");
    });

    it("should pass the token directly as-is in the request body", async () => {
      mockHttpInstance.post.mockResolvedValue({
        data: { success: true, customer_identifier: "c" },
      });

      const token =
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";

      await azureMarketplace.linkSubscription("test-org", token);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual({ token });
    });
  });
});
