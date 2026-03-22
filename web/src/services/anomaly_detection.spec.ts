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
import anomaly_detection from "@/services/anomaly_detection";
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

describe("anomaly_detection service", () => {
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
    it("should make GET request to list all anomaly detections for an org", async () => {
      const org_identifier = "org123";

      mockHttpInstance.get.mockResolvedValue({ data: { list: [] } });

      await anomaly_detection.list(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection`
      );
    });

    it("should make GET request with a different org identifier", async () => {
      const org_identifier = "prod-org";

      mockHttpInstance.get.mockResolvedValue({
        data: {
          list: [
            { id: "anomaly-1", name: "cpu-anomaly", enabled: true },
            { id: "anomaly-2", name: "memory-anomaly", enabled: false },
          ],
        },
      });

      await anomaly_detection.list(org_identifier);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection`
      );
    });
  });

  describe("get", () => {
    it("should make GET request with org and anomaly_id", async () => {
      const org_identifier = "org123";
      const anomaly_id = "anomaly-detector-1";

      mockHttpInstance.get.mockResolvedValue({
        data: { id: "anomaly-detector-1", name: "cpu-anomaly" },
      });

      await anomaly_detection.get(org_identifier, anomaly_id);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/v2/${org_identifier}/alerts/${anomaly_id}`
      );
    });

    it("should make GET request with different org and anomaly_id", async () => {
      const org_identifier = "my-org";
      const anomaly_id = "detector-abc-xyz";

      mockHttpInstance.get.mockResolvedValue({
        data: { id: "detector-abc-xyz", enabled: true },
      });

      await anomaly_detection.get(org_identifier, anomaly_id);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/v2/${org_identifier}/alerts/${anomaly_id}`
      );
    });
  });

  describe("create", () => {
    it("should make POST request with data payload", async () => {
      const org_identifier = "org123";
      const data = {
        name: "cpu-anomaly",
        stream: "metrics",
        metric: "cpu_usage",
        threshold: 0.95,
      };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "new-anomaly-id" } });

      await anomaly_detection.create(org_identifier, data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/v2/${org_identifier}/alerts`,
        data
      );
    });

    it("should make POST request with minimal payload", async () => {
      const org_identifier = "my-org";
      const data = { name: "minimal-detector" };

      mockHttpInstance.post.mockResolvedValue({ data: { id: "minimal-id" } });

      await anomaly_detection.create(org_identifier, data);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/v2/${org_identifier}/alerts`,
        data
      );
    });
  });

  describe("update", () => {
    it("should make PUT request with org, anomaly_id, and data payload", async () => {
      const org_identifier = "org123";
      const anomaly_id = "anomaly-detector-1";
      const data = {
        name: "updated-cpu-anomaly",
        threshold: 0.98,
        enabled: true,
      };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await anomaly_detection.update(org_identifier, anomaly_id, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/v2/${org_identifier}/alerts/${anomaly_id}`,
        data
      );
    });

    it("should make PUT request with different anomaly_id", async () => {
      const org_identifier = "prod-org";
      const anomaly_id = "detector-xyz";
      const data = { enabled: false };

      mockHttpInstance.put.mockResolvedValue({ data: { success: true } });

      await anomaly_detection.update(org_identifier, anomaly_id, data);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/v2/${org_identifier}/alerts/${anomaly_id}`,
        data
      );
    });
  });

  describe("delete", () => {
    it("should make DELETE request with org and anomaly_id", async () => {
      const org_identifier = "org123";
      const anomaly_id = "anomaly-detector-1";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await anomaly_detection.delete(org_identifier, anomaly_id);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/v2/${org_identifier}/alerts/${anomaly_id}`
      );
    });

    it("should make DELETE request for a different org and anomaly_id", async () => {
      const org_identifier = "staging-org";
      const anomaly_id = "detector-to-remove";

      mockHttpInstance.delete.mockResolvedValue({ data: { success: true } });

      await anomaly_detection.delete(org_identifier, anomaly_id);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/v2/${org_identifier}/alerts/${anomaly_id}`
      );
    });
  });

  describe("toggleEnabled", () => {
    it("should make PUT request to enable anomaly detection", async () => {
      const org_identifier = "org123";
      const anomaly_id = "anomaly-detector-1";
      const enabled = true;

      mockHttpInstance.put.mockResolvedValue({ data: { enabled: true } });

      await anomaly_detection.toggleEnabled(org_identifier, anomaly_id, enabled);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/v2/${org_identifier}/alerts/${anomaly_id}`,
        { alert_type: "anomaly_detection", anomaly_config: { enabled } }
      );
    });

    it("should make PUT request to disable (pause) anomaly detection", async () => {
      const org_identifier = "org123";
      const anomaly_id = "anomaly-detector-1";
      const enabled = false;

      mockHttpInstance.put.mockResolvedValue({ data: { enabled: false } });

      await anomaly_detection.toggleEnabled(org_identifier, anomaly_id, enabled);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/v2/${org_identifier}/alerts/${anomaly_id}`,
        { alert_type: "anomaly_detection", anomaly_config: { enabled: false } }
      );
    });
  });

  describe("triggerTraining", () => {
    it("should make POST request to trigger training with empty body", async () => {
      const org_identifier = "org123";
      const anomaly_id = "anomaly-detector-1";

      mockHttpInstance.post.mockResolvedValue({ data: { status: "training_started" } });

      await anomaly_detection.triggerTraining(org_identifier, anomaly_id);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection/${anomaly_id}/train`,
        {}
      );
    });

    it("should make POST request with different anomaly_id", async () => {
      const org_identifier = "prod-org";
      const anomaly_id = "detector-needs-training";

      mockHttpInstance.post.mockResolvedValue({ data: { status: "training_started" } });

      await anomaly_detection.triggerTraining(org_identifier, anomaly_id);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection/${anomaly_id}/train`,
        {}
      );
    });
  });

  describe("cancelTraining", () => {
    it("should make DELETE request to cancel training", async () => {
      const org_identifier = "org123";
      const anomaly_id = "anomaly-detector-1";

      mockHttpInstance.delete.mockResolvedValue({ data: { status: "training_cancelled" } });

      await anomaly_detection.cancelTraining(org_identifier, anomaly_id);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection/${anomaly_id}/train`
      );
    });

    it("should make DELETE request for a different anomaly_id", async () => {
      const org_identifier = "staging-org";
      const anomaly_id = "detector-training-in-progress";

      mockHttpInstance.delete.mockResolvedValue({ data: { status: "training_cancelled" } });

      await anomaly_detection.cancelTraining(org_identifier, anomaly_id);

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection/${anomaly_id}/train`
      );
    });
  });

  describe("triggerDetection", () => {
    it("should make POST request to trigger detection with empty body", async () => {
      const org_identifier = "org123";
      const anomaly_id = "anomaly-detector-1";

      mockHttpInstance.post.mockResolvedValue({ data: { status: "detection_started" } });

      await anomaly_detection.triggerDetection(org_identifier, anomaly_id);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection/${anomaly_id}/detect`,
        {}
      );
    });

    it("should make POST request with different anomaly_id", async () => {
      const org_identifier = "my-org";
      const anomaly_id = "cpu-detector";

      mockHttpInstance.post.mockResolvedValue({ data: { status: "detection_started" } });

      await anomaly_detection.triggerDetection(org_identifier, anomaly_id);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection/${anomaly_id}/detect`,
        {}
      );
    });
  });

  describe("getHistory", () => {
    it("should make GET request with default limit of 100", async () => {
      const org_identifier = "org123";
      const anomaly_id = "anomaly-detector-1";

      mockHttpInstance.get.mockResolvedValue({ data: { history: [] } });

      await anomaly_detection.getHistory(org_identifier, anomaly_id);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection/${anomaly_id}/history?limit=100`
      );
    });

    it("should make GET request with custom limit", async () => {
      const org_identifier = "org123";
      const anomaly_id = "anomaly-detector-1";
      const limit = 50;

      mockHttpInstance.get.mockResolvedValue({ data: { history: [] } });

      await anomaly_detection.getHistory(org_identifier, anomaly_id, limit);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection/${anomaly_id}/history?limit=${limit}`
      );
    });

    it("should make GET request with limit=1 for minimal history", async () => {
      const org_identifier = "org123";
      const anomaly_id = "anomaly-detector-1";
      const limit = 1;

      mockHttpInstance.get.mockResolvedValue({ data: { history: [] } });

      await anomaly_detection.getHistory(org_identifier, anomaly_id, limit);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection/${anomaly_id}/history?limit=1`
      );
    });

    it("should make GET request with limit=500 for larger history", async () => {
      const org_identifier = "prod-org";
      const anomaly_id = "detector-with-history";
      const limit = 500;

      mockHttpInstance.get.mockResolvedValue({ data: { history: [] } });

      await anomaly_detection.getHistory(org_identifier, anomaly_id, limit);

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        `/api/${org_identifier}/anomaly_detection/${anomaly_id}/history?limit=500`
      );
    });
  });

  describe("error handling", () => {
    it("should propagate errors from list", async () => {
      const error = new Error("Unauthorized");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(anomaly_detection.list("org123")).rejects.toThrow("Unauthorized");
    });

    it("should propagate errors from get", async () => {
      const error = new Error("Not found");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        anomaly_detection.get("org123", "missing-id")
      ).rejects.toThrow("Not found");
    });

    it("should propagate errors from create", async () => {
      const error = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        anomaly_detection.create("org123", { name: "bad-detector" })
      ).rejects.toThrow("Validation error");
    });

    it("should propagate errors from update", async () => {
      const error = new Error("Conflict");
      mockHttpInstance.put.mockRejectedValue(error);

      await expect(
        anomaly_detection.update("org123", "detector-id", { name: "updated" })
      ).rejects.toThrow("Conflict");
    });

    it("should propagate errors from delete", async () => {
      const error = new Error("Forbidden");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        anomaly_detection.delete("org123", "detector-id")
      ).rejects.toThrow("Forbidden");
    });

    it("should propagate errors from triggerTraining", async () => {
      const error = new Error("Training already in progress");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        anomaly_detection.triggerTraining("org123", "detector-id")
      ).rejects.toThrow("Training already in progress");
    });

    it("should propagate errors from cancelTraining", async () => {
      const error = new Error("No training in progress");
      mockHttpInstance.delete.mockRejectedValue(error);

      await expect(
        anomaly_detection.cancelTraining("org123", "detector-id")
      ).rejects.toThrow("No training in progress");
    });

    it("should propagate errors from triggerDetection", async () => {
      const error = new Error("Detection failed");
      mockHttpInstance.post.mockRejectedValue(error);

      await expect(
        anomaly_detection.triggerDetection("org123", "detector-id")
      ).rejects.toThrow("Detection failed");
    });

    it("should propagate errors from getHistory", async () => {
      const error = new Error("Server error");
      mockHttpInstance.get.mockRejectedValue(error);

      await expect(
        anomaly_detection.getHistory("org123", "detector-id")
      ).rejects.toThrow("Server error");
    });
  });
});
