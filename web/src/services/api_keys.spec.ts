import { describe, it, expect, vi, beforeEach } from "vitest";
import apiKeys from "./api_keys";

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

describe("API Keys Service", () => {
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

  describe("list", () => {
    it("should list user API keys with correct URL", async () => {
      await apiKeys.list();

      expect(mockHttp.get).toHaveBeenCalledWith("/api/usertoken");
    });

    it("should handle list API keys request", async () => {
      const expectedResponse = {
        data: [
          {
            id: "1",
            name: "Test API Key",
            token: "token123",
            created_at: "2023-01-01T00:00:00Z",
          },
        ],
      };

      mockHttp.get.mockResolvedValue(expectedResponse);

      const result = await apiKeys.list();

      expect(result).toEqual(expectedResponse);
      expect(mockHttp.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("listRUMTokens", () => {
    it("should list RUM tokens with correct URL and organization", async () => {
      await apiKeys.listRUMTokens("test-org");

      expect(mockHttp.get).toHaveBeenCalledWith("/api/test-org/rumtoken");
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
        await apiKeys.listRUMTokens(org);
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
      }

      expect(mockHttp.get).toHaveBeenCalledTimes(organizations.length);
    });

    it("should handle empty organization string", async () => {
      await apiKeys.listRUMTokens("");

      expect(mockHttp.get).toHaveBeenCalledWith("/api//rumtoken");
    });

    it("should handle organization with special characters", async () => {
      const specialOrgs = [
        "org@domain.com",
        "org#hash",
        "org$dollar",
        "org%percent",
        "org&ampersand",
      ];

      for (const org of specialOrgs) {
        await apiKeys.listRUMTokens(org);
        expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
      }
    });
  });

  describe("createUserAPIKey", () => {
    it("should create user API key with correct URL and data", async () => {
      const apiKeyData = {
        name: "New API Key",
        permissions: ["read", "write"],
      };

      await apiKeys.createUserAPIKey(apiKeyData);

      expect(mockHttp.post).toHaveBeenCalledWith("/api/usertoken", apiKeyData);
    });

    it("should handle different API key data structures", async () => {
      const apiKeyConfigs = [
        {
          name: "Basic Key",
          description: "Basic API key",
        },
        {
          name: "Advanced Key",
          description: "Advanced API key with permissions",
          permissions: ["read", "write", "admin"],
          expiry: "2024-12-31T23:59:59Z",
        },
        {
          name: "Limited Key",
          permissions: ["read"],
          rate_limit: 1000,
          ip_whitelist: ["192.168.1.1", "10.0.0.1"],
        },
      ];

      for (const config of apiKeyConfigs) {
        await apiKeys.createUserAPIKey(config);
        expect(mockHttp.post).toHaveBeenCalledWith("/api/usertoken", config);
      }
    });

    it("should handle empty data object", async () => {
      await apiKeys.createUserAPIKey({});

      expect(mockHttp.post).toHaveBeenCalledWith("/api/usertoken", {});
    });

    it("should handle complex API key configuration", async () => {
      const complexConfig = {
        name: "Complex API Key",
        description: "A complex API key with all features",
        permissions: ["read", "write", "delete", "admin"],
        expiry_date: "2024-12-31T23:59:59Z",
        rate_limits: {
          requests_per_minute: 100,
          requests_per_hour: 1000,
          requests_per_day: 10000,
        },
        restrictions: {
          ip_whitelist: ["192.168.1.0/24", "10.0.0.0/8"],
          allowed_endpoints: ["/api/v1/*", "/api/v2/read/*"],
          forbidden_endpoints: ["/api/admin/*"],
        },
        metadata: {
          created_by: "admin@company.com",
          purpose: "automation",
          team: "devops",
        },
      };

      await apiKeys.createUserAPIKey(complexConfig);

      expect(mockHttp.post).toHaveBeenCalledWith("/api/usertoken", complexConfig);
    });

    it("should handle API key data with special characters", async () => {
      const specialData = {
        name: "Key with special chars: !@#$%^&*()",
        description: "Description with unicode: 🔑 and symbols: <>?",
        tags: ["tag-with-dash", "tag_with_underscore", "tag.with.dot"],
      };

      await apiKeys.createUserAPIKey(specialData);

      expect(mockHttp.post).toHaveBeenCalledWith("/api/usertoken", specialData);
    });
  });

  describe("updateUserAPIKey", () => {
    it("should update user API key with correct URL and data", async () => {
      const updateData = {
        id: "key-123",
        name: "Updated API Key",
        permissions: ["read", "write"],
      };

      await apiKeys.updateUserAPIKey(updateData);

      expect(mockHttp.put).toHaveBeenCalledWith("/api/usertoken/key-123", updateData);
    });

    it("should handle different key ID formats", async () => {
      const keyIds = [
        "simple-key",
        "key-uuid-12345-67890",
        123456789,
        "UPPERCASE_KEY",
        "key_with_underscores",
        "key.with.dots",
      ];

      for (const keyId of keyIds) {
        const updateData = { id: keyId, name: "Updated Name" };
        await apiKeys.updateUserAPIKey(updateData);
        expect(mockHttp.put).toHaveBeenCalledWith(`/api/usertoken/${keyId}`, updateData);
      }
    });

    it("should handle partial updates", async () => {
      const partialUpdates = [
        { id: "key1", name: "New Name Only" },
        { id: "key2", description: "New Description Only" },
        { id: "key3", permissions: ["read"] },
        { id: "key4", expiry: "2024-12-31T23:59:59Z" },
        { id: "key5", rate_limit: 500 },
      ];

      for (const update of partialUpdates) {
        await apiKeys.updateUserAPIKey(update);
        expect(mockHttp.put).toHaveBeenCalledWith(`/api/usertoken/${update.id}`, update);
      }
    });

    it("should handle update with complex data", async () => {
      const complexUpdate = {
        id: "complex-key",
        name: "Complex Updated Key",
        description: "Updated complex API key",
        permissions: ["read", "write", "admin"],
        settings: {
          rate_limits: {
            requests_per_minute: 200,
            burst_limit: 50,
          },
          security: {
            ip_whitelist: ["192.168.1.0/24"],
            require_https: true,
            allowed_origins: ["https://app.example.com"],
          },
        },
        metadata: {
          last_updated_by: "admin@company.com",
          update_reason: "security policy change",
          version: 2,
        },
      };

      await apiKeys.updateUserAPIKey(complexUpdate);

      expect(mockHttp.put).toHaveBeenCalledWith("/api/usertoken/complex-key", complexUpdate);
    });

    it("should handle update with only ID", async () => {
      const minimalUpdate = { id: "minimal-key" };

      await apiKeys.updateUserAPIKey(minimalUpdate);

      expect(mockHttp.put).toHaveBeenCalledWith("/api/usertoken/minimal-key", minimalUpdate);
    });
  });

  describe("createRUMToken", () => {
    it("should create RUM token with correct URL", async () => {
      await apiKeys.createRUMToken("test-org");

      expect(mockHttp.post).toHaveBeenCalledWith("/api/test-org/rumtoken");
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
        await apiKeys.createRUMToken(org);
        expect(mockHttp.post).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
      }

      expect(mockHttp.post).toHaveBeenCalledTimes(organizations.length);
    });

    it("should handle empty organization string", async () => {
      await apiKeys.createRUMToken("");

      expect(mockHttp.post).toHaveBeenCalledWith("/api//rumtoken");
    });

    it("should handle organization with special characters", async () => {
      const specialOrgs = [
        "org@domain.com",
        "org#hash",
        "org$dollar", 
        "org%percent",
        "org&ampersand",
      ];

      for (const org of specialOrgs) {
        await apiKeys.createRUMToken(org);
        expect(mockHttp.post).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
      }
    });
  });

  describe("updateRUMToken", () => {
    it("should update RUM token with correct URL", async () => {
      await apiKeys.updateRUMToken("test-org", "token-123");

      expect(mockHttp.put).toHaveBeenCalledWith("/api/test-org/rumtoken");
    });

    it("should handle different organization and token ID combinations", async () => {
      const testCases = [
        { org: "org1", tokenId: "token1" },
        { org: "production-env", tokenId: "rum-token-uuid-123" },
        { org: "dev", tokenId: "999" },
        { org: "test_org", tokenId: "RUM_TOKEN_UPPERCASE" },
      ];

      for (const { org, tokenId } of testCases) {
        await apiKeys.updateRUMToken(org, tokenId);
        expect(mockHttp.put).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
      }
    });

    it("should handle empty parameters", async () => {
      await apiKeys.updateRUMToken("", "");

      expect(mockHttp.put).toHaveBeenCalledWith("/api//rumtoken");
    });

    it("should handle special characters in organization", async () => {
      const specialOrgs = [
        "org@domain.com",
        "org#hash",
        "org$dollar",
        "org%percent",
        "org&ampersand",
      ];

      for (const org of specialOrgs) {
        await apiKeys.updateRUMToken(org, "token-123");
        expect(mockHttp.put).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
      }
    });

    it("should handle different token ID formats", async () => {
      const tokenIds = [
        "simple-token",
        "token-uuid-12345-67890",
        123456789,
        "UPPERCASE_TOKEN",
        "token_with_underscores",
        "token.with.dots",
      ];

      for (const tokenId of tokenIds) {
        await apiKeys.updateRUMToken("test-org", tokenId);
        // Note: The current implementation doesn't use the tokenId in the URL
        expect(mockHttp.put).toHaveBeenCalledWith("/api/test-org/rumtoken");
      }
    });
  });

  describe("deleteUserAPIKey", () => {
    it("should delete user API key with correct URL", async () => {
      await apiKeys.deleteUserAPIKey("key-123");

      expect(mockHttp.delete).toHaveBeenCalledWith("/api/usertoken/key-123");
    });

    it("should handle different key ID formats", async () => {
      const keyIds = [
        "simple-key",
        "key-uuid-12345-67890",
        "123456789",
        "UPPERCASE_KEY",
        "key_with_underscores",
        "key.with.dots",
      ];

      for (const keyId of keyIds) {
        await apiKeys.deleteUserAPIKey(keyId);
        expect(mockHttp.delete).toHaveBeenCalledWith(`/api/usertoken/${keyId}`);
      }

      expect(mockHttp.delete).toHaveBeenCalledTimes(keyIds.length);
    });

    it("should handle empty key ID", async () => {
      await apiKeys.deleteUserAPIKey("");

      expect(mockHttp.delete).toHaveBeenCalledWith("/api/usertoken/");
    });

    it("should handle key IDs with special characters", async () => {
      const specialKeyIds = [
        "key@special.com",
        "key#hash",
        "key$dollar",
        "key%percent",
        "key&ampersand",
        "key with spaces",
      ];

      for (const keyId of specialKeyIds) {
        await apiKeys.deleteUserAPIKey(keyId);
        expect(mockHttp.delete).toHaveBeenCalledWith(`/api/usertoken/${keyId}`);
      }
    });

    it("should handle numeric key IDs", async () => {
      const numericKeyIds = [1, 123, 456789, 0, -1];

      for (const keyId of numericKeyIds) {
        await apiKeys.deleteUserAPIKey(keyId.toString());
        expect(mockHttp.delete).toHaveBeenCalledWith(`/api/usertoken/${keyId}`);
      }
    });
  });

  describe("Integration tests", () => {
    it("should handle complete API key lifecycle", async () => {
      const keyData = { name: "Test Key", permissions: ["read"] };
      const updateData = { id: "key-123", name: "Updated Test Key" };

      // Create
      await apiKeys.createUserAPIKey(keyData);
      
      // List 
      await apiKeys.list();
      
      // Update
      await apiKeys.updateUserAPIKey(updateData);
      
      // Delete
      await apiKeys.deleteUserAPIKey("key-123");

      expect(mockHttp.post).toHaveBeenCalledWith("/api/usertoken", keyData);
      expect(mockHttp.get).toHaveBeenCalledWith("/api/usertoken");
      expect(mockHttp.put).toHaveBeenCalledWith("/api/usertoken/key-123", updateData);
      expect(mockHttp.delete).toHaveBeenCalledWith("/api/usertoken/key-123");
    });

    it("should handle RUM token operations", async () => {
      const org = "test-org";
      const tokenId = "rum-token-123";

      // List RUM tokens
      await apiKeys.listRUMTokens(org);
      
      // Create RUM token
      await apiKeys.createRUMToken(org);
      
      // Update RUM token  
      await apiKeys.updateRUMToken(org, tokenId);

      expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
      expect(mockHttp.post).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
      expect(mockHttp.put).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
    });

    it("should maintain URL consistency across all methods", async () => {
      const org = "consistent-org";
      const keyId = "test-key";
      const keyData = { name: "Test" };

      await apiKeys.list();
      await apiKeys.createUserAPIKey(keyData);
      await apiKeys.updateUserAPIKey({ id: keyId, ...keyData });
      await apiKeys.deleteUserAPIKey(keyId);
      await apiKeys.listRUMTokens(org);
      await apiKeys.createRUMToken(org);
      await apiKeys.updateRUMToken(org, "rum-token");

      // Verify user token endpoints use consistent pattern
      expect(mockHttp.get).toHaveBeenCalledWith("/api/usertoken");
      expect(mockHttp.post).toHaveBeenCalledWith("/api/usertoken", keyData);
      expect(mockHttp.put).toHaveBeenCalledWith(`/api/usertoken/${keyId}`, { id: keyId, ...keyData });
      expect(mockHttp.delete).toHaveBeenCalledWith(`/api/usertoken/${keyId}`);

      // Verify RUM token endpoints use consistent pattern
      expect(mockHttp.get).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
      expect(mockHttp.post).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
      expect(mockHttp.put).toHaveBeenCalledWith(`/api/${org}/rumtoken`);
    });

    it("should handle multiple organizations with different token types", async () => {
      const organizations = ["org1", "org2", "org3"];

      for (const org of organizations) {
        // RUM operations for each org
        await apiKeys.listRUMTokens(org);
        await apiKeys.createRUMToken(org);
        await apiKeys.updateRUMToken(org, `token-${org}`);
      }

      // User API key operations (organization independent)
      await apiKeys.list();
      await apiKeys.createUserAPIKey({ name: "Multi-org key" });

      expect(mockHttp.get).toHaveBeenCalledTimes(4); // 3 RUM lists + 1 user token list
      expect(mockHttp.post).toHaveBeenCalledTimes(4); // 3 RUM creates + 1 user token create  
      expect(mockHttp.put).toHaveBeenCalledTimes(3); // 3 RUM updates
    });
  });
});