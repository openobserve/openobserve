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

import { describe, expect, it, beforeEach, vi } from "vitest";
import awsMarketplace from "@/services/awsMarketplace";
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

describe("awsMarketplace service", () => {
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
          customer_identifier: "cust-aws-123",
        },
      });

      await awsMarketplace.linkSubscription("test-org", "marketplace-token-xyz");

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/aws-marketplace/link-subscription",
        { token: "marketplace-token-xyz" }
      );
    });

    it("should use the org_identifier in the URL", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: { success: true, customer_identifier: "cust-1" } });

      await awsMarketplace.linkSubscription("prod-org", "token-abc");

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/prod-org/aws-marketplace/link-subscription",
        { token: "token-abc" }
      );
    });

    it("should handle different org and token combinations", async () => {
      mockHttpInstance.post.mockResolvedValue({ data: { success: true, customer_identifier: "cust" } });

      const cases = [
        { org: "org1", token: "tok-111" },
        { org: "staging-env", token: "AWS_MP_TOKEN_STAGING" },
        { org: "my_org", token: "eyJhbGciOiJSUzI1Ni..." },
      ];

      for (const { org, token } of cases) {
        await awsMarketplace.linkSubscription(org, token);
        expect(mockHttpInstance.post).toHaveBeenCalledWith(
          `/api/${org}/aws-marketplace/link-subscription`,
          { token }
        );
      }
    });

    it("should return the response data", async () => {
      const responseData = {
        success: true,
        customer_identifier: "cust-linked-456",
        message: "Subscription linked successfully",
      };
      mockHttpInstance.post.mockResolvedValue({ data: responseData });

      const result = await awsMarketplace.linkSubscription(
        "test-org",
        "link-token"
      );

      expect(result).toEqual({ data: responseData });
    });

    it("should propagate errors from the POST request", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("Invalid token"));

      await expect(
        awsMarketplace.linkSubscription("test-org", "bad-token")
      ).rejects.toThrow("Invalid token");
    });

    it("should propagate HTTP error responses", async () => {
      const httpError = {
        response: {
          status: 400,
          data: { message: "Token already used" },
        },
      };
      mockHttpInstance.post.mockRejectedValue(httpError);

      await expect(
        awsMarketplace.linkSubscription("test-org", "used-token")
      ).rejects.toEqual(httpError);
    });
  });

  describe("getActivationStatus", () => {
    it("should make GET request with customer_id query param", async () => {
      mockHttpInstance.get.mockResolvedValue({
        data: {
          status: "active",
          customer_identifier: "cust-aws-123",
          org_id: "test-org",
        },
      });

      await awsMarketplace.getActivationStatus("test-org", "cust-aws-123");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/aws-marketplace/activation-status?customer_id=cust-aws-123"
      );
    });

    it("should use the org_identifier in the URL", async () => {
      mockHttpInstance.get.mockResolvedValue({
        data: { status: "pending_activation", customer_identifier: "cust-1", org_id: "prod-org" },
      });

      await awsMarketplace.getActivationStatus("prod-org", "cust-1");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/prod-org/aws-marketplace/activation-status?customer_id=cust-1"
      );
    });

    it("should handle different org and customer_id combinations", async () => {
      mockHttpInstance.get.mockResolvedValue({
        data: { status: "active", customer_identifier: "c", org_id: "o" },
      });

      const cases = [
        { org: "org-a", customerId: "cust-aaa" },
        { org: "staging", customerId: "marketplace-customer-xyz" },
        { org: "dev_env", customerId: "12345" },
      ];

      for (const { org, customerId } of cases) {
        await awsMarketplace.getActivationStatus(org, customerId);
        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/${org}/aws-marketplace/activation-status?customer_id=${customerId}`
        );
      }
    });

    it("should return the response data", async () => {
      const responseData = {
        status: "active" as const,
        customer_identifier: "cust-active-789",
        org_id: "test-org",
        activated_at: "2025-01-01T00:00:00Z",
      };
      mockHttpInstance.get.mockResolvedValue({ data: responseData });

      const result = await awsMarketplace.getActivationStatus(
        "test-org",
        "cust-active-789"
      );

      expect(result).toEqual({ data: responseData });
    });

    it("should handle pending_activation status", async () => {
      mockHttpInstance.get.mockResolvedValue({
        data: {
          status: "pending_activation",
          customer_identifier: "cust-pending",
          org_id: "test-org",
        },
      });

      const result = await awsMarketplace.getActivationStatus(
        "test-org",
        "cust-pending"
      );

      expect(result.data.status).toBe("pending_activation");
    });

    it("should handle payment_failed status", async () => {
      mockHttpInstance.get.mockResolvedValue({
        data: {
          status: "payment_failed",
          customer_identifier: "cust-failed",
          org_id: "test-org",
          message: "Payment method declined",
        },
      });

      const result = await awsMarketplace.getActivationStatus(
        "test-org",
        "cust-failed"
      );

      expect(result.data.status).toBe("payment_failed");
    });

    it("should propagate errors from the GET request", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Network timeout"));

      await expect(
        awsMarketplace.getActivationStatus("test-org", "cust-timeout")
      ).rejects.toThrow("Network timeout");
    });

    it("should propagate HTTP 404 error", async () => {
      const httpError = {
        response: {
          status: 404,
          data: { message: "Customer not found" },
        },
      };
      mockHttpInstance.get.mockRejectedValue(httpError);

      await expect(
        awsMarketplace.getActivationStatus("test-org", "unknown-cust")
      ).rejects.toEqual(httpError);
    });
  });

  describe("integration tests", () => {
    it("should support full subscription linking and status polling flow", async () => {
      mockHttpInstance.post.mockResolvedValue({
        data: { success: true, customer_identifier: "cust-flow-1" },
      });
      mockHttpInstance.get
        .mockResolvedValueOnce({
          data: {
            status: "pending_activation",
            customer_identifier: "cust-flow-1",
            org_id: "test-org",
          },
        })
        .mockResolvedValueOnce({
          data: {
            status: "active",
            customer_identifier: "cust-flow-1",
            org_id: "test-org",
            activated_at: "2025-03-01T00:00:00Z",
          },
        });

      const linkResult = await awsMarketplace.linkSubscription(
        "test-org",
        "aws-redirect-token"
      );
      expect(linkResult.data.success).toBe(true);
      expect(linkResult.data.customer_identifier).toBe("cust-flow-1");

      const pendingStatus = await awsMarketplace.getActivationStatus(
        "test-org",
        "cust-flow-1"
      );
      expect(pendingStatus.data.status).toBe("pending_activation");

      const activeStatus = await awsMarketplace.getActivationStatus(
        "test-org",
        "cust-flow-1"
      );
      expect(activeStatus.data.status).toBe("active");

      expect(mockHttpInstance.post).toHaveBeenCalledTimes(1);
      expect(mockHttpInstance.get).toHaveBeenCalledTimes(2);
    });
  });
});
