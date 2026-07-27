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

import { describe, it, expect, vi, beforeEach } from "vitest";
import synthetics from "./synthetics";

// Mock http service
vi.mock("./http", () => ({
  default: vi.fn(() => ({
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}));

import http from "./http";

describe("Synthetics locations service", () => {
  let mockHttp: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp = {
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    };
    (http as any).mockReturnValue(mockHttp);
  });

  describe("createLocation", () => {
    const orgIdentifier = "test-org";
    const payload = { name: "us-east-1", type: "aws", region: "us-east-1" };

    it("makes a POST request to the correct URL with the payload", async () => {
      await synthetics.createLocation(orgIdentifier, payload);

      expect(mockHttp.post).toHaveBeenCalledWith(`/api/test-org/synthetics/locations`, payload);
    });

    it("handles minimal payloads", async () => {
      const minimalPayload = { name: "minimal" };
      await synthetics.createLocation(orgIdentifier, minimalPayload);

      expect(mockHttp.post).toHaveBeenCalledWith(
        `/api/test-org/synthetics/locations`,
        minimalPayload,
      );
    });

    it("handles complex nested payloads", async () => {
      const complexPayload = {
        name: "complex-location",
        config: {
          credentials: { accessKey: "abc", secretKey: "xyz" },
          options: { timeout: 30, retries: 3 },
          tags: ["production", "monitoring"],
        },
      };
      await synthetics.createLocation(orgIdentifier, complexPayload);

      expect(mockHttp.post).toHaveBeenCalledWith(
        `/api/test-org/synthetics/locations`,
        complexPayload,
      );
    });

    it("handles different organization identifiers", async () => {
      const orgs = ["org-one", "org_two", "ORG123", "org.with.dots"];

      for (const org of orgs) {
        await synthetics.createLocation(org, payload);
        expect(mockHttp.post).toHaveBeenCalledWith(`/api/${org}/synthetics/locations`, payload);
      }
    });

    it("propagates API errors", async () => {
      const error = new Error("Location name already exists");
      mockHttp.post.mockRejectedValue(error);

      await expect(synthetics.createLocation(orgIdentifier, payload)).rejects.toThrow(
        "Location name already exists",
      );
    });
  });

  describe("updateLocation", () => {
    const orgIdentifier = "test-org";
    const id = "loc-123";
    const payload = { name: "us-east-1-updated", region: "us-east-1" };

    it("makes a PUT request to the correct URL with the id and payload", async () => {
      await synthetics.updateLocation(orgIdentifier, id, payload);

      expect(mockHttp.put).toHaveBeenCalledWith(
        `/api/test-org/synthetics/locations/loc-123`,
        payload,
      );
    });

    it("handles partial updates", async () => {
      const partialPayload = { name: "renamed-only" };
      await synthetics.updateLocation(orgIdentifier, id, partialPayload);

      expect(mockHttp.put).toHaveBeenCalledWith(
        `/api/test-org/synthetics/locations/loc-123`,
        partialPayload,
      );
    });

    it("handles different location IDs", async () => {
      const ids = ["loc-abc", "uuid-123-456", 789, "LOC_UPPER", "id.with.dots"];

      for (const locationId of ids) {
        await synthetics.updateLocation(orgIdentifier, locationId as string, payload);
        expect(mockHttp.put).toHaveBeenCalledWith(
          `/api/${orgIdentifier}/synthetics/locations/${locationId}`,
          payload,
        );
      }
    });

    it("handles different organization identifiers", async () => {
      const orgs = ["org-a", "org-b", "dev_org", "PROD_ENV"];

      for (const org of orgs) {
        await synthetics.updateLocation(org, id, payload);
        expect(mockHttp.put).toHaveBeenCalledWith(
          `/api/${org}/synthetics/locations/loc-123`,
          payload,
        );
      }
    });

    it("propagates API errors", async () => {
      const error = new Error("Location not found");
      mockHttp.put.mockRejectedValue(error);

      await expect(synthetics.updateLocation(orgIdentifier, id, payload)).rejects.toThrow(
        "Location not found",
      );
    });
  });

  describe("deleteLocation", () => {
    const orgIdentifier = "test-org";
    const id = "loc-456";

    it("makes a DELETE request to the correct URL with the id", async () => {
      await synthetics.deleteLocation(orgIdentifier, id);

      expect(mockHttp.delete).toHaveBeenCalledWith(`/api/test-org/synthetics/locations/loc-456`);
    });

    it("handles different location IDs", async () => {
      const ids = ["loc-simple", "uuid-abc-def", 999, "LOC_UPPER"];

      for (const locationId of ids) {
        await synthetics.deleteLocation(orgIdentifier, locationId as string);
        expect(mockHttp.delete).toHaveBeenCalledWith(
          `/api/${orgIdentifier}/synthetics/locations/${locationId}`,
        );
      }
    });

    it("handles different organization identifiers", async () => {
      const orgs = ["org-x", "org_y", "TEST"];

      for (const org of orgs) {
        await synthetics.deleteLocation(org, id);
        expect(mockHttp.delete).toHaveBeenCalledWith(`/api/${org}/synthetics/locations/loc-456`);
      }
    });

    it("propagates API errors", async () => {
      const error = new Error("Forbidden");
      mockHttp.delete.mockRejectedValue(error);

      await expect(synthetics.deleteLocation(orgIdentifier, id)).rejects.toThrow("Forbidden");
    });
  });

  describe("bulkDeleteLocations", () => {
    const orgIdentifier = "test-org";

    it("makes a DELETE request to the correct URL with ids in the body", async () => {
      const ids = ["loc-1", "loc-2", "loc-3"];

      await synthetics.bulkDeleteLocations(orgIdentifier, ids);

      expect(mockHttp.delete).toHaveBeenCalledWith(`/api/test-org/synthetics/locations`, {
        data: { ids: ["loc-1", "loc-2", "loc-3"] },
      });
    });

    it("handles a single id in the array", async () => {
      const ids = ["loc-single"];

      await synthetics.bulkDeleteLocations(orgIdentifier, ids);

      expect(mockHttp.delete).toHaveBeenCalledWith(`/api/test-org/synthetics/locations`, {
        data: { ids: ["loc-single"] },
      });
    });

    it("handles an empty ids array", async () => {
      const ids: string[] = [];

      await synthetics.bulkDeleteLocations(orgIdentifier, ids);

      expect(mockHttp.delete).toHaveBeenCalledWith(`/api/test-org/synthetics/locations`, {
        data: { ids: [] },
      });
    });

    it("handles a large number of ids", async () => {
      const ids = Array.from({ length: 100 }, (_, i) => `loc-${i}`);

      await synthetics.bulkDeleteLocations(orgIdentifier, ids);

      expect(mockHttp.delete).toHaveBeenCalledWith(`/api/test-org/synthetics/locations`, {
        data: { ids },
      });
    });

    it("handles different organization identifiers", async () => {
      const ids = ["loc-a", "loc-b"];
      const orgs = ["org-one", "org_two", "ORG_UPPER"];

      for (const org of orgs) {
        await synthetics.bulkDeleteLocations(org, ids);
        expect(mockHttp.delete).toHaveBeenCalledWith(`/api/${org}/synthetics/locations`, {
          data: { ids: ["loc-a", "loc-b"] },
        });
      }
    });

    it("propagates API errors", async () => {
      const ids = ["loc-1"];
      const error = new Error("Server error");
      mockHttp.delete.mockRejectedValue(error);

      await expect(synthetics.bulkDeleteLocations(orgIdentifier, ids)).rejects.toThrow(
        "Server error",
      );
    });
  });
});
