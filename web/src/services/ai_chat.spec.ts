// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAiChat } from "./ai_chat";
import http from "./http";

vi.mock("./http", () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({
    traceparent: "00-traceid-spanid-01",
  })),
}));

import { generateTraceContext } from "@/utils/zincutils";

describe("ai_chat service", () => {
  let mockHttpInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpInstance = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    (http as any).mockReturnValue(mockHttpInstance);
  });

  describe("getAiChat", () => {
    it("should call generateTraceContext to obtain a traceparent header", async () => {
      await getAiChat([{ role: "user", content: "Hello" }]);

      expect(generateTraceContext).toHaveBeenCalled();
    });

    it("should call http with the traceparent header returned by generateTraceContext", async () => {
      await getAiChat([{ role: "user", content: "Hello" }]);

      expect(http).toHaveBeenCalledWith({
        headers: { traceparent: "00-traceid-spanid-01" },
      });
    });

    it("should POST to /api/default/ai/chat_stream", async () => {
      const messages = [{ role: "user", content: "Hello" }];

      await getAiChat(messages);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/default/ai/chat_stream",
        { messages }
      );
    });

    it("should wrap messages in a { messages } object as the request body", async () => {
      const messages = [
        { role: "user", content: "What is OpenObserve?" },
        { role: "assistant", content: "OpenObserve is an observability platform." },
        { role: "user", content: "Tell me more." },
      ];

      await getAiChat(messages);

      const postCallArgs = mockHttpInstance.post.mock.calls[0];
      expect(postCallArgs[1]).toEqual({ messages });
    });

    it("should hardcode the endpoint to /api/default/ai/chat_stream", async () => {
      await getAiChat([]);

      const postCallArgs = mockHttpInstance.post.mock.calls[0];
      expect(postCallArgs[0]).toBe("/api/default/ai/chat_stream");
    });

    it("should not call get, put, patch, or delete", async () => {
      await getAiChat([{ role: "user", content: "Hello" }]);

      expect(mockHttpInstance.get).not.toHaveBeenCalled();
      expect(mockHttpInstance.put).not.toHaveBeenCalled();
      expect(mockHttpInstance.patch).not.toHaveBeenCalled();
      expect(mockHttpInstance.delete).not.toHaveBeenCalled();
    });

    it("should return the HTTP response from the POST call", async () => {
      const mockResponse = { data: { response: "AI reply" } };
      mockHttpInstance.post.mockResolvedValue(mockResponse);

      const result = await getAiChat([{ role: "user", content: "Hello" }]);

      expect(result).toEqual(mockResponse);
    });

    it("should handle an empty messages array", async () => {
      await getAiChat([]);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/default/ai/chat_stream",
        { messages: [] }
      );
    });

    it("should handle a single user message", async () => {
      const messages = [{ role: "user", content: "Explain PromQL" }];

      await getAiChat(messages);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/default/ai/chat_stream",
        { messages }
      );
    });

    it("should handle a multi-turn conversation", async () => {
      const messages = [
        { role: "user", content: "How do I write a PromQL query?" },
        { role: "assistant", content: "Here is how you write a PromQL query..." },
        { role: "user", content: "Can you give me an example?" },
        { role: "assistant", content: "Sure! Here is an example: up{job='prometheus'}" },
        { role: "user", content: "Thanks! What about query ranges?" },
      ];

      await getAiChat(messages);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/default/ai/chat_stream",
        { messages }
      );
    });

    it("should handle messages with special characters", async () => {
      const messages = [
        {
          role: "user",
          content: "Query: rate(http_requests_total{status=~\"5..\"}[5m]) & explain it",
        },
      ];

      await getAiChat(messages);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/default/ai/chat_stream",
        { messages }
      );
    });

    it("should handle messages with nested objects", async () => {
      const messages = [
        {
          role: "user",
          content: "Analyze this",
          metadata: { context: "logs", org: "default" },
          attachments: [{ type: "query", data: "SELECT * FROM logs" }],
        },
      ];

      await getAiChat(messages);

      expect(mockHttpInstance.post).toHaveBeenCalledWith(
        "/api/default/ai/chat_stream",
        { messages }
      );
    });

    it("should generate a new trace context on every call", async () => {
      await getAiChat([{ role: "user", content: "First message" }]);
      await getAiChat([{ role: "user", content: "Second message" }]);

      expect(generateTraceContext).toHaveBeenCalledTimes(2);
    });

    it("should pass the traceparent from generateTraceContext into the http headers", async () => {
      const customTraceparent = "00-custom-trace-id-span-id-01";
      (generateTraceContext as any).mockReturnValue({ traceparent: customTraceparent });

      await getAiChat([{ role: "user", content: "Hello" }]);

      expect(http).toHaveBeenCalledWith({
        headers: { traceparent: customTraceparent },
      });
    });

    it("should propagate HTTP errors", async () => {
      mockHttpInstance.post.mockRejectedValue(new Error("AI service unavailable"));

      await expect(getAiChat([{ role: "user", content: "Hello" }])).rejects.toThrow(
        "AI service unavailable"
      );
    });

    it("should propagate 401 errors", async () => {
      const unauthorizedError = {
        response: { status: 401, data: { error: "Unauthorized" } },
      };
      mockHttpInstance.post.mockRejectedValue(unauthorizedError);

      await expect(getAiChat([{ role: "user", content: "Hello" }])).rejects.toEqual(
        unauthorizedError
      );
    });

    it("should propagate 500 errors from the AI backend", async () => {
      const serverError = {
        response: { status: 500, data: { error: "AI backend error" } },
      };
      mockHttpInstance.post.mockRejectedValue(serverError);

      await expect(getAiChat([{ role: "user", content: "Hello" }])).rejects.toEqual(
        serverError
      );
    });

    it("should not pass any query parameters in the URL", async () => {
      await getAiChat([{ role: "user", content: "Hello" }]);

      const postCallArgs = mockHttpInstance.post.mock.calls[0];
      expect(postCallArgs[0]).not.toContain("?");
    });

    it("should always use the same hardcoded org 'default' in the URL", async () => {
      await getAiChat([{ role: "user", content: "Hello" }]);

      const postCallArgs = mockHttpInstance.post.mock.calls[0];
      expect(postCallArgs[0]).toContain("/api/default/");
    });
  });
});
