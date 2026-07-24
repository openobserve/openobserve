// Tests for online-evals.service — focuses on the unwrapList defensive
// helper, which silently handles three response shapes the backend may emit:
//   1. response.data is an array        → return it
//   2. response.data[key] is an array   → return that array
//   3. anything else                    → return []
// These tests pin that behavior so the service stops silently returning []
// if the API contract changes.

import { vi } from "vitest";

const { mockGet, mockPost, mockPut, mockDelete } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPut: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock("@/services/http", () => ({
  default: () => ({
    get: mockGet,
    post: mockPost,
    put: mockPut,
    delete: mockDelete,
  }),
}));

import { describe, it, expect, beforeEach } from "vitest";
import onlineEvalsService from "./online-evals.service";

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

describe("unwrapList — three response shapes", () => {
  it("returns the array directly when response.data is an array", async () => {
    mockGet.mockResolvedValue({ data: [{ id: "p1" }, { id: "p2" }] });
    const result = await onlineEvalsService.providers.list("org-1");
    expect(result).toEqual([{ id: "p1" }, { id: "p2" }]);
  });

  it("unwraps the list under the default 'list' key when response.data is an object", async () => {
    mockGet.mockResolvedValue({ data: { list: [{ id: "p1" }] } });
    const result = await onlineEvalsService.providers.list("org-1");
    expect(result).toEqual([{ id: "p1" }]);
  });

  it("unwraps under a custom key (versions endpoint uses 'versions')", async () => {
    mockGet.mockResolvedValue({
      data: {
        versions: [
          { id: "v1", version: 2 },
          { id: "v1", version: 1 },
        ],
      },
    });
    const result = await onlineEvalsService.scoreConfigs.versions("org-1", "sc1");
    expect(result).toEqual([
      { id: "v1", version: 2 },
      { id: "v1", version: 1 },
    ]);
  });

  it("returns [] when response.data is missing entirely", async () => {
    mockGet.mockResolvedValue({});
    const result = await onlineEvalsService.providers.list("org-1");
    expect(result).toEqual([]);
  });

  it("returns [] when response.data is null", async () => {
    mockGet.mockResolvedValue({ data: null });
    const result = await onlineEvalsService.providers.list("org-1");
    expect(result).toEqual([]);
  });

  it("returns [] when response.data is an object with no 'list' key", async () => {
    mockGet.mockResolvedValue({ data: { foo: "bar" } });
    const result = await onlineEvalsService.providers.list("org-1");
    expect(result).toEqual([]);
  });

  it("returns [] when response.data.list is not an array", async () => {
    mockGet.mockResolvedValue({ data: { list: "oops" } });
    const result = await onlineEvalsService.providers.list("org-1");
    expect(result).toEqual([]);
  });

  it("returns [] for the versions endpoint when key mismatch occurs", async () => {
    // Backend sends `{ data: { list: [...] } }` but versions reads under 'versions'
    mockGet.mockResolvedValue({ data: { list: [{ id: "v1" }] } });
    const result = await onlineEvalsService.scoreConfigs.versions("org-1", "sc1");
    expect(result).toEqual([]);
  });
});

describe("URL construction", () => {
  it("providers.list hits /api/{orgId}/providers", async () => {
    mockGet.mockResolvedValue({ data: [] });
    await onlineEvalsService.providers.list("acme");
    expect(mockGet).toHaveBeenCalledWith("/api/acme/providers");
  });

  it("scoreConfigs.versions hits /api/{orgId}/score_configs/{entityId}/versions", async () => {
    mockGet.mockResolvedValue({ data: { versions: [] } });
    await onlineEvalsService.scoreConfigs.versions("acme", "sc-42");
    expect(mockGet).toHaveBeenCalledWith("/api/acme/score_configs/sc-42/versions");
  });

  it("jobs.list appends a status query when one is provided", async () => {
    mockGet.mockResolvedValue({ data: [] });
    await onlineEvalsService.jobs.list("acme", "active");
    expect(mockGet).toHaveBeenCalledWith("/api/acme/eval_jobs?status=active");
  });

  it("jobs.list omits the query when no status is provided", async () => {
    mockGet.mockResolvedValue({ data: [] });
    await onlineEvalsService.jobs.list("acme");
    expect(mockGet).toHaveBeenCalledWith("/api/acme/eval_jobs");
  });

  it("jobs.list URL-encodes the status param", async () => {
    mockGet.mockResolvedValue({ data: [] });
    await onlineEvalsService.jobs.list("acme", "paused");
    expect(mockGet).toHaveBeenCalledWith("/api/acme/eval_jobs?status=paused");
  });
});

describe("mutation endpoints return response.data directly", () => {
  it("providers.create returns the created object", async () => {
    mockPost.mockResolvedValue({ data: { id: "p1", name: "OpenAI" } });
    const result = await onlineEvalsService.providers.create("org-1", {
      name: "OpenAI",
      providerType: "openai",
    } as any);
    expect(result).toEqual({ id: "p1", name: "OpenAI" });
    expect(mockPost).toHaveBeenCalledWith("/api/org-1/providers", {
      name: "OpenAI",
      providerType: "openai",
    });
  });

  it("jobs.activate posts to /activate with empty body and returns data", async () => {
    mockPost.mockResolvedValue({ data: { id: "j1", status: "active" } });
    const result = await onlineEvalsService.jobs.activate("org-1", "j1");
    expect(result).toEqual({ id: "j1", status: "active" });
    expect(mockPost).toHaveBeenCalledWith("/api/org-1/eval_jobs/j1/activate", {});
  });

  it("jobs.pause posts to /pause with empty body and returns data", async () => {
    mockPost.mockResolvedValue({ data: { id: "j1", status: "paused" } });
    const result = await onlineEvalsService.jobs.pause("org-1", "j1");
    expect(result).toEqual({ id: "j1", status: "paused" });
    expect(mockPost).toHaveBeenCalledWith("/api/org-1/eval_jobs/j1/pause", {});
  });

  it("providers.delete calls DELETE on the resource path", async () => {
    mockDelete.mockResolvedValue({});
    await onlineEvalsService.providers.delete("org-1", "p1");
    expect(mockDelete).toHaveBeenCalledWith("/api/org-1/providers/p1");
  });
});
