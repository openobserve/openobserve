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
    expect(mockGet).toHaveBeenCalledWith("/api/org-1/tasks");
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
    expect(mockGet).toHaveBeenCalledWith("/api/org-1/tasks/head-1/versions");
    expect(result).toHaveLength(2);
  });
});

describe("draft lifecycle", () => {
  it("registers the complete task and write-only Secrets in one request", async () => {
    mockPost.mockResolvedValue({
      data: {
        entityId: "head-1",
        version: 0,
        generatedSigningSecret: {
          keyId: "key-1",
          material: { type: "token", value: "generated-once" },
        },
      },
    });
    const result = await remoteTasksService.create("org-1", {
      name: "summarizer",
      endpoint: "https://tasks.example.com/run",
      auth: {
        type: "bearer",
        secret: { type: "token", value: "auth-value" },
      },
      customHeaders: [
        { key: "X-Static", value: "visible" },
        {
          key: "X-Secret",
          secret: { type: "token", value: "header-value" },
        },
      ],
      signing: { enabled: true },
    });
    expect(mockPost).toHaveBeenCalledWith("/api/org-1/tasks", {
      name: "summarizer",
      endpoint: "https://tasks.example.com/run",
      auth: {
        type: "bearer",
        secret: { type: "token", value: "auth-value" },
      },
      customHeaders: [
        { key: "X-Static", value: "visible" },
        {
          key: "X-Secret",
          secret: { type: "token", value: "header-value" },
        },
      ],
      signing: { enabled: true },
    });
    expect(result.entityId).toBe("head-1");
    expect(result.generatedSigningSecret?.keyId).toBe("key-1");
  });

  it("saveDraft puts to the head", async () => {
    mockPut.mockResolvedValue({ data: { id: "rt1", version: 0 } });
    await remoteTasksService.saveDraft("org-1", "head-1", {
      name: "summarizer",
      endpoint: "https://tasks.example.com/run",
    });
    expect(mockPut).toHaveBeenCalledWith(
      "/api/org-1/tasks/head-1",
      expect.objectContaining({ name: "summarizer" }),
    );
  });

  it("discardDraft deletes the draft, not the head", async () => {
    mockDelete.mockResolvedValue({});
    await remoteTasksService.discardDraft("org-1", "head-1");
    expect(mockDelete).toHaveBeenCalledWith("/api/org-1/tasks/head-1/draft");
  });
});

describe("task-owned credential lifecycle", () => {
  it("never exposes or addresses a secret resource", async () => {
    mockGet.mockResolvedValue({ data: { keys: [{ purpose: "signing", state: "current" }] } });
    mockPut.mockResolvedValue({ data: { purpose: "auth", state: "current" } });
    mockPost.mockResolvedValue({ data: { purpose: "signing", state: "candidate" } });
    mockDelete.mockResolvedValue({});

    await remoteTasksService.replaceAuth("org-1", "head-1", {
      type: "token",
      value: "replacement",
    });
    await remoteTasksService.replaceHeaderSecret("org-1", "head-1", "X.API+Key", {
      type: "token",
      value: "replacement",
    });
    await remoteTasksService.getSigningStatus("org-1", "head-1");
    await remoteTasksService.rotateSigning("org-1", "head-1");
    await remoteTasksService.testSigningCandidate("org-1", "head-1", { input: "probe" });
    await remoteTasksService.activateSigning("org-1", "head-1", 60_000);
    await remoteTasksService.endSigningGrace("org-1", "head-1");
    await remoteTasksService.revokeAuth("org-1", "head-1");
    await remoteTasksService.revokeHeaderSecret("org-1", "head-1", "X.API+Key");
    await remoteTasksService.revokeSigning("org-1", "head-1");

    expect(mockPut).toHaveBeenNthCalledWith(1, "/api/org-1/tasks/head-1/auth", {
      material: { type: "token", value: "replacement" },
    });
    expect(mockPut).toHaveBeenNthCalledWith(
      2,
      "/api/org-1/tasks/head-1/headers/X.API%2BKey/secret",
      { material: { type: "token", value: "replacement" } },
    );
    expect(mockGet).toHaveBeenCalledWith("/api/org-1/tasks/head-1/signing");
    expect(mockPost.mock.calls.map(([path]) => path)).toEqual([
      "/api/org-1/tasks/head-1/signing/rotate",
      "/api/org-1/tasks/head-1/signing/test",
      "/api/org-1/tasks/head-1/signing/activate",
      "/api/org-1/tasks/head-1/signing/end_grace",
    ]);
    expect(mockDelete.mock.calls.map(([path]) => path)).toEqual([
      "/api/org-1/tasks/head-1/auth",
      "/api/org-1/tasks/head-1/headers/X.API%2BKey/secret",
      "/api/org-1/tasks/head-1/signing",
    ]);
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
    expect(mockPost).toHaveBeenCalledWith("/api/org-1/tasks/head-1/test_connection", {
      input: "hi",
    });
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
    expect(mockPost).toHaveBeenCalledWith("/api/org-1/tasks/head-1/test_run", {
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
    expect(mockDelete).toHaveBeenCalledWith("/api/org-1/tasks/head-1");
  });
});
