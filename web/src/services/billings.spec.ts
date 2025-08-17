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
import billings from "@/services/billings";
import http from "@/services/http";

vi.mock("@/services/http");

describe("Billings Service", () => {
  const mockHttp = vi.mocked(http);
  const mockOrgId = "test-org";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("get_quota_threshold", () => {
    it("should fetch quota threshold for organization", async () => {
      const mockQuotaThreshold = {
        data: {
          threshold: 1000000,
          current_usage: 750000,
          percentage_used: 75
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockQuotaThreshold)
      } as any);

      const result = await billings.get_quota_threshold(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/quota_threshold`
      );
      expect(result).toEqual(mockQuotaThreshold);
    });

    it("should handle quota threshold fetch errors", async () => {
      const mockError = new Error("Failed to fetch quota threshold");

      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(billings.get_quota_threshold(mockOrgId)).rejects.toThrow(
        "Failed to fetch quota threshold"
      );
    });
  });

  describe("create_payment_subscribe", () => {
    it("should create payment subscription", async () => {
      const paymentData = {
        payment_method_id: "pm_123456",
        plan_id: "pro_plan",
        customer_email: "test@example.com"
      };

      const mockResponse = {
        data: {
          subscription_id: "sub_123456",
          status: "active",
          current_period_end: "2024-12-31"
        }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await billings.create_payment_subscribe(mockOrgId, paymentData);

      expect(mockHttp().post).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/payment_source`,
        paymentData
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle payment creation errors", async () => {
      const paymentData = { payment_method_id: "invalid_pm" };
      const mockError = new Error("Invalid payment method");

      mockHttp.mockReturnValue({
        post: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(billings.create_payment_subscribe(mockOrgId, paymentData)).rejects.toThrow(
        "Invalid payment method"
      );
    });
  });

  describe("unsubscribe", () => {
    it("should unsubscribe from billing plan", async () => {
      const mockResponse = {
        data: {
          message: "Successfully unsubscribed",
          effective_date: "2024-01-31"
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await billings.unsubscribe(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/unsubscribe`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("list_subscription", () => {
    it("should fetch subscription list", async () => {
      const mockSubscriptions = {
        data: [
          {
            id: "sub_123",
            plan_name: "Pro Plan",
            status: "active",
            current_period_end: "2024-12-31"
          }
        ]
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockSubscriptions)
      } as any);

      const result = await billings.list_subscription(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/list_subscription`
      );
      expect(result).toEqual(mockSubscriptions);
    });
  });

  describe("list_paymentsources", () => {
    it("should fetch payment sources", async () => {
      const mockPaymentSources = {
        data: [
          {
            id: "pm_123",
            type: "card",
            brand: "visa",
            last4: "4242",
            exp_month: 12,
            exp_year: 2024
          }
        ]
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockPaymentSources)
      } as any);

      const result = await billings.list_paymentsources(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/list_paymentsource`
      );
      expect(result).toEqual(mockPaymentSources);
    });
  });

  describe("resume_subscription", () => {
    it("should resume subscription", async () => {
      const mockResponse = {
        data: {
          message: "Subscription resumed successfully",
          status: "active",
          next_billing_date: "2024-02-01"
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await billings.resume_subscription(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/resume_subscription`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("get_hosted_url", () => {
    it("should get hosted subscription URL", async () => {
      const planName = "pro_plan";
      const mockResponse = {
        data: {
          hosted_url: "https://billing.example.com/subscribe/123",
          expires_at: "2024-01-31T23:59:59Z"
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await billings.get_hosted_url(mockOrgId, planName);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/hosted_subscription_url?plan=${planName}`
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle special characters in plan name", async () => {
      const planName = "pro plan with spaces";
      const encodedPlanName = "pro plan with spaces";

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue({ data: {} })
      } as any);

      await billings.get_hosted_url(mockOrgId, planName);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/hosted_subscription_url?plan=${encodedPlanName}`
      );
    });
  });

  describe("get_session_url", () => {
    it("should get billing portal session URL", async () => {
      const customerId = "cus_123456";
      const mockResponse = {
        data: {
          session_url: "https://billing.example.com/portal/session/123",
          return_url: "https://app.example.com/billing"
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await billings.get_session_url(mockOrgId, customerId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/billing_portal?customer_id=${customerId}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("retrieve_hosted_page", () => {
    it("should retrieve hosted page status", async () => {
      const hostedPageId = "hp_123456";
      const mockResponse = {
        data: {
          id: hostedPageId,
          status: "completed",
          subscription_id: "sub_123456"
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await billings.retrieve_hosted_page(mockOrgId, hostedPageId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/hosted_page_status/${hostedPageId}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("change_payment_detail", () => {
    it("should initiate payment detail change", async () => {
      const hostedPageId = "hp_123456";
      const mockResponse = {
        data: {
          hosted_url: "https://billing.example.com/update-payment/123",
          expires_at: "2024-01-31T23:59:59Z"
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await billings.change_payment_detail(mockOrgId, hostedPageId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/change_payment_detail/${hostedPageId}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("list_invoice_history", () => {
    it("should fetch invoice history", async () => {
      const mockInvoices = {
        data: [
          {
            id: "inv_123",
            amount: 2999,
            currency: "usd",
            status: "paid",
            created_at: "2024-01-01T00:00:00Z",
            pdf_url: "https://billing.example.com/invoices/inv_123.pdf"
          }
        ]
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockInvoices)
      } as any);

      const result = await billings.list_invoice_history(mockOrgId);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/invoices`
      );
      expect(result).toEqual(mockInvoices);
    });
  });

  describe("get_data_usage", () => {
    it("should fetch data usage for specific date and type", async () => {
      const usageDate = "2024-01-01";
      const dataType = "logs";
      const mockUsage = {
        data: {
          date: usageDate,
          data_type: dataType,
          usage_bytes: 1024000000,
          usage_readable: "1.02 GB",
          cost: 0.15
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockUsage)
      } as any);

      const result = await billings.get_data_usage(mockOrgId, usageDate, dataType);

      expect(mockHttp().get).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/data_usage/${usageDate}?data_type=${dataType}`
      );
      expect(result).toEqual(mockUsage);
    });

    it("should handle different data types", async () => {
      const usageDate = "2024-01-01";
      const dataTypes = ["logs", "metrics", "traces"];

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue({ data: {} })
      } as any);

      for (const dataType of dataTypes) {
        await billings.get_data_usage(mockOrgId, usageDate, dataType);
        
        expect(mockHttp().get).toHaveBeenCalledWith(
          `/api/${mockOrgId}/billings/data_usage/${usageDate}?data_type=${dataType}`
        );
      }

      expect(mockHttp().get).toHaveBeenCalledTimes(3);
    });
  });

  describe("submit_new_user_info", () => {
    it("should submit new user attribution info", async () => {
      const userInfoPayload = {
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "winter_sale",
        referrer: "https://google.com",
        user_agent: "Mozilla/5.0..."
      };

      const mockResponse = {
        data: {
          message: "User attribution info saved successfully"
        }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await billings.submit_new_user_info(mockOrgId, userInfoPayload);

      expect(mockHttp().post).toHaveBeenCalledWith(
        `/api/${mockOrgId}/billings/new_user_attribution`,
        userInfoPayload
      );
      expect(result).toEqual(mockResponse);
    });

    it("should handle user info submission errors", async () => {
      const userInfoPayload = { invalid_field: "test" };
      const mockError = new Error("Invalid attribution data");

      mockHttp.mockReturnValue({
        post: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(billings.submit_new_user_info(mockOrgId, userInfoPayload)).rejects.toThrow(
        "Invalid attribution data"
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle network errors across all methods", async () => {
      const networkError = new Error("Network connection failed");
      
      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(networkError),
        post: vi.fn().mockRejectedValue(networkError)
      } as any);

      await expect(billings.get_quota_threshold(mockOrgId)).rejects.toThrow("Network connection failed");
      await expect(billings.list_subscription(mockOrgId)).rejects.toThrow("Network connection failed");
      await expect(billings.create_payment_subscribe(mockOrgId, {})).rejects.toThrow("Network connection failed");
    });

    it("should handle HTTP error responses", async () => {
      const httpError = {
        response: {
          status: 402,
          data: { message: "Payment required" }
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(httpError)
      } as any);

      await expect(billings.get_quota_threshold(mockOrgId)).rejects.toEqual(httpError);
    });

    it("should handle billing service unavailable errors", async () => {
      const serviceError = {
        response: {
          status: 503,
          data: { message: "Billing service temporarily unavailable" }
        }
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(serviceError),
        post: vi.fn().mockRejectedValue(serviceError)
      } as any);

      await expect(billings.list_subscription(mockOrgId)).rejects.toEqual(serviceError);
      await expect(billings.create_payment_subscribe(mockOrgId, {})).rejects.toEqual(serviceError);
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete billing workflow", async () => {
      const paymentData = {
        payment_method_id: "pm_123456",
        plan_id: "pro_plan"
      };

      mockHttp.mockReturnValue({
        get: vi.fn()
          .mockResolvedValueOnce({ data: { threshold: 1000000 } }) // get_quota_threshold
          .mockResolvedValueOnce({ data: [] }) // list_subscription
          .mockResolvedValueOnce({ data: "https://billing.example.com" }) // get_hosted_url
          .mockResolvedValueOnce({ data: [{ id: "inv_123" }] }), // list_invoice_history
        post: vi.fn().mockResolvedValue({ data: { subscription_id: "sub_123" } }) // create_payment_subscribe
      } as any);

      // Check quota threshold
      const quotaResult = await billings.get_quota_threshold(mockOrgId);
      expect(quotaResult.data.threshold).toBe(1000000);

      // Check existing subscriptions
      const subscriptions = await billings.list_subscription(mockOrgId);
      expect(subscriptions.data).toEqual([]);

      // Get hosted URL for subscription
      const hostedUrl = await billings.get_hosted_url(mockOrgId, "pro_plan");
      expect(typeof hostedUrl.data).toBe("string");

      // Create payment subscription
      const paymentResult = await billings.create_payment_subscribe(mockOrgId, paymentData);
      expect(paymentResult.data.subscription_id).toBe("sub_123");

      // Get invoice history
      const invoices = await billings.list_invoice_history(mockOrgId);
      expect(invoices.data).toHaveLength(1);
    });

    it("should handle usage tracking and billing cycle", async () => {
      const usageDate = "2024-01-01";
      const userInfo = {
        utm_source: "organic",
        utm_medium: "search"
      };

      mockHttp.mockReturnValue({
        get: vi.fn()
          .mockResolvedValueOnce({ data: { usage_bytes: 500000000 } }) // get_data_usage logs
          .mockResolvedValueOnce({ data: { usage_bytes: 100000000 } }) // get_data_usage metrics
          .mockResolvedValueOnce({ data: { threshold: 1000000000, current_usage: 600000000 } }), // get_quota_threshold
        post: vi.fn().mockResolvedValue({ data: { message: "Attribution saved" } }) // submit_new_user_info
      } as any);

      // Get usage for different data types
      const logsUsage = await billings.get_data_usage(mockOrgId, usageDate, "logs");
      const metricsUsage = await billings.get_data_usage(mockOrgId, usageDate, "metrics");
      
      expect(logsUsage.data.usage_bytes).toBe(500000000);
      expect(metricsUsage.data.usage_bytes).toBe(100000000);

      // Check quota status
      const quotaStatus = await billings.get_quota_threshold(mockOrgId);
      expect(quotaStatus.data.current_usage).toBe(600000000);

      // Submit user attribution
      const attributionResult = await billings.submit_new_user_info(mockOrgId, userInfo);
      expect(attributionResult.data.message).toBe("Attribution saved");
    });
  });
});