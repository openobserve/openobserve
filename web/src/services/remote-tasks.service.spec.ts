// Tests for remote-tasks.service — pins the endpoints each method calls, the
// list-unwrapping, and the two rules the UI leans on: a test connection is the
// publish path, and a test run returns rows from `.results`.

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
import remoteTasksService from "./remote-tasks.service";

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

describe("list", () => {
  it("returns the array directly when response.data is an array", async () => {
    mockGet.mockResolvedValue({ data: [{ id: "rt1" }, { id: "rt2" }] });
    const result = await remoteTasksService.list("org-1");
    expect(mockGet).toHaveBeenCalledWith("/api/org-1/remote_tasks");
    expect(result).toEqual([{ id: "rt1" }, { id: "rt2" }]);
  });

  it("unwraps the list under the 'list' key", async () => {
    mockGet.mockResolvedValue({ data: { list: [{ id: "rt1" }] } });
    const result = await remoteTasksService.list("org-1");
    expect(result).toEqual([{ id: "rt1" }]);
  });

  it("returns [] for an unexpected shape rather than throwing", async () => {
    mockGet.mockResolvedValue({ data: { unexpected: true } });
    expect(await remoteTasksService.list("org-1")).toEqual([]);
  });
});

describe("versions", () => {
  it("hits the versions endpoint and unwraps the list", async () => {
    mockGet.mockResolvedValue({ data: { list: [{ version: 2 }, { version: 1 }] } });
    const result = await remoteTasksService.versions("org-1", "head-1");
    expect(mockGet).toHaveBeenCalledWith("/api/org-1/remote_tasks/head-1/versions");
    expect(result).toHaveLength(2);
  });
});

describe("draft lifecycle", () => {
  it("create posts to the collection", async () => {
    mockPost.mockResolvedValue({ data: { id: "rt1", version: 0 } });
    await remoteTasksService.create("org-1", {
      name: "summarizer",
      endpoint: "https://tasks.example.com/run",
    });
    expect(mockPost).toHaveBeenCalledWith("/api/org-1/remote_tasks", {
      name: "summarizer",
      endpoint: "https://tasks.example.com/run",
    });
  });

  it("saveDraft puts to the head", async () => {
    mockPut.mockResolvedValue({ data: { id: "rt1", version: 0 } });
    await remoteTasksService.saveDraft("org-1", "head-1", {
      name: "summarizer",
      endpoint: "https://tasks.example.com/run",
    });
    expect(mockPut).toHaveBeenCalledWith(
      "/api/org-1/remote_tasks/head-1",
      expect.objectContaining({ name: "summarizer" }),
    );
  });

  it("discardDraft deletes the draft, not the head", async () => {
    mockDelete.mockResolvedValue({});
    await remoteTasksService.discardDraft("org-1", "head-1");
    expect(mockDelete).toHaveBeenCalledWith("/api/org-1/remote_tasks/head-1/draft");
  });
});

describe("testConnection — the publish path", () => {
  it("posts to test_connection and returns the publish result", async () => {
    mockPost.mockResolvedValue({
      data: { published: true, versionBumped: true, task: { version: 1 }, report: {} },
    });
    const result = await remoteTasksService.testConnection("org-1", "head-1", {
      input: "hi",
    });
    expect(mockPost).toHaveBeenCalledWith(
      "/api/org-1/remote_tasks/head-1/test_connection",
      { input: "hi" },
    );
    expect(result.published).toBe(true);
    expect(result.versionBumped).toBe(true);
  });

  it("surfaces a failed test connection without a published version", async () => {
    mockPost.mockResolvedValue({
      data: {
        published: false,
        versionBumped: false,
        error: "connection refused",
        task: { version: 0 },
        report: {},
      },
    });
    const result = await remoteTasksService.testConnection("org-1", "head-1");
    expect(result.published).toBe(false);
    expect(result.error).toBe("connection refused");
  });
});

describe("testRun — volatile bench", () => {
  it("posts samples and returns rows from .results", async () => {
    mockPost.mockResolvedValue({
      data: {
        results: [
          { rowId: "r1", status: "ok", latencyMs: 12 },
          { rowId: "r2", status: "error", latencyMs: 8 },
        ],
      },
    });
    const rows = await remoteTasksService.testRun("org-1", "head-1", [
      { input: "a" },
      { input: "b" },
    ]);
    expect(mockPost).toHaveBeenCalledWith("/api/org-1/remote_tasks/head-1/test_run", {
      samples: [{ input: "a" }, { input: "b" }],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("ok");
  });

  it("returns [] when the response carries no results", async () => {
    mockPost.mockResolvedValue({ data: {} });
    expect(await remoteTasksService.testRun("org-1", "head-1", [])).toEqual([]);
  });
});

describe("delete", () => {
  it("deletes the head", async () => {
    mockDelete.mockResolvedValue({});
    await remoteTasksService.delete("org-1", "head-1");
    expect(mockDelete).toHaveBeenCalledWith("/api/org-1/remote_tasks/head-1");
  });
});
