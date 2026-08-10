import { beforeEach, describe, expect, it, vi } from "vitest";

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

import llmDatasetsService from "./llm-datasets.service";

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
});

/** One row as the items API returns it (camelCase, JSON input/expectedOutput). */
function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    rowId: "row-2",
    logicalId: "item-1",
    orgId: "acme",
    datasetId: "dataset-1",
    input: "is a refund allowed after 30 days?",
    expectedOutput: "No — beyond 30 days requires manual review.",
    globalVersion: 7,
    isDeleted: false,
    source: "annotation",
    sourceRef: "queue:refund/trace-48",
    tags: ["refund", "policy"],
    updatedBy: "sam@openobserve.ai",
    updatedAt: 1_700_000_000,
    ...overrides,
  };
}

describe("llmDatasetsService.listItems", () => {
  it("pages server-side and caps size at the API ceiling", async () => {
    mockGet.mockResolvedValue({ data: { list: [], total: 0, from: 0, size: 20, hasMore: false } });

    await llmDatasetsService.listItems("acme", "dataset-1", { from: 40, size: 500 });

    expect(mockGet).toHaveBeenCalledWith("/api/acme/datasets/dataset-1/items", {
      params: { from: 40, size: 100, includeDeleted: false },
    });
  });

  it("returns the page envelope with the rows normalized", async () => {
    mockGet.mockResolvedValue({
      data: { list: [itemRow()], total: 42, from: 0, size: 20, hasMore: true },
    });

    const page = await llmDatasetsService.listItems("acme", "dataset-1");

    expect(page).toMatchObject({ total: 42, from: 0, size: 20, hasMore: true });
    expect(page.items[0]).toMatchObject({
      // The LOGICAL id addresses the item; rowId is this one immutable version.
      id: "item-1",
      rowId: "row-2",
      datasetId: "dataset-1",
      source: "annotation",
      tags: ["refund", "policy"],
      version: 7,
      distilledFrom: "queue:refund/trace-48",
      isDeleted: false,
    });
  });

  it("flattens a structured input for display but keeps the original value", async () => {
    const input = [{ role: "user", content: "hello" }];
    mockGet.mockResolvedValue({ data: { list: [itemRow({ input })] } });

    const [item] = (await llmDatasetsService.listItems("acme", "dataset-1")).items;

    // The stored payload is preserved verbatim for editing and re-sending...
    expect(item.input).toBe('[{"role":"user","content":"hello"}]');
    expect(item.rawInput).toEqual(input);
    // ...while the table shows just the content of a single message.
    expect(item.inputPreview).toBe("hello");
  });

  it("keeps roles in the preview once a conversation has more than one message", async () => {
    mockGet.mockResolvedValue({
      data: {
        list: [
          itemRow({
            input: [
              { role: "system", content: "be terse" },
              { role: "user", content: "hello" },
            ],
          }),
        ],
      },
    });

    const [item] = (await llmDatasetsService.listItems("acme", "dataset-1")).items;

    expect(item.inputPreview).toBe("system: be terse\nuser: hello");
  });

  it("falls back to the raw JSON when the payload is not a message list", async () => {
    mockGet.mockResolvedValue({ data: { list: [itemRow({ input: { foo: "bar" } })] } });

    const [item] = (await llmDatasetsService.listItems("acme", "dataset-1")).items;

    expect(item.inputPreview).toBe('{"foo":"bar"}');
  });

  it("falls back to review submission and import lineage", async () => {
    mockGet.mockResolvedValue({
      data: {
        list: [itemRow({ sourceRef: null, reviewSubmissionId: "sub-9", importFilename: "a.csv" })],
      },
    });

    const [item] = (await llmDatasetsService.listItems("acme", "dataset-1")).items;

    expect(item.distilledFrom).toBe("sub-9");
  });
});

describe("llmDatasetsService item writes", () => {
  it("adds an item through the manual entry point", async () => {
    mockPost.mockResolvedValue({ data: { created: true, item: itemRow() } });

    const item = await llmDatasetsService.addItem("acme", "dataset-1", {
      input: "question",
      expectedOutput: "answer",
      tags: ["refund"],
    });

    expect(mockPost).toHaveBeenCalledWith("/api/acme/datasets/dataset-1/items", {
      entryPoint: "manual",
      input: "question",
      expectedOutput: "answer",
      metadata: null,
      tags: ["refund"],
    });
    // The push response wraps the row in { created, item }.
    expect(item.id).toBe("item-1");
  });

  it("updates an item by its LOGICAL id and sends tags", async () => {
    mockPut.mockResolvedValue({ data: itemRow({ globalVersion: 8 }) });

    const item = await llmDatasetsService.updateItem("acme", "dataset-1", "item-1", {
      input: "question",
      expectedOutput: "better answer",
      tags: ["refund", "policy"],
    });

    expect(mockPut).toHaveBeenCalledWith("/api/acme/datasets/dataset-1/items/item-1", {
      input: "question",
      expectedOutput: "better answer",
      metadata: null,
      tags: ["refund", "policy"],
    });
    expect(item.version).toBe(8);
  });

  it("re-sends a structured value untouched when only the answer changed", async () => {
    mockPut.mockResolvedValue({ data: itemRow() });
    const structuredInput = [{ role: "user", content: "hello" }];

    await llmDatasetsService.updateItem("acme", "dataset-1", "item-1", {
      input: structuredInput,
      expectedOutput: "new answer",
      tags: [],
    });

    expect(mockPut.mock.calls[0][1].input).toEqual(structuredInput);
  });

  it("soft-deletes an item by its logical id", async () => {
    mockDelete.mockResolvedValue({ data: itemRow({ isDeleted: true }) });

    await llmDatasetsService.removeItem("acme", "dataset-1", "item-1");

    expect(mockDelete).toHaveBeenCalledWith("/api/acme/datasets/dataset-1/items/item-1");
  });
});

describe("llmDatasetsService.getItemVersions", () => {
  it("returns every immutable version of one logical item", async () => {
    mockGet.mockResolvedValue({
      data: {
        list: [
          itemRow({ rowId: "row-v1", globalVersion: 1, expectedOutput: "old answer" }),
          itemRow({ rowId: "row-v2", globalVersion: 3, expectedOutput: "new answer" }),
        ],
      },
    });

    const versions = await llmDatasetsService.getItemVersions("acme", "dataset-1", "item-1");

    expect(mockGet).toHaveBeenCalledWith("/api/acme/datasets/dataset-1/items/item-1");
    expect(versions.map(({ rowId, id, version }) => ({ rowId, id, version }))).toEqual([
      { rowId: "row-v1", id: "item-1", version: 1 },
      { rowId: "row-v2", id: "item-1", version: 3 },
    ]);
  });
});

describe("llmDatasetsService dataset writes", () => {
  it("sends dataset-level tags on create", async () => {
    mockPost.mockResolvedValue({ data: { id: "dataset-1", name: "Goldens", tags: ["rag"] } });

    const dataset = await llmDatasetsService.create("acme", {
      name: "Goldens",
      description: null,
      tags: ["rag"],
    });

    expect(mockPost).toHaveBeenCalledWith("/api/acme/datasets", {
      name: "Goldens",
      description: null,
      tags: ["rag"],
    });
    expect(dataset.tags).toEqual(["rag"]);
  });

  it("sends an empty tag array on update so tags can be cleared", async () => {
    mockPut.mockResolvedValue({ data: { id: "dataset-1", name: "Goldens", tags: [] } });

    await llmDatasetsService.update("acme", "dataset-1", { name: "Goldens" });

    expect(mockPut).toHaveBeenCalledWith("/api/acme/datasets/dataset-1", {
      name: "Goldens",
      description: null,
      tags: [],
    });
  });
});
