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

import llmDiscoveryService from "./llm-discovery.service";

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

function response(item: Record<string, unknown>) {
  return {
    data: {
      list: [item],
      total: 42,
      scopeTotals: { span: 216, trace: 42, session: 11 },
      from: 0,
      size: 20,
      hasMore: true,
    },
  };
}

describe("llmDiscoveryService.search", () => {
  it("sends the documented query params and caps size at the API ceiling", async () => {
    mockGet.mockResolvedValue({ data: { list: [] } });

    await llmDiscoveryService.search("acme", {
      scope: "span",
      startTime: 10,
      endTime: 20,
      from: 40,
      size: 500,
      queueStatus: "reviewed",
    });

    expect(mockGet).toHaveBeenCalledWith("/api/acme/discovery", {
      params: {
        scope: "span",
        queue_status: "reviewed",
        start_time: 10,
        end_time: 20,
        from: 40,
        size: 100,
      },
    });
  });

  it("defaults the queue filter to the triage backlog", async () => {
    mockGet.mockResolvedValue({ data: { list: [] } });

    await llmDiscoveryService.search("acme", { scope: "trace", startTime: 1, endTime: 2 });

    expect(mockGet.mock.calls[0][1].params.queue_status).toBe("not_enqueued");
  });

  it("returns scope totals and paging state alongside the rows", async () => {
    mockGet.mockResolvedValue(response({ targetId: "trace-1", scope: "trace" }));

    const result = await llmDiscoveryService.search("acme", {
      scope: "trace",
      startTime: 1,
      endTime: 2,
    });

    expect(result.total).toBe(42);
    expect(result.scopeTotals).toEqual({ span: 216, trace: 42, session: 11 });
    expect(result.hasMore).toBe(true);
  });

  it("folds a trace row's context into the flat shape", async () => {
    mockGet.mockResolvedValue(
      response({
        scope: "trace",
        targetId: "trace-1",
        traceId: "trace-1",
        refTimestamp: 1_700_000_000_000_000,
        sourceStream: "default",
        quality: "multiple",
        issueCount: 2,
        context: {
          input: "why was my refund declined?",
          serviceName: "support-api",
          operationName: "gen_ai.chat.completions deepseek-v4-pro",
          genAiOperationName: "chat",
          spanKind: "INTERNAL",
        },
        queues: [],
      }),
    );

    const [item] = (
      await llmDiscoveryService.search("acme", { scope: "trace", startTime: 1, endTime: 2 })
    ).items;

    expect(item).toMatchObject({
      targetId: "trace-1",
      input: "why was my refund declined?",
      serviceName: "support-api",
      operationName: "gen_ai.chat.completions deepseek-v4-pro",
      genAiOperationName: "chat",
      spanKind: "INTERNAL",
      quality: "multiple",
      issueCount: 2,
      inQueue: false,
    });
  });

  it("folds a span row's context (kind + duration, no service)", async () => {
    mockGet.mockResolvedValue(
      response({
        scope: "span",
        targetId: "span-9",
        traceId: "trace-1",
        context: {
          input: "retrieve policy docs",
          operationName: "retriever.query",
          genAiOperationName: "execute_tool",
          spanKind: "CLIENT",
          duration: 148_000,
        },
      }),
    );

    const [item] = (
      await llmDiscoveryService.search("acme", { scope: "span", startTime: 1, endTime: 2 })
    ).items;

    expect(item).toMatchObject({
      targetId: "span-9",
      operationName: "retriever.query",
      genAiOperationName: "execute_tool",
      spanKind: "CLIENT",
      durationUs: 148_000,
      serviceName: "",
    });
  });

  it("folds a session row's context including agent parameters", async () => {
    mockGet.mockResolvedValue(
      response({
        scope: "session",
        targetId: "session-3",
        context: {
          input: "hi, I need help",
          sessionId: "session-3",
          userEmail: "user@acme.io",
          traceCount: 7,
          duration: 9_000_000,
          agentParameters: { name: "support-agent", id: "agent-1", version: "3" },
        },
      }),
    );

    const [item] = (
      await llmDiscoveryService.search("acme", { scope: "session", startTime: 1, endTime: 2 })
    ).items;

    expect(item).toMatchObject({
      sessionId: "session-3",
      userEmail: "user@acme.io",
      traceCount: 7,
      durationUs: 9_000_000,
      agentName: "support-agent",
    });
  });

  it("stringifies a JSON input payload and survives a missing context", async () => {
    mockGet.mockResolvedValue(
      response({
        scope: "trace",
        targetId: "trace-2",
        context: { input: [{ role: "user", content: "hello" }] },
      }),
    );

    const [withJson] = (
      await llmDiscoveryService.search("acme", { scope: "trace", startTime: 1, endTime: 2 })
    ).items;
    expect(withJson.input).toBe('[{"role":"user","content":"hello"}]');

    mockGet.mockResolvedValue(response({ scope: "trace", targetId: "trace-3" }));
    const [withoutContext] = (
      await llmDiscoveryService.search("acme", { scope: "trace", startTime: 1, endTime: 2 })
    ).items;
    expect(withoutContext).toMatchObject({
      targetId: "trace-3",
      input: "",
      serviceName: "",
      durationUs: null,
      agentName: null,
    });
  });

  it("keeps only pending/reviewed memberships and derives inQueue", async () => {
    mockGet.mockResolvedValue(
      response({
        scope: "trace",
        targetId: "trace-4",
        queues: [
          { queueId: "q1", queueName: "Safety", status: "pending" },
          { queueId: "q2", queueName: null, status: "reviewed" },
          { queueId: "q3", queueName: "Legacy", status: "in_review" },
          { queueName: "no id", status: "pending" },
        ],
      }),
    );

    const [item] = (
      await llmDiscoveryService.search("acme", { scope: "trace", startTime: 1, endTime: 2 })
    ).items;

    expect(item.queues).toEqual([
      { queueId: "q1", queueName: "Safety", status: "pending" },
      { queueId: "q2", queueName: null, status: "reviewed" },
    ]);
    expect(item.inQueue).toBe(true);
  });
});

describe("llmDiscoveryService.addToQueue", () => {
  it("posts one enqueue request per item with the reference fields", async () => {
    mockPost.mockResolvedValue({ data: {} });

    const count = await llmDiscoveryService.addToQueue("acme", "queue-1", [
      { scope: "span", targetId: "span-1", traceId: "trace-1", refTimestamp: 100 },
      { scope: "trace", targetId: "trace-2", traceId: null, refTimestamp: 200 },
    ]);

    expect(count).toBe(2);
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost).toHaveBeenNthCalledWith(1, "/api/acme/annotation_queues/queue-1/items", {
      refType: "span",
      refId: "span-1",
      refTraceId: "trace-1",
      refTraceStartTime: 100,
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, "/api/acme/annotation_queues/queue-1/items", {
      refType: "trace",
      refId: "trace-2",
      refTraceId: undefined,
      refTraceStartTime: 200,
    });
  });
});
