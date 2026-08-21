import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock("@/services/http", () => ({
  default: () => ({
    get: mockGet,
    post: mockPost,
  }),
}));

import llmQueuesService from "./llm-queues.service";

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

describe("llmQueuesService queue and item contracts", () => {
  it("normalizes queue bindings returned by the backend", async () => {
    mockGet.mockResolvedValue({
      data: {
        list: [
          {
            id: "queue-1",
            orgId: "acme",
            name: "Safety",
            description: null,
            targetDatasetId: "dataset-1",
            targetDatasetName: "Golden answers",
            allowedRefTypes: ["trace"],
            reviewedCount: 3,
            totalCount: 8,
            scoreConfigs: [
              {
                rowId: "score-row-v2",
                entityId: "score-config-1",
                name: "faithfulness",
                version: 2,
                dataType: "numeric",
              },
            ],
            createdAt: 10,
            updatedAt: 20,
          },
        ],
      },
    });

    const queues = await llmQueuesService.list("acme");

    expect(mockGet).toHaveBeenCalledWith("/api/acme/annotation_queues");
    expect(queues[0]).toMatchObject({
      id: "queue-1",
      targetDatasetId: "dataset-1",
      targetDatasetName: "Golden answers",
      reviewedCount: 3,
      totalCount: 8,
      scoreConfigs: [
        {
          rowId: "score-row-v2",
          scoreConfigId: "score-config-1",
          version: 2,
          dataType: "numeric",
        },
      ],
    });
  });

  it("lists one queue's active items with the backend query parameter", async () => {
    mockGet.mockResolvedValue({
      data: {
        list: [
          {
            id: "item-1",
            queueId: "queue-1",
            refType: "trace",
            refId: "trace-1",
            refTraceStartTime: 1_700_000_000_000_000,
            status: "pending",
            archivedAt: null,
            createdAt: 10,
            updatedAt: 10,
          },
          {
            id: "item-archived",
            queueId: "queue-1",
            refType: "trace",
            refId: "trace-2",
            refTraceStartTime: 1_700_000_000_000_000,
            status: "reviewed",
            archivedAt: 20,
            createdAt: 10,
            updatedAt: 20,
          },
        ],
      },
    });

    const items = await llmQueuesService.listItems("acme", "queue-1");

    expect(mockGet).toHaveBeenCalledWith("/api/acme/annotation_queues/items", {
      params: { queue_id: "queue-1" },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "item-1",
      queueId: "queue-1",
      refTraceStartTime: 1_700_000_000_000_000,
    });
  });
});

describe("llmQueuesService Workbench contracts", () => {
  it("hydrates item content and machine scores from the detail endpoint", async () => {
    mockGet.mockResolvedValue({
      data: {
        item: {
          id: "item-1",
          queueId: "queue-1",
          refType: "span",
          refId: "span-1",
          refTraceId: "trace-1",
          refTraceStartTime: 123,
          status: "pending",
          createdAt: 1,
          updatedAt: 1,
        },
        sourceStream: "otel_traces",
        content: {
          input: { question: "hello" },
          output: "world",
          trace: [{ trace_id: "trace-1" }],
        },
        machineScores: [
          {
            id: "score-1",
            name: "faithfulness",
            valueNumeric: 0.8,
            dataType: "numeric",
            sourceType: "llm_judge",
            timestamp: 456,
          },
        ],
        reviews: [
          {
            submissionId: "submission-1",
            reviewer: "reviewer@example.com",
            comments: null,
            submittedAt: 789,
            scores: [{ name: "faithfulness", value_numeric: 1 }],
          },
        ],
      },
    });

    const detail = await llmQueuesService.getItemDetail("acme", "queue-1", "item-1");

    expect(mockGet).toHaveBeenCalledWith("/api/acme/annotation_queues/queue-1/items/item-1");
    expect(detail.sourceStream).toBe("otel_traces");
    expect(detail.content.input).toEqual({ question: "hello" });
    expect(detail.machineScores[0]).toMatchObject({
      name: "faithfulness",
      value: 0.8,
      sourceType: "llm_judge",
    });
    expect(detail.reviews).toHaveLength(1);
    expect(detail.reviews[0]).toMatchObject({
      submissionId: "submission-1",
      scores: [{ name: "faithfulness", value: 1 }],
    });
  });

  it("normalizes authoritative prior review Scores", async () => {
    mockGet.mockResolvedValue({
      data: {
        list: [
          {
            submissionId: "submission-1",
            reviewer: "reviewer@example.com",
            comments: "looks good",
            submittedAt: 1_700_000_000_000_000,
            scores: [
              { name: "faithfulness", value_numeric: 0.9 },
              { name: "grounded", value_boolean: false },
            ],
          },
        ],
      },
    });

    const reviews = await llmQueuesService.listReviews("acme", "queue-1", "item-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/api/acme/annotation_queues/queue-1/items/item-1/reviews",
    );
    expect(reviews[0].scores).toEqual([
      { name: "faithfulness", value: 0.9 },
      { name: "grounded", value: false },
    ]);
  });

  it("posts a complete N/N review to the item reviews endpoint", async () => {
    mockPost.mockResolvedValue({
      data: { annotationId: "submission-1", scoreIds: ["score-1"], annotatedAt: 123 },
    });
    const payload = {
      submissionId: "submission-1",
      sourceStream: "otel_traces",
      scores: [{ scoreConfigRowId: "row-1", value: true }],
      comments: "confirmed",
    };

    const result = await llmQueuesService.submitReview("acme", "queue-1", "item-1", payload);

    expect(mockPost).toHaveBeenCalledWith(
      "/api/acme/annotation_queues/queue-1/items/item-1/reviews",
      payload,
    );
    expect(result.annotationId).toBe("submission-1");
  });
});

describe("llmQueuesService Score Config version contracts", () => {
  it("loads version rows and creates a queue with physical row IDs", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === "/api/acme/score_configs") {
        return Promise.resolve({
          data: {
            list: [
              {
                id: "row-v2",
                entityId: "config-1",
                name: "faithfulness",
                version: 2,
                dataType: "numeric",
              },
            ],
          },
        });
      }
      return Promise.resolve({
        data: {
          versions: [
            {
              id: "row-v1",
              entityId: "config-1",
              name: "faithfulness",
              version: 1,
              dataType: "numeric",
              numericRange: { min: 0, max: 5 },
              healthyThreshold: { direction: "gte", value: 4 },
            },
            {
              id: "row-v2",
              entityId: "config-1",
              name: "faithfulness",
              version: 2,
              dataType: "numeric",
              numericRange: { min: 0, max: 1 },
            },
          ],
        },
      });
    });
    mockPost.mockResolvedValue({
      data: {
        id: "queue-1",
        name: "Review",
        scoreConfigs: [],
        allowedRefTypes: [],
      },
    });

    const options = await llmQueuesService.listScoreConfigOptions("acme");
    await llmQueuesService.create("acme", {
      name: "Review",
      scoreConfigs: [{ scoreConfigId: "config-1", version: 1 }],
    });

    expect(mockGet).toHaveBeenCalledWith("/api/acme/score_configs/config-1/versions");
    expect(options[0]).toMatchObject({
      id: "config-1",
      versions: [1, 2],
      latestVersion: 2,
      versionDetails: {
        1: {
          rowId: "row-v1",
          numericRange: { min: 0, max: 5 },
          healthyThreshold: { direction: "gte", value: 4 },
        },
      },
    });
    expect(mockPost).toHaveBeenCalledWith("/api/acme/annotation_queues", {
      name: "Review",
      description: null,
      targetDatasetId: null,
      scoreConfigRowIds: ["row-v1"],
    });
  });
});
