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
import cipherKeys from "@/services/cipher_keys";
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

describe("cipher_keys service", () => {
  let mockHttpInstance: any;

  const mockCipherKeyData = {
    name: "my-cipher-key",
    key: {
      store: {
        akeyless: {
          access_id: "access-id-123",
          base_url: "https://api.akeyless.io",
          auth: {
            type: "access_key",
            access_key: "my-access-key",
            ldap: {
              username: "ldap-user",
              password: "ldap-pass",
            },
          },
          store: {
            type: "static_secret",
            static_secret: "/path/to/secret",
            dfc: {
              name: "my-dfc",
              iv: "initialization-vector",
              encrypted_data: "encrypted-data-here",
            },
          },
        },
      },
    },
    provider: { type: "akeyless" },
  };

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

  describe("create", () => {
    it("should make POST request to create a cipher key", async () => {
      const org_identifier = "org123";

      mockHttpInstance.post.mockResolvedValue({ data: { id: "key-new-1" } });

      await cipherKeys.create(org_identifier, mockCipherKeyData);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/cipher_keys`,
        mockCipherKeyData
      );
    });

    it("should pass the cipher key data as the POST body", async () => {
      const org_identifier = "staging-org";

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await cipherKeys.create(org_identifier, mockCipherKeyData);

      const callArgs = mockHttpInstance.post.mock.calls[0];
      expect(callArgs[1]).toEqual(mockCipherKeyData);
    });

    it("should use the org_identifier in the URL path", async () => {
      const org_identifier = "production-org";

      mockHttpInstance.post.mockResolvedValue({ data: {} });

      await cipherKeys.create(org_identifier, mockCipherKeyData);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/production-org/cipher_keys`,
        expect.any(Object)
      );
    });
  });

  describe("update", () => {
    it("should make PUT request to update a cipher key by name", async () => {
      const org_identifier = "org123";
      const name = "my-cipher-key";

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await cipherKeys.update(org_identifier, mockCipherKeyData, name);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${org_identifier}/cipher_keys/${name}`,
        mockCipherKeyData
      );
    });

    it("should use the name parameter in the URL path", async () => {
      const org_identifier = "staging-org";
      const name = "another-key";

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await cipherKeys.update(org_identifier, mockCipherKeyData, name);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/staging-org/cipher_keys/another-key`,
        mockCipherKeyData
      );
    });

    it("should send the updated cipher key data as the PUT body", async () => {
      const org_identifier = "org123";
      const name = "key-to-update";
      const updatedData = { ...mockCipherKeyData, name: "updated-name" };

      mockHttpInstance.put.mockResolvedValue({ data: {} });

      await cipherKeys.update(org_identifier, updatedData, name);

      const callArgs = mockHttpInstance.put.mock.calls[0];
      expect(callArgs[1]).toEqual(updatedData);
    });
  });

  describe("list", () => {
    it("should make GET request to list all cipher keys for an org", async () => {
      const org_identifier = "org123";

      mockHttpInstance.get.mockResolvedValue({ data: { keys: [] } });

      await cipherKeys.list(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/cipher_keys`
      );
    });

    it("should use the org_identifier in the URL path", async () => {
      const org_identifier = "production-org";

      mockHttpInstance.get.mockResolvedValue({ data: { keys: [{ name: "key1" }] } });

      await cipherKeys.list(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/production-org/cipher_keys`
      );
    });
  });

  describe("get_by_name", () => {
    it("should make GET request to fetch a specific cipher key by name", async () => {
      const org_identifier = "org123";
      const name = "my-cipher-key";

      mockHttpInstance.get.mockResolvedValue({ data: mockCipherKeyData });

      await cipherKeys.get_by_name(org_identifier, name);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/cipher_keys/${name}`
      );
    });

    it("should use the name parameter in the URL path", async () => {
      const org_identifier = "staging-org";
      const name = "specific-key-123";

      mockHttpInstance.get.mockResolvedValue({ data: {} });

      await cipherKeys.get_by_name(org_identifier, name);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/staging-org/cipher_keys/specific-key-123`
      );
    });
  });

  describe("delete", () => {
    it("should make DELETE request to remove a cipher key by name", async () => {
      const org_identifier = "org123";
      const name = "my-cipher-key";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await cipherKeys.delete(org_identifier, name);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/cipher_keys/${name}`
      );
    });

    it("should use the name parameter in the URL path for DELETE", async () => {
      const org_identifier = "prod-org";
      const name = "key-to-remove";

      mockHttpInstance.delete.mockResolvedValue({ data: {} });

      await cipherKeys.delete(org_identifier, name);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/prod-org/cipher_keys/key-to-remove`
      );
    });
  });

  describe("bulkDelete", () => {
    it("should make DELETE request to bulk delete cipher keys", async () => {
      const org_identifier = "org123";
      const data = { key_names: ["key1", "key2", "key3"] };

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await cipherKeys.bulkDelete(org_identifier, data);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/cipher_keys/bulk`,
        { data }
      );
    });

    it("should wrap the data in a data property for the DELETE config", async () => {
      const org_identifier = "staging-org";
      const data = { key_names: ["cipher-key-abc"] };

      mockHttpInstance.delete.mockResolvedValue({ data: {} });

      await cipherKeys.bulkDelete(org_identifier, data);

      const callArgs = mockHttpInstance.delete.mock.calls[0];
      expect(callArgs[0]).toBe(`/api/${org_identifier}/cipher_keys/bulk`);
      expect(callArgs[1]).toEqual({ data });
    });
  });

  describe("error handling", () => {
    it("should propagate errors from create", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        cipherKeys.create("org123", mockCipherKeyData)
      ).rejects.toThrow("Validation error");
    });

    it("should propagate errors from update", async () => {
      const error = new Error("Not found");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        cipherKeys.update("org123", mockCipherKeyData, "missing-key")
      ).rejects.toThrow("Not found");
    });

    it("should propagate errors from list", async () => {
      const error = new Error("Network error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(cipherKeys.list("org123")).rejects.toThrow("Network error");
    });

    it("should propagate errors from get_by_name", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        cipherKeys.get_by_name("org123", "protected-key")
      ).rejects.toThrow("Unauthorized");
    });

    it("should propagate errors from delete", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        cipherKeys.delete("org123", "locked-key")
      ).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from bulkDelete", async () => {
      const error = new Error("Server error");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        cipherKeys.bulkDelete("org123", { key_names: ["key1"] })
      ).rejects.toThrow("Server error");
    });
  });
});
