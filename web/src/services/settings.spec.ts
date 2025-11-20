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

import { describe, expect, it, beforeEach, vi } from "vitest";
import settings from "@/services/settings";
import http from "@/services/http";

// Mock the http service
vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    post: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("settings service", () => {
  let mockHttpInstance: any;
  let mockHttpWithHeaders: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockHttpInstance = {
      post: vi.fn(),
      delete: vi.fn(),
    };
    
    mockHttpWithHeaders = {
      post: vi.fn(),
      delete: vi.fn(),
    };

    // Mock http function to return different instances based on headers
    (http as any).mockImplementation((headers?: any) => {
      if (headers && headers["Content-Type"] === "multipart/form-data") {
        return mockHttpWithHeaders;
      }
      return mockHttpInstance;
    });
  });

  describe("createLogo", () => {
    it("should make POST request with multipart form data headers and default theme", async () => {
      const params = {
        org_identifier: "org123",
        formData: new FormData(),
      };

      // Add some data to FormData for testing
      params.formData.append("logo", new Blob(["test"], { type: "image/png" }), "logo.png");

      mockHttpWithHeaders.post.mockResolvedValue({ data: { success: true } });

      await settings.createLogo(params.org_identifier, params.formData);

      // Verify http was called with correct headers
      expect(http).toHaveBeenCalledWith({
        "Content-Type": "multipart/form-data",
      });

      // Verify POST request was made with correct URL and form data (default theme is 'light')
      expect(mockHttpWithHeaders.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/settings/logo?theme=light`,
        params.formData
      );
    });

    it("should make POST request with dark theme parameter", async () => {
      const params = {
        org_identifier: "org123",
        formData: new FormData(),
        theme: "dark",
      };

      params.formData.append("logo", new Blob(["test"], { type: "image/png" }), "logo.png");

      mockHttpWithHeaders.post.mockResolvedValue({ data: { success: true } });

      await settings.createLogo(params.org_identifier, params.formData, params.theme);

      expect(http).toHaveBeenCalledWith({
        "Content-Type": "multipart/form-data",
      });

      expect(mockHttpWithHeaders.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/settings/logo?theme=dark`,
        params.formData
      );
    });

    it("should handle empty FormData", async () => {
      const params = {
        org_identifier: "org123",
        formData: new FormData(),
      };

      mockHttpWithHeaders.post.mockResolvedValue({ data: { success: true } });

      await settings.createLogo(params.org_identifier, params.formData);

      expect(mockHttpWithHeaders.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/settings/logo?theme=light`,
        params.formData
      );
    });

    it("should handle API errors gracefully", async () => {
      const params = {
        org_identifier: "org123",
        formData: new FormData(),
      };

      const error = new Error("File too large");
      mockHttpWithHeaders.post.mockRejectedValue(error);

      await expect(
        settings.createLogo(params.org_identifier, params.formData)
      ).rejects.toThrow("File too large");
    });
  });

  describe("deleteLogo", () => {
    it("should make DELETE request to remove logo with default theme", async () => {
      const org_identifier = "org123";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await settings.deleteLogo(org_identifier);

      // Verify http was called without headers
      expect(http).toHaveBeenCalledWith();

      // Verify DELETE request was made with correct URL (default theme is 'light')
      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/settings/logo?theme=light`
      );
    });

    it("should make DELETE request with dark theme parameter", async () => {
      const org_identifier = "org123";
      const theme = "dark";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await settings.deleteLogo(org_identifier, theme);

      expect(http).toHaveBeenCalledWith();

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/settings/logo?theme=dark`
      );
    });

    it("should handle API errors gracefully", async () => {
      const org_identifier = "org123";
      const error = new Error("Not found");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(settings.deleteLogo(org_identifier)).rejects.toThrow("Not found");
    });

    it("should handle forbidden access error", async () => {
      const org_identifier = "org123";
      const error = new Error("Forbidden");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(settings.deleteLogo(org_identifier)).rejects.toThrow("Forbidden");
    });
  });

  describe("updateCustomText", () => {
    it("should make POST request to update custom text", async () => {
      const params = {
        org_identifier: "org123",
        key: "welcome_message",
        value: "Welcome to our platform!",
      };

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await settings.updateCustomText(
        params.org_identifier,
        params.key,
        params.value
      );

      // Verify http was called without headers
      expect(http).toHaveBeenCalledWith();

      // Verify POST request was made with correct URL and value
      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/settings/logo/text`,
        params.value
      );
    });

    it("should handle empty value", async () => {
      const params = {
        org_identifier: "org123",
        key: "welcome_message",
        value: "",
      };

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await settings.updateCustomText(
        params.org_identifier,
        params.key,
        params.value
      );

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/settings/logo/text`,
        params.value
      );
    });

    it("should handle long text values", async () => {
      const params = {
        org_identifier: "org123",
        key: "description",
        value: "A".repeat(1000), // Long string
      };

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await settings.updateCustomText(
        params.org_identifier,
        params.key,
        params.value
      );

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/settings/logo/text`,
        params.value
      );
    });

    it("should handle special characters in text", async () => {
      const params = {
        org_identifier: "org123",
        key: "message",
        value: "Hello! @#$%^&*()_+{}|:<>?[];',./~`",
      };

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await settings.updateCustomText(
        params.org_identifier,
        params.key,
        params.value
      );

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/settings/logo/text`,
        params.value
      );
    });

    it("should handle unicode characters in text", async () => {
      const params = {
        org_identifier: "org123",
        key: "multilingual_message",
        value: "Hello 你好 こんにちは 🌍",
      };

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await settings.updateCustomText(
        params.org_identifier,
        params.key,
        params.value
      );

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_identifier}/settings/logo/text`,
        params.value
      );
    });

    it("should handle API errors gracefully", async () => {
      const params = {
        org_identifier: "org123",
        key: "message",
        value: "Test message",
      };

      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        settings.updateCustomText(
          params.org_identifier,
          params.key,
          params.value
        )
      ).rejects.toThrow("Validation error");
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete logo management workflow", async () => {
      const org_identifier = "org123";
      const formData = new FormData();
      formData.append("logo", new Blob(["logo"], { type: "image/png" }), "logo.png");

      // Mock successful create
      mockHttpWithHeaders.post.mockResolvedValue({ data: { success: true } });

      // Mock successful delete
      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      // Create logo
      await settings.createLogo(org_identifier, formData);

      // Delete logo
      await settings.deleteLogo(org_identifier);

      expect(mockHttpWithHeaders.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/settings/logo?theme=light`,
        formData
      );

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/settings/logo?theme=light`
      );
    });

    it("should handle complete dark mode logo management workflow", async () => {
      const org_identifier = "org123";
      const formData = new FormData();
      formData.append("logo", new Blob(["logo-dark"], { type: "image/png" }), "logo-dark.png");

      // Mock successful create
      mockHttpWithHeaders.post.mockResolvedValue({ data: { success: true } });

      // Mock successful delete
      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      // Create dark logo
      await settings.createLogo(org_identifier, formData, "dark");

      // Delete dark logo
      await settings.deleteLogo(org_identifier, "dark");

      expect(mockHttpWithHeaders.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/settings/logo?theme=dark`,
        formData
      );

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/settings/logo?theme=dark`
      );
    });

    it("should handle text customization after logo setup", async () => {
      const org_identifier = "org123";
      const customText = "Custom Organization Name";

      mockHttpInstance.post.mockResolvedValue({ data: { success: true } });

      await settings.updateCustomText(org_identifier, "org_name", customText);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/settings/logo/text`,
        customText
      );
    });
  });
});