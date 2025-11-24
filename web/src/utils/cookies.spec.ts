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

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSidebarStatus,
  setSidebarStatus,
  getLanguage,
  setLanguage,
  getSize,
  setSize,
  getToken,
  setToken,
  removeToken,
} from "./cookies";

// Mock js-cookie
vi.mock("js-cookie", () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

// Mock Keys constant
vi.mock("../constants/key", () => ({
  default: {
    sidebarStatusKey: "vue3-typescript-admin-sidebarStatusKey",
    languageKey: "vue3-typescript-admin-languageKey",
    sizeKey: "vue3-typescript-admin-sizeKey",
    tokenKey: "vue3-typescript-admin-access-token",
    aseKey: "vue3-typescript-admin-ase-key",
  },
}));

import Cookies from "js-cookie";
import Keys from "../constants/key";

describe("Cookie Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSidebarStatus", () => {
    it("should get sidebar status from cookies", () => {
      const mockStatus = "collapsed";
      (Cookies.get as any).mockReturnValue(mockStatus);

      const result = getSidebarStatus();

      expect(Cookies.get).toHaveBeenCalledWith(Keys.sidebarStatusKey);
      expect(result).toBe(mockStatus);
    });

    it("should return undefined when sidebar status is not set", () => {
      (Cookies.get as any).mockReturnValue(undefined);

      const result = getSidebarStatus();

      expect(Cookies.get).toHaveBeenCalledWith(Keys.sidebarStatusKey);
      expect(result).toBeUndefined();
    });
  });

  describe("setSidebarStatus", () => {
    it("should set sidebar status in cookies", () => {
      const status = "expanded";

      setSidebarStatus(status);

      expect(Cookies.set).toHaveBeenCalledWith(
        Keys.sidebarStatusKey,
        status,
        { path: "/" }
      );
    });

    it("should set sidebar status with collapsed value", () => {
      const status = "collapsed";

      setSidebarStatus(status);

      expect(Cookies.set).toHaveBeenCalledWith(
        Keys.sidebarStatusKey,
        status,
        { path: "/" }
      );
    });

    it("should handle empty string status", () => {
      const status = "";

      setSidebarStatus(status);

      expect(Cookies.set).toHaveBeenCalledWith(
        Keys.sidebarStatusKey,
        status,
        { path: "/" }
      );
    });
  });

  describe("getLanguage", () => {
    it("should get language from cookies", () => {
      const mockLanguage = "en";
      (Cookies.get as any).mockReturnValue(mockLanguage);

      const result = getLanguage();

      expect(Cookies.get).toHaveBeenCalledWith(Keys.languageKey);
      expect(result).toBe(mockLanguage);
    });

    it("should return undefined when language is not set", () => {
      (Cookies.get as any).mockReturnValue(undefined);

      const result = getLanguage();

      expect(Cookies.get).toHaveBeenCalledWith(Keys.languageKey);
      expect(result).toBeUndefined();
    });

    it("should handle different language codes", () => {
      const languages = ["en", "es", "fr", "de", "zh"];

      languages.forEach(lang => {
        (Cookies.get as any).mockReturnValue(lang);
        const result = getLanguage();
        expect(result).toBe(lang);
      });

      expect(Cookies.get).toHaveBeenCalledTimes(languages.length);
    });
  });

  describe("setLanguage", () => {
    it("should set language in cookies", () => {
      const language = "en";

      setLanguage(language);

      expect(Cookies.set).toHaveBeenCalledWith(
        Keys.languageKey,
        language,
        { path: "/", expires: 400 }
      );
    });

    it("should handle different language codes", () => {
      const languages = ["en", "es", "fr", "de", "zh"];

      languages.forEach(lang => {
        setLanguage(lang);
        expect(Cookies.set).toHaveBeenCalledWith(
          Keys.languageKey,
          lang,
          { path: "/", expires: 400 }
        );
      });

      expect(Cookies.set).toHaveBeenCalledTimes(languages.length);
    });

    it("should handle empty string language", () => {
      const language = "";

      setLanguage(language);

      expect(Cookies.set).toHaveBeenCalledWith(
        Keys.languageKey,
        language,
        { path: "/", expires: 400 }
      );
    });
  });

  describe("getSize", () => {
    it("should get size from cookies", () => {
      const mockSize = "large";
      (Cookies.get as any).mockReturnValue(mockSize);

      const result = getSize();

      expect(Cookies.get).toHaveBeenCalledWith(Keys.sizeKey);
      expect(result).toBe(mockSize);
    });

    it("should return undefined when size is not set", () => {
      (Cookies.get as any).mockReturnValue(undefined);

      const result = getSize();

      expect(Cookies.get).toHaveBeenCalledWith(Keys.sizeKey);
      expect(result).toBeUndefined();
    });

    it("should handle different size values", () => {
      const sizes = ["small", "medium", "large", "xl"];

      sizes.forEach(size => {
        (Cookies.get as any).mockReturnValue(size);
        const result = getSize();
        expect(result).toBe(size);
      });

      expect(Cookies.get).toHaveBeenCalledTimes(sizes.length);
    });
  });

  describe("setSize", () => {
    it("should set size in cookies", () => {
      const size = "medium";

      setSize(size);

      expect(Cookies.set).toHaveBeenCalledWith(
        Keys.sizeKey,
        size,
        { path: "/" }
      );
    });

    it("should handle different size values", () => {
      const sizes = ["small", "medium", "large", "xl"];

      sizes.forEach(size => {
        setSize(size);
        expect(Cookies.set).toHaveBeenCalledWith(
          Keys.sizeKey,
          size,
          { path: "/" }
        );
      });

      expect(Cookies.set).toHaveBeenCalledTimes(sizes.length);
    });

    it("should handle empty string size", () => {
      const size = "";

      setSize(size);

      expect(Cookies.set).toHaveBeenCalledWith(
        Keys.sizeKey,
        size,
        { path: "/" }
      );
    });
  });

  describe("getToken", () => {
    it("should get token from cookies", () => {
      const mockToken = "jwt-token-12345";
      (Cookies.get as any).mockReturnValue(mockToken);

      const result = getToken();

      expect(Cookies.get).toHaveBeenCalledWith(Keys.tokenKey);
      expect(result).toBe(mockToken);
    });

    it("should return undefined when token is not set", () => {
      (Cookies.get as any).mockReturnValue(undefined);

      const result = getToken();

      expect(Cookies.get).toHaveBeenCalledWith(Keys.tokenKey);
      expect(result).toBeUndefined();
    });

    it("should handle long token strings", () => {
      const longToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      (Cookies.get as any).mockReturnValue(longToken);

      const result = getToken();

      expect(Cookies.get).toHaveBeenCalledWith(Keys.tokenKey);
      expect(result).toBe(longToken);
    });
  });

  describe("setToken", () => {
    it("should set token in cookies", () => {
      const token = "jwt-token-12345";

      setToken(token);

      expect(Cookies.set).toHaveBeenCalledWith(
        Keys.tokenKey,
        token,
        { path: "/" }
      );
    });

    it("should handle long token strings", () => {
      const longToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

      setToken(longToken);

      expect(Cookies.set).toHaveBeenCalledWith(
        Keys.tokenKey,
        longToken,
        { path: "/" }
      );
    });

    it("should handle empty string token", () => {
      const token = "";

      setToken(token);

      expect(Cookies.set).toHaveBeenCalledWith(
        Keys.tokenKey,
        token,
        { path: "/" }
      );
    });

    it("should set token with correct path", () => {
      const token = "test-token";

      setToken(token);

      expect(Cookies.set).toHaveBeenCalledWith(
        Keys.tokenKey,
        token,
        { path: "/" }
      );
    });
  });

  describe("removeToken", () => {
    it("should remove token from cookies", () => {
      removeToken();

      expect(Cookies.remove).toHaveBeenCalledWith(Keys.tokenKey);
    });

    it("should call remove with correct token key", () => {
      removeToken();

      expect(Cookies.remove).toHaveBeenCalledTimes(1);
      expect(Cookies.remove).toHaveBeenCalledWith("vue3-typescript-admin-access-token");
    });

    it("should handle multiple remove calls", () => {
      removeToken();
      removeToken();
      removeToken();

      expect(Cookies.remove).toHaveBeenCalledTimes(3);
      expect(Cookies.remove).toHaveBeenCalledWith(Keys.tokenKey);
    });
  });

  describe("Integration tests", () => {
    it("should handle get/set cycles for sidebar status", () => {
      const status = "collapsed";
      (Cookies.get as any).mockReturnValue(status);

      setSidebarStatus(status);
      const result = getSidebarStatus();

      expect(Cookies.set).toHaveBeenCalledWith(Keys.sidebarStatusKey, status, { path: "/" });
      expect(Cookies.get).toHaveBeenCalledWith(Keys.sidebarStatusKey);
      expect(result).toBe(status);
    });

    it("should handle get/set cycles for language", () => {
      const language = "es";
      (Cookies.get as any).mockReturnValue(language);

      setLanguage(language);
      const result = getLanguage();

      expect(Cookies.set).toHaveBeenCalledWith(Keys.languageKey, language, { path: "/", expires: 400 });
      expect(Cookies.get).toHaveBeenCalledWith(Keys.languageKey);
      expect(result).toBe(language);
    });

    it("should handle get/set cycles for size", () => {
      const size = "large";
      (Cookies.get as any).mockReturnValue(size);

      setSize(size);
      const result = getSize();

      expect(Cookies.set).toHaveBeenCalledWith(Keys.sizeKey, size, { path: "/" });
      expect(Cookies.get).toHaveBeenCalledWith(Keys.sizeKey);
      expect(result).toBe(size);
    });

    it("should handle token lifecycle (set, get, remove)", () => {
      const token = "test-jwt-token";
      (Cookies.get as any).mockReturnValue(token);

      // Set token
      setToken(token);
      expect(Cookies.set).toHaveBeenCalledWith(Keys.tokenKey, token, { path: "/" });

      // Get token
      const result = getToken();
      expect(Cookies.get).toHaveBeenCalledWith(Keys.tokenKey);
      expect(result).toBe(token);

      // Remove token
      removeToken();
      expect(Cookies.remove).toHaveBeenCalledWith(Keys.tokenKey);
    });
  });
});