// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { RegexPatternCache } from "./regexPatternCache";

describe("RegexPatternCache", () => {
  const orgId = "test-org-123";
  const testData = { patterns: ["test.*", "error.*"], count: 2 };

  beforeEach(() => {
    // Clear sessionStorage before each test
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe("set", () => {
    it("should store data in sessionStorage", () => {
      RegexPatternCache.set(orgId, testData);

      const stored = sessionStorage.getItem(`regex_patterns_cache_${orgId}`);
      expect(stored).toBeTruthy();

      const parsed = JSON.parse(stored!);
      expect(parsed.data).toEqual(testData);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.ttl).toBe(60 * 60 * 1000); // default 1 hour
    });

    it("should use custom TTL when provided", () => {
      const customTTL = 30 * 60 * 1000; // 30 minutes
      RegexPatternCache.set(orgId, testData, customTTL);

      const stored = sessionStorage.getItem(`regex_patterns_cache_${orgId}`);
      const parsed = JSON.parse(stored!);
      expect(parsed.ttl).toBe(customTTL);
    });

    it("should handle storage errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Mock storage to throw quota exceeded error
      vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
        throw new Error("QuotaExceededError");
      });

      // Should not throw
      expect(() => RegexPatternCache.set(orgId, testData)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should store different data for different orgIds", () => {
      const org1Data = { patterns: ["org1.*"], count: 1 };
      const org2Data = { patterns: ["org2.*"], count: 1 };

      RegexPatternCache.set("org1", org1Data);
      RegexPatternCache.set("org2", org2Data);

      const retrieved1 = RegexPatternCache.get<typeof org1Data>("org1");
      const retrieved2 = RegexPatternCache.get<typeof org2Data>("org2");

      expect(retrieved1).toEqual(org1Data);
      expect(retrieved2).toEqual(org2Data);
    });
  });

  describe("get", () => {
    it("should return null for non-existent cache", () => {
      const result = RegexPatternCache.get(orgId);
      expect(result).toBeNull();
    });

    it("should retrieve cached data", () => {
      RegexPatternCache.set(orgId, testData);
      const result = RegexPatternCache.get<typeof testData>(orgId);

      expect(result).toEqual(testData);
    });

    it("should return null for expired cache", () => {
      // Set with short TTL
      RegexPatternCache.set(orgId, testData, 100);

      // Mock Date.now to simulate time passing
      const originalNow = Date.now;
      Date.now = vi.fn(() => originalNow() + 200);

      const result = RegexPatternCache.get(orgId);
      expect(result).toBeNull();

      // Verify cache was cleared
      const stored = sessionStorage.getItem(`regex_patterns_cache_${orgId}`);
      expect(stored).toBeNull();

      Date.now = originalNow;
    });

    it("should return data for non-expired cache", () => {
      // Set with 1 hour TTL
      RegexPatternCache.set(orgId, testData, 60 * 60 * 1000);

      // Mock Date.now to simulate 30 minutes passing
      const originalNow = Date.now;
      Date.now = vi.fn(() => originalNow() + 30 * 60 * 1000);

      const result = RegexPatternCache.get<typeof testData>(orgId);
      expect(result).toEqual(testData);

      Date.now = originalNow;
    });

    it("should handle JSON parse errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Store invalid JSON
      sessionStorage.setItem(`regex_patterns_cache_${orgId}`, "invalid json");

      const result = RegexPatternCache.get(orgId);
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should handle corrupted cache data", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Store data without required fields
      sessionStorage.setItem(`regex_patterns_cache_${orgId}`, JSON.stringify({ data: "test" }));

      // Should handle missing timestamp gracefully
      RegexPatternCache.get(orgId);

      consoleSpy.mockRestore();
    });
  });

  describe("clear", () => {
    it("should remove cache for specific orgId", () => {
      RegexPatternCache.set(orgId, testData);
      expect(sessionStorage.getItem(`regex_patterns_cache_${orgId}`)).toBeTruthy();

      RegexPatternCache.clear(orgId);
      expect(sessionStorage.getItem(`regex_patterns_cache_${orgId}`)).toBeNull();
    });

    it("should not affect other org caches", () => {
      RegexPatternCache.set("org1", testData);
      RegexPatternCache.set("org2", testData);

      RegexPatternCache.clear("org1");

      expect(sessionStorage.getItem("regex_patterns_cache_org1")).toBeNull();
      expect(sessionStorage.getItem("regex_patterns_cache_org2")).toBeTruthy();
    });

    it("should handle errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => {
        throw new Error("Storage error");
      });

      expect(() => RegexPatternCache.clear(orgId)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("clearAll", () => {
    it("should remove all regex pattern caches", () => {
      RegexPatternCache.set("org1", testData);
      RegexPatternCache.set("org2", testData);
      RegexPatternCache.set("org3", testData);

      // Add some non-cache items
      sessionStorage.setItem("other_key", "value");

      RegexPatternCache.clearAll();

      expect(sessionStorage.getItem("regex_patterns_cache_org1")).toBeNull();
      expect(sessionStorage.getItem("regex_patterns_cache_org2")).toBeNull();
      expect(sessionStorage.getItem("regex_patterns_cache_org3")).toBeNull();
      expect(sessionStorage.getItem("other_key")).toBe("value");
    });

    it("should handle empty storage", () => {
      expect(() => RegexPatternCache.clearAll()).not.toThrow();
    });

    it("should handle errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Mock Object.keys to throw
      vi.spyOn(Object, "keys").mockImplementationOnce(() => {
        throw new Error("Storage error");
      });

      expect(() => RegexPatternCache.clearAll()).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("getStats", () => {
    it("should return null for non-existent cache", () => {
      const stats = RegexPatternCache.getStats(orgId);
      expect(stats).toBeNull();
    });

    it("should return cache statistics", () => {
      const customTTL = 30 * 60 * 1000;
      RegexPatternCache.set(orgId, testData, customTTL);

      const stats = RegexPatternCache.getStats(orgId);

      expect(stats).toBeTruthy();
      expect(stats!.exists).toBe(true);
      expect(stats!.age).toBeGreaterThanOrEqual(0);
      expect(stats!.ttl).toBe(30 * 60); // in seconds
    });

    it("should calculate age correctly", () => {
      RegexPatternCache.set(orgId, testData);

      // Mock Date.now to simulate time passing
      const originalNow = Date.now;
      Date.now = vi.fn(() => originalNow() + 5000); // 5 seconds

      const stats = RegexPatternCache.getStats(orgId);

      expect(stats).toBeTruthy();
      expect(stats!.age).toBeGreaterThanOrEqual(5);
      expect(stats!.age).toBeLessThan(10); // reasonable upper bound

      Date.now = originalNow;
    });

    it("should handle JSON parse errors", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      sessionStorage.setItem(`regex_patterns_cache_${orgId}`, "invalid json");

      const stats = RegexPatternCache.getStats(orgId);
      expect(stats).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("Integration Tests", () => {
    it("should handle full lifecycle: set -> get -> clear", () => {
      // Set
      RegexPatternCache.set(orgId, testData);
      expect(RegexPatternCache.getStats(orgId)?.exists).toBe(true);

      // Get
      const retrieved = RegexPatternCache.get<typeof testData>(orgId);
      expect(retrieved).toEqual(testData);

      // Clear
      RegexPatternCache.clear(orgId);
      expect(RegexPatternCache.get(orgId)).toBeNull();
      expect(RegexPatternCache.getStats(orgId)).toBeNull();
    });

    it("should handle multiple organizations simultaneously", () => {
      const orgs = ["org1", "org2", "org3", "org4", "org5"];
      const dataMap = new Map();

      // Set data for all orgs
      orgs.forEach((org, index) => {
        const data = { patterns: [`${org}.*`], count: index + 1 };
        dataMap.set(org, data);
        RegexPatternCache.set(org, data);
      });

      // Verify all data is stored correctly
      orgs.forEach((org) => {
        const retrieved = RegexPatternCache.get(org);
        expect(retrieved).toEqual(dataMap.get(org));
      });

      // Clear one org
      RegexPatternCache.clear("org3");
      expect(RegexPatternCache.get("org3")).toBeNull();

      // Verify others still exist
      expect(RegexPatternCache.get("org1")).toBeTruthy();
      expect(RegexPatternCache.get("org2")).toBeTruthy();
      expect(RegexPatternCache.get("org4")).toBeTruthy();
      expect(RegexPatternCache.get("org5")).toBeTruthy();

      // Clear all
      RegexPatternCache.clearAll();
      orgs.forEach((org) => {
        expect(RegexPatternCache.get(org)).toBeNull();
      });
    });

    it("should handle cache expiration correctly", () => {
      const shortTTL = 100; // 100ms
      RegexPatternCache.set(orgId, testData, shortTTL);

      // Immediate get should work
      expect(RegexPatternCache.get(orgId)).toEqual(testData);

      // Wait for expiration
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(RegexPatternCache.get(orgId)).toBeNull();
          resolve();
        }, 150);
      });
    });

    it("should handle complex data structures", () => {
      const complexData = {
        patterns: ["test.*", "error.*", "warning.*"],
        metadata: {
          created: Date.now(),
          author: "test-user",
          nested: {
            deep: {
              value: 123,
              array: [1, 2, 3],
            },
          },
        },
        tags: ["important", "production"],
      };

      RegexPatternCache.set(orgId, complexData);
      const retrieved = RegexPatternCache.get<typeof complexData>(orgId);

      expect(retrieved).toEqual(complexData);
    });
  });
});
