import { describe, it, expect, vi, beforeEach } from "vitest";
import zo_config from "./config";

// Mock http service
vi.mock("./http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
  })),
}));

import http from "./http";

describe("Config Service", () => {
  let mockHttp: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp = {
      get: vi.fn().mockResolvedValue({ data: {} }),
    };
    (http as any).mockReturnValue(mockHttp);
  });

  describe("get_config", () => {
    it("should get configuration with correct URL", async () => {
      await zo_config.get_config();

      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should return configuration data", async () => {
      const expectedConfig = {
        data: {
          version: "1.0.0",
          environment: "production",
          features: {
            authentication: true,
            logging: true,
            metrics: true,
          },
          limits: {
            max_users: 1000,
            max_queries_per_hour: 10000,
            max_storage_gb: 500,
          },
        },
      };

      mockHttp.get.mockResolvedValue(expectedConfig);

      const result = await zo_config.get_config();

      expect(result).toEqual(expectedConfig);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle empty configuration response", async () => {
      const emptyConfig = { data: {} };
      mockHttp.get.mockResolvedValue(emptyConfig);

      const result = await zo_config.get_config();

      expect(result).toEqual(emptyConfig);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle configuration with nested objects", async () => {
      const nestedConfig = {
        data: {
          database: {
            host: "localhost",
            port: 5432,
            credentials: {
              username: "admin",
              encrypted: true,
            },
          },
          services: {
            auth: {
              enabled: true,
              providers: ["google", "github", "ldap"],
              settings: {
                session_timeout: 3600,
                max_attempts: 3,
              },
            },
            monitoring: {
              enabled: true,
              metrics: {
                collection_interval: 30,
                retention_days: 90,
              },
            },
          },
        },
      };

      mockHttp.get.mockResolvedValue(nestedConfig);

      const result = await zo_config.get_config();

      expect(result).toEqual(nestedConfig);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle configuration with arrays", async () => {
      const configWithArrays = {
        data: {
          allowed_origins: [
            "https://app.example.com",
            "https://admin.example.com",
            "https://api.example.com",
          ],
          supported_formats: ["json", "xml", "csv", "parquet"],
          log_levels: ["debug", "info", "warn", "error", "fatal"],
          regional_settings: [
            {
              region: "us-east-1",
              endpoint: "https://us-east.api.example.com",
              backup: true,
            },
            {
              region: "eu-west-1", 
              endpoint: "https://eu-west.api.example.com",
              backup: false,
            },
          ],
        },
      };

      mockHttp.get.mockResolvedValue(configWithArrays);

      const result = await zo_config.get_config();

      expect(result).toEqual(configWithArrays);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle configuration with boolean values", async () => {
      const booleanConfig = {
        data: {
          features: {
            enable_analytics: true,
            enable_debugging: false,
            enable_caching: true,
            enable_compression: false,
            enable_ssl: true,
          },
          security: {
            enforce_https: true,
            allow_cors: false,
            enable_rate_limiting: true,
            require_authentication: true,
          },
        },
      };

      mockHttp.get.mockResolvedValue(booleanConfig);

      const result = await zo_config.get_config();

      expect(result).toEqual(booleanConfig);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle configuration with numeric values", async () => {
      const numericConfig = {
        data: {
          limits: {
            max_connections: 1000,
            timeout_seconds: 30,
            retry_attempts: 3,
            buffer_size: 1024,
            max_file_size_mb: 50,
          },
          performance: {
            cache_ttl: 3600,
            batch_size: 100,
            worker_threads: 4,
            memory_limit_mb: 512,
            cpu_threshold: 0.8,
          },
        },
      };

      mockHttp.get.mockResolvedValue(numericConfig);

      const result = await zo_config.get_config();

      expect(result).toEqual(numericConfig);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle configuration with string values", async () => {
      const stringConfig = {
        data: {
          application: {
            name: "OpenObserve",
            version: "1.2.3",
            environment: "production",
            build_hash: "abc123def456",
            build_date: "2023-12-01T10:30:00Z",
          },
          branding: {
            company_name: "OpenObserve Inc.",
            logo_url: "https://example.com/logo.png",
            primary_color: "#1976d2",
            secondary_color: "#424242",
          },
        },
      };

      mockHttp.get.mockResolvedValue(stringConfig);

      const result = await zo_config.get_config();

      expect(result).toEqual(stringConfig);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle configuration with null values", async () => {
      const nullConfig = {
        data: {
          optional_features: {
            feature_a: null,
            feature_b: "enabled",
            feature_c: null,
          },
          optional_settings: {
            setting_x: null,
            setting_y: 42,
            setting_z: null,
          },
        },
      };

      mockHttp.get.mockResolvedValue(nullConfig);

      const result = await zo_config.get_config();

      expect(result).toEqual(nullConfig);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle large configuration objects", async () => {
      const largeConfig = {
        data: {
          users: Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            username: `user${i + 1}`,
            email: `user${i + 1}@example.com`,
            role: i % 3 === 0 ? "admin" : i % 3 === 1 ? "user" : "viewer",
            settings: {
              theme: i % 2 === 0 ? "dark" : "light",
              notifications: i % 4 === 0,
            },
          })),
          permissions: Array.from({ length: 50 }, (_, i) => ({
            id: i + 1,
            name: `permission_${i + 1}`,
            description: `Description for permission ${i + 1}`,
            category: `category_${Math.floor(i / 10) + 1}`,
          })),
        },
      };

      mockHttp.get.mockResolvedValue(largeConfig);

      const result = await zo_config.get_config();

      expect(result).toEqual(largeConfig);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle configuration with special characters", async () => {
      const specialCharConfig = {
        data: {
          localization: {
            welcome_message: "Welcome to OpenObserve! 🚀",
            error_message: "Oops! Something went wrong: @#$%^&*()",
            success_message: "✅ Configuration updated successfully",
          },
          paths: {
            log_directory: "/var/log/openobserve/",
            config_file: "./config/app.json",
            backup_path: "../backups/",
          },
          patterns: {
            email_regex: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
            url_pattern: "https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}",
          },
        },
      };

      mockHttp.get.mockResolvedValue(specialCharConfig);

      const result = await zo_config.get_config();

      expect(result).toEqual(specialCharConfig);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle error responses", async () => {
      const configError = new Error("Configuration not found");
      mockHttp.get.mockRejectedValue(configError);

      await expect(zo_config.get_config()).rejects.toThrow("Configuration not found");
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle network errors", async () => {
      const networkError = {
        code: "NETWORK_ERROR",
        message: "Failed to fetch configuration",
        name: "NetworkError",
      };
      mockHttp.get.mockRejectedValue(networkError);

      await expect(zo_config.get_config()).rejects.toEqual(networkError);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle HTTP status errors", async () => {
      const httpError = {
        response: {
          status: 500,
          statusText: "Internal Server Error",
          data: {
            error: "Configuration service is temporarily unavailable",
          },
        },
      };
      mockHttp.get.mockRejectedValue(httpError);

      await expect(zo_config.get_config()).rejects.toEqual(httpError);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle timeout errors", async () => {
      const timeoutError = {
        code: "TIMEOUT",
        message: "Configuration request timed out after 5000ms",
      };
      mockHttp.get.mockRejectedValue(timeoutError);

      await expect(zo_config.get_config()).rejects.toEqual(timeoutError);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should be called only once per request", async () => {
      await zo_config.get_config();

      expect(mockHttp.get).toHaveBeenCalledTimes(1);
      expect(mockHttp.get).toHaveBeenCalledWith("/config");
    });

    it("should handle multiple consecutive calls", async () => {
      const configResponses = [
        { data: { version: "1.0" } },
        { data: { version: "1.1" } },
        { data: { version: "1.2" } },
      ];

      mockHttp.get
        .mockResolvedValueOnce(configResponses[0])
        .mockResolvedValueOnce(configResponses[1])
        .mockResolvedValueOnce(configResponses[2]);

      const result1 = await zo_config.get_config();
      const result2 = await zo_config.get_config();
      const result3 = await zo_config.get_config();

      expect(result1).toEqual(configResponses[0]);
      expect(result2).toEqual(configResponses[1]);
      expect(result3).toEqual(configResponses[2]);
      expect(mockHttp.get).toHaveBeenCalledTimes(3);
    });

    it("should maintain URL consistency", async () => {
      await zo_config.get_config();
      await zo_config.get_config();
      await zo_config.get_config();

      expect(mockHttp.get).toHaveBeenCalledTimes(3);
      expect(mockHttp.get).toHaveBeenNthCalledWith(1, "/config");
      expect(mockHttp.get).toHaveBeenNthCalledWith(2, "/config");
      expect(mockHttp.get).toHaveBeenNthCalledWith(3, "/config");
    });
  });
});