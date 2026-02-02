// Copyright 2025 OpenObserve Inc.
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
import backfill from "@/services/backfill";
import http from "@/services/http";

// Mock the http service
vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("backfill service", () => {
  let mockHttpInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };
    (http as any).mockReturnValue(mockHttpInstance);
  });

  describe("createBackfillJob", () => {
    it("should create a backfill job with correct parameters", async () => {
      const mockResponse = {
        data: {
          job_id: "test-job-123",
          message: "Job created successfully",
        },
      };
      mockHttpInstance.post.mockResolvedValue(mockResponse);

      const params = {
        org_id: "test-org",
        pipeline_id: "test-pipeline",
        data: {
          start_time: "2024-01-01T00:00:00Z",
          end_time: "2024-01-02T00:00:00Z",
          chunk_period_minutes: 60,
          delay_between_chunks_secs: 10,
          delete_before_backfill: false,
        },
      };

      const result = await backfill.createBackfillJob(params);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        `/api/${params.org_id}/pipelines/${params.pipeline_id}/backfill`,
        params.data
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe("listBackfillJobs", () => {
    it("should list all backfill jobs for an organization", async () => {
      const mockJobs = [
        {
          job_id: "job-1",
          pipeline_id: "pipeline-1",
          pipeline_name: "Test Pipeline 1",
          start_time: 1704067200000000,
          end_time: 1704153600000000,
          current_position: 1704100000000000,
          progress_percent: 50,
          status: "running",
        },
        {
          job_id: "job-2",
          pipeline_id: "pipeline-2",
          pipeline_name: "Test Pipeline 2",
          start_time: 1704067200000000,
          end_time: 1704153600000000,
          current_position: 1704153600000000,
          progress_percent: 100,
          status: "completed",
        },
      ];

      mockHttpInstance.get.mockResolvedValue({ data: mockJobs });

      const result = await backfill.listBackfillJobs({ org_id: "test-org" });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/pipelines/backfill"
      );
      expect(result).toEqual(mockJobs);
    });
  });

  describe("getBackfillJob", () => {
    it("should get a specific backfill job by ID", async () => {
      const mockJob = {
        job_id: "test-job-123",
        pipeline_id: "test-pipeline",
        pipeline_name: "Test Pipeline",
        start_time: 1704067200000000,
        end_time: 1704153600000000,
        current_position: 1704100000000000,
        progress_percent: 50,
        status: "running",
        deletion_status: "not_required",
        chunks_completed: 5,
        chunks_total: 10,
      };

      mockHttpInstance.get.mockResolvedValue({ data: mockJob });

      const result = await backfill.getBackfillJob({
        org_id: "test-org",
        pipeline_id: "test-pipeline",
        job_id: "test-job-123",
      });

      expect(mockHttpInstance.get).toHaveBeenCalledWith(
        "/api/test-org/pipelines/test-pipeline/backfill/test-job-123"
      );
      expect(result).toEqual(mockJob);
    });
  });

  describe("enableBackfillJob", () => {
    it("should enable a backfill job", async () => {
      const mockResponse = {
        data: {
          message: "Backfill job enabled successfully",
        },
      };

      mockHttpInstance.put.mockResolvedValue(mockResponse);

      const result = await backfill.enableBackfillJob({
        org_id: "test-org",
        pipeline_id: "test-pipeline",
        job_id: "test-job-123",
        enable: true,
      });

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/pipelines/test-pipeline/backfill/test-job-123/enable?value=true"
      );
      expect(result).toEqual(mockResponse.data);
    });

    it("should disable a backfill job", async () => {
      const mockResponse = {
        data: {
          message: "Backfill job disabled successfully",
        },
      };

      mockHttpInstance.put.mockResolvedValue(mockResponse);

      const result = await backfill.enableBackfillJob({
        org_id: "test-org",
        pipeline_id: "test-pipeline",
        job_id: "test-job-123",
        enable: false,
      });

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/pipelines/test-pipeline/backfill/test-job-123/enable?value=false"
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe("pauseBackfillJob", () => {
    it("should pause a backfill job by calling enableBackfillJob with enable=false", async () => {
      const mockResponse = {
        data: {
          message: "Backfill job disabled successfully",
        },
      };

      mockHttpInstance.put.mockResolvedValue(mockResponse);

      const result = await backfill.pauseBackfillJob({
        org_id: "test-org",
        pipeline_id: "test-pipeline",
        job_id: "test-job-123",
      });

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/pipelines/test-pipeline/backfill/test-job-123/enable?value=false"
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe("resumeBackfillJob", () => {
    it("should resume a backfill job by calling enableBackfillJob with enable=true", async () => {
      const mockResponse = {
        data: {
          message: "Backfill job enabled successfully",
        },
      };

      mockHttpInstance.put.mockResolvedValue(mockResponse);

      const result = await backfill.resumeBackfillJob({
        org_id: "test-org",
        pipeline_id: "test-pipeline",
        job_id: "test-job-123",
      });

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        "/api/test-org/pipelines/test-pipeline/backfill/test-job-123/enable?value=true"
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe("updateBackfillJob", () => {
    it("should update a backfill job with correct parameters", async () => {
      const mockResponse = {
        data: {
          message: "Backfill job updated successfully",
        },
      };

      mockHttpInstance.put.mockResolvedValue(mockResponse);

      const params = {
        org_id: "test-org",
        pipeline_id: "test-pipeline",
        job_id: "test-job-123",
        data: {
          start_time: "2024-01-01T00:00:00Z",
          end_time: "2024-01-03T00:00:00Z",
          chunk_period_minutes: 120,
          delay_between_chunks_secs: 20,
          delete_before_backfill: true,
        },
      };

      const result = await backfill.updateBackfillJob(params);

      expect(mockHttpInstance.put).toHaveBeenCalledWith(
        `/api/${params.org_id}/pipelines/${params.pipeline_id}/backfill/${params.job_id}`,
        params.data
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe("deleteBackfillJob", () => {
    it("should delete a backfill job", async () => {
      const mockResponse = {
        data: {
          message: "Backfill job deleted successfully",
        },
      };

      mockHttpInstance.delete.mockResolvedValue(mockResponse);

      const result = await backfill.deleteBackfillJob({
        org_id: "test-org",
        pipeline_id: "test-pipeline",
        job_id: "test-job-123",
      });

      expect(mockHttpInstance.delete).toHaveBeenCalledWith(
        "/api/test-org/pipelines/test-pipeline/backfill/test-job-123"
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe("error handling", () => {
    it("should propagate errors from HTTP calls", async () => {
      const mockError = new Error("Network error");
      mockHttpInstance.get.mockRejectedValue(mockError);

      await expect(
        backfill.listBackfillJobs({ org_id: "test-org" })
      ).rejects.toThrow("Network error");
    });

    it("should propagate errors from create operation", async () => {
      const mockError = new Error("Validation error");
      mockHttpInstance.post.mockRejectedValue(mockError);

      await expect(
        backfill.createBackfillJob({
          org_id: "test-org",
          pipeline_id: "test-pipeline",
          data: {
            start_time: "invalid",
            end_time: "invalid",
          },
        })
      ).rejects.toThrow("Validation error");
    });

    it("should propagate errors from enable operation", async () => {
      const mockError = new Error("Job not found");
      mockHttpInstance.put.mockRejectedValue(mockError);

      await expect(
        backfill.enableBackfillJob({
          org_id: "test-org",
          pipeline_id: "test-pipeline",
          job_id: "non-existent",
          enable: true,
        })
      ).rejects.toThrow("Job not found");
    });
  });
});
