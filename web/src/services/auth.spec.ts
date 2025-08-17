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
import auth from "@/services/auth";
import http from "@/services/http";

vi.mock("@/services/http");

describe("Auth Service", () => {
  const mockHttp = vi.mocked(http);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sign_in_user", () => {
    it("should make POST request to login endpoint", async () => {
      const loginData = {
        email: "test@example.com",
        password: "password123"
      };

      const mockResponse = {
        data: {
          token: "mock-token",
          user: {
            id: 1,
            email: "test@example.com"
          }
        }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await auth.sign_in_user(loginData);

      expect(mockHttp().post).toHaveBeenCalledWith("/auth/login", loginData);
      expect(result).toEqual(mockResponse);
    });

    it("should handle login errors", async () => {
      const loginData = {
        email: "test@example.com",
        password: "wrongpassword"
      };

      const mockError = new Error("Invalid credentials");

      mockHttp.mockReturnValue({
        post: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(auth.sign_in_user(loginData)).rejects.toThrow("Invalid credentials");
      expect(mockHttp().post).toHaveBeenCalledWith("/auth/login", loginData);
    });
  });

  describe("get_dex_login", () => {
    it("should fetch dex login configuration", async () => {
      const mockConfig = {
        enabled: true,
        provider_url: "https://dex.example.com"
      };

      const mockResponse = {
        data: mockConfig
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await auth.get_dex_login();

      expect(mockHttp().get).toHaveBeenCalledWith("/config/dex_login");
      expect(result).toEqual(mockConfig);
    });

    it("should handle dex config fetch errors", async () => {
      const mockError = new Error("Config not found");

      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(auth.get_dex_login()).rejects.toThrow("Config not found");
      expect(mockHttp().get).toHaveBeenCalledWith("/config/dex_login");
    });
  });

  describe("refresh_token", () => {
    it("should refresh authentication token", async () => {
      const mockRefreshData = {
        token: "new-token",
        expires_at: "2024-12-31T23:59:59Z"
      };

      const mockResponse = {
        data: mockRefreshData
      };

      mockHttp.mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse)
      } as any);

      const result = await auth.refresh_token();

      expect(mockHttp().get).toHaveBeenCalledWith("/config/dex_refresh");
      expect(result).toEqual(mockRefreshData);
    });

    it("should handle token refresh errors", async () => {
      const mockError = new Error("Token expired");

      mockHttp.mockReturnValue({
        get: vi.fn().mockRejectedValue(mockError)
      } as any);

      await expect(auth.refresh_token()).rejects.toThrow("Token expired");
      expect(mockHttp().get).toHaveBeenCalledWith("/config/dex_refresh");
    });
  });

  describe("Error Handling", () => {
    it("should handle network errors", async () => {
      const networkError = {
        code: "NETWORK_ERROR",
        message: "Network request failed"
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockRejectedValue(networkError),
        get: vi.fn().mockRejectedValue(networkError)
      } as any);

      await expect(auth.sign_in_user({ email: "test@example.com", password: "test" }))
        .rejects.toEqual(networkError);
      
      await expect(auth.get_dex_login()).rejects.toEqual(networkError);
      await expect(auth.refresh_token()).rejects.toEqual(networkError);
    });

    it("should handle HTTP status errors", async () => {
      const httpError = {
        response: {
          status: 401,
          data: { message: "Unauthorized" }
        }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockRejectedValue(httpError)
      } as any);

      await expect(auth.sign_in_user({ email: "test@example.com", password: "test" }))
        .rejects.toEqual(httpError);
    });
  });

  describe("Integration Tests", () => {
    it("should handle successful auth flow", async () => {
      const loginData = { email: "test@example.com", password: "password123" };
      
      const mockLoginResponse = {
        data: { token: "access-token", user: { id: 1, email: "test@example.com" } }
      };
      
      const mockDexConfig = {
        data: { enabled: false }
      };

      mockHttp.mockReturnValue({
        post: vi.fn().mockResolvedValue(mockLoginResponse),
        get: vi.fn().mockResolvedValue(mockDexConfig)
      } as any);

      const loginResult = await auth.sign_in_user(loginData);
      const dexConfig = await auth.get_dex_login();

      expect(loginResult.data.token).toBe("access-token");
      expect(dexConfig.enabled).toBe(false);
    });
  });
});