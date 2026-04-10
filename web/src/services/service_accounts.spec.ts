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
import service_accounts from "@/services/service_accounts";
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

vi.mock("../aws-exports", () => ({
  default: {},
}));

describe("service_accounts service", () => {
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

  describe("list", () => {
    it("should make GET request to list all service accounts for an org", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { accounts: [] } });

      await service_accounts.list("test-org");

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/service_accounts"
      );
    });

    it("should handle different org identifiers", async () => {
      mockHttpInstance.get.mockResolvedValue({ data: { accounts: [] } });

      const orgs = ["org1", "prod-org", "staging_env"];
      for (const org of orgs) {
        await service_accounts.list(org);
        expect(mockHttpInstance.get).toHaveBeenCalledWith(
          `/api/${org}/service_accounts`
        );
      }
    });

    it("should propagate errors", async () => {
      mockHttpInstance.get.mockRejectedValue(new Error("Unauthorized"));

      await expect(service_accounts.list("test-org")).rejects.toThrow(
        "Unauthorized"
      );
    });
  });

  describe("create", () => {
    it("should make POST request with data payload", async () => {
      const data = { name: "my-service-account", role: "viewer" };
      mockHttpInstance.post.mockResolvedValue({ data: { id: "sa-1" } });

      await service_accounts.create(data, "test-org");

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/service_accounts",
        data
      );
    });

    it("should handle complex data payloads", async () => {
      const data = {
        name: "pipeline-bot",
        email: "pipeline@example.com",
        description: "Service account for pipeline automation",
        role: "admin",
      };
      mockHttpInstance.post.mockResolvedValue({ data: { id: "sa-2" } });

      await service_accounts.create(data, "prod-org");

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/prod-org/service_accounts",
        data
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.post.mockRejectedValue(
        new Error("Email already exists")
      );

      await expect(
        service_accounts.create({ name: "dup" }, "test-org")
      ).rejects.toThrow("Email already exists");
    });
  });

  describe("update", () => {
    it("should make PUT request with data payload and user email in URL", async () => {
      const data = { role: "editor" };
      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await service_accounts.update(data, "test-org", "svc@example.com");

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/service_accounts/svc@example.com",
        data
      );
    });

    it("should handle different update payloads", async () => {
      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      const updates = [
        { role: "admin" },
        { description: "Updated description" },
        { role: "viewer", active: false },
      ];
      for (const update of updates) {
        await service_accounts.update(update, "test-org", "sa@example.com");
        expect(mockHttpInstance.put).toHaveBeenCalledWith(
          "/api/test-org/service_accounts/sa@example.com",
          update
        );
      }
    });

    it("should propagate errors", async () => {
      mockHttpInstance.put.mockRejectedValue(new Error("Not found"));

      await expect(
        service_accounts.update({}, "test-org", "ghost@example.com")
      ).rejects.toThrow("Not found");
    });
  });

  describe("delete", () => {
    it("should make DELETE request with org and user email", async () => {
      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await service_accounts.delete("test-org", "svc@example.com");

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        "/api/test-org/service_accounts/svc@example.com"
      );
    });

    it("should handle different email identifiers", async () => {
      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await service_accounts.delete("prod-org", "bot@company.com");

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        "/api/prod-org/service_accounts/bot@company.com"
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.delete.mockRejectedValue(new Error("Forbidden"));

      await expect(
        service_accounts.delete("test-org", "locked@example.com")
      ).rejects.toThrow("Forbidden");
    });
  });

  describe("bulkDelete", () => {
    it("should make DELETE request with data payload for bulk deletion", async () => {
      const data = {
        emails: ["sa1@example.com", "sa2@example.com"],
      };
      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 2 } });

      await service_accounts.bulkDelete("test-org", data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        "/api/test-org/service_accounts/bulk",
        { data }
      );
    });

    it("should handle empty data", async () => {
      mockHttpInstance.delete.mockResolvedValue({ data: { deleted: 0 } });

      await service_accounts.bulkDelete("test-org", { emails: [] });

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        "/api/test-org/service_accounts/bulk",
        { data: { emails: [] } }
      );
    });

    it("should propagate errors", async () => {
      mockHttpInstance.delete.mockRejectedValue(new Error("Partial failure"));

      await expect(
        service_accounts.bulkDelete("test-org", { emails: ["sa@example.com"] })
      ).rejects.toThrow("Partial failure");
    });
  });

  describe("refresh_token", () => {
    it("should make PUT request with rotateToken=true query param", async () => {
      mockHttpInstance.put.mockResolvedValue({ data: { token: "new-token" } });

      await service_accounts.refresh_token("test-org", "svc@example.com");

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/service_accounts/svc@example.com?rotateToken=true",
        {}
      );
    });

    it("should send empty body with the PUT request", async () => {
      mockHttpInstance.put.mockResolvedValue({ data: { token: "rotated" } });

      await service_accounts.refresh_token("prod-org", "bot@company.com");

      const callArgs = mockHttpInstance.put.mock.calls[0];
      expect(callArgs[1]).toEqual({});
    });

    it("should handle different org and email combinations", async () => {
      mockHttpInstance.put.mockResolvedValue({ data: { token: "tok" } });

      const cases = [
        { org: "org1", email: "svc1@example.com" },
        { org: "prod-env", email: "pipeline@company.io" },
      ];
      for (const { org, email } of cases) {
        await service_accounts.refresh_token(org, email);
        expect(mockHttpInstance.put).toHaveBeenCalledWith(
          `/api/${org}/service_accounts/${email}?rotateToken=true`,
          {}
        );
      }
    });

    it("should propagate errors", async () => {
      mockHttpInstance.put.mockRejectedValue(new Error("Token rotation failed"));

      await expect(
        service_accounts.refresh_token("test-org", "svc@example.com")
      ).rejects.toThrow("Token rotation failed");
    });
  });

  describe("integration tests", () => {
    it("should support full service account lifecycle", async () => {
      const data = { name: "automation-bot", role: "viewer" };
      const email = "automation-bot@example.com";

      mockHttpInstance.post.mockResolvedValue({ data: { id: "sa-1", email } });
      mockHttpInstance.get
        .mockResolvedValueOnce({ data: { accounts: [] } })
        .mockResolvedValueOnce({ data: { token: "initial-token" } });
      mockHttpInstance.put.mockResolvedValue({ data: { token: "rotated-token" } });
      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await service_accounts.create(data, "test-org");
      await service_accounts.list("test-org");
      await service_accounts.refresh_token("test-org", email);
      await service_accounts.delete("test-org", email);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/test-org/service_accounts",
        data
      );
      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/service_accounts"
      );
      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/test-org/service_accounts/${email}?rotateToken=true`,
        {}
      );
      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/test-org/service_accounts/${email}`
      );
    });
  });
});
