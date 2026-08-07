// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { beforeEach, describe, expect, it, vi } from "vitest";
import http from "@/services/http";
import llmDatasetsService from "@/services/llm-datasets.service";

vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("LLM datasets service", () => {
  let mockHttp: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };
    vi.mocked(http).mockReturnValue(mockHttp as any);
  });

  it("sends dataset tags when creating metadata", async () => {
    mockHttp.post.mockResolvedValue({
      data: { id: "dataset-1", name: "Golden set", description: null, tags: ["rag"] },
    });

    const dataset = await llmDatasetsService.create("org-1", {
      name: "Golden set",
      tags: ["rag"],
    });

    expect(mockHttp.post).toHaveBeenCalledWith("/api/org-1/datasets", {
      name: "Golden set",
      description: null,
      tags: ["rag"],
    });
    expect(dataset.tags).toEqual(["rag"]);
  });

  it("sends an empty tag array on update so tags can be cleared", async () => {
    mockHttp.put.mockResolvedValue({
      data: { id: "dataset-1", name: "Golden set", description: null, tags: [] },
    });

    await llmDatasetsService.update("org-1", "dataset-1", {
      name: "Golden set",
    });

    expect(mockHttp.put).toHaveBeenCalledWith("/api/org-1/datasets/dataset-1", {
      name: "Golden set",
      description: null,
      tags: [],
    });
  });

  it("gets every immutable version of one logical Dataset Item", async () => {
    mockHttp.get.mockResolvedValue({
      data: {
        list: [
          {
            rowId: "row-v1",
            logicalId: "item-1",
            datasetId: "dataset-1",
            input: "question",
            expectedOutput: "old answer",
            globalVersion: 1,
            isDeleted: false,
            source: "manual",
            tags: [],
          },
          {
            rowId: "row-v2",
            logicalId: "item-1",
            datasetId: "dataset-1",
            input: "question",
            expectedOutput: "new answer",
            globalVersion: 3,
            isDeleted: false,
            source: "manual",
            tags: ["regression"],
          },
        ],
      },
    });

    const versions = await llmDatasetsService.getItemVersions(
      "org-1",
      "dataset-1",
      "item-1",
    );

    expect(mockHttp.get).toHaveBeenCalledWith("/api/org-1/datasets/dataset-1/items/item-1");
    expect(versions.map(({ rowId, id, version }) => ({ rowId, id, version }))).toEqual([
      { rowId: "row-v1", id: "item-1", version: 1 },
      { rowId: "row-v2", id: "item-1", version: 3 },
    ]);
  });
});
