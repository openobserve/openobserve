import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock("@/services/http", () => ({
  default: () => ({
    get: mockGet,
  }),
}));

import llmDiscoveryService from "./llm-discovery.service";

beforeEach(() => {
  mockGet.mockReset();
});

describe("llmDiscoveryService queue membership contract", () => {
  it("normalizes every queue membership returned for a discovered item", async () => {
    mockGet.mockResolvedValue({
      data: {
        list: [
          {
            scope: "trace",
            targetId: "trace-1",
            traceId: "trace-1",
            refTimestamp: 123,
            quality: "issue",
            issueCount: 1,
            queues: [
              { queueId: "queue-1", queueName: "Safety review", status: "pending" },
              { queueId: "queue-2", queueName: "Completed review", status: "reviewed" },
            ],
          },
        ],
      },
    });

    const result = await llmDiscoveryService.search("acme", {
      scope: "trace",
      startTime: 100,
      endTime: 200,
      queueStatus: "enqueued",
    });

    expect(result.items[0].queues).toEqual([
      { queueId: "queue-1", queueName: "Safety review", status: "pending" },
      { queueId: "queue-2", queueName: "Completed review", status: "reviewed" },
    ]);
    expect(result.items[0].inQueue).toBe(true);
  });

  it("marks an item without memberships as not enqueued", async () => {
    mockGet.mockResolvedValue({
      data: {
        list: [
          {
            scope: "trace",
            targetId: "trace-1",
            refTimestamp: 123,
            quality: "issue",
            issueCount: 1,
            queues: [],
          },
        ],
      },
    });

    const result = await llmDiscoveryService.search("acme", {
      scope: "trace",
      startTime: 100,
      endTime: 200,
    });

    expect(result.items[0].queues).toEqual([]);
    expect(result.items[0].inQueue).toBe(false);
  });
});
