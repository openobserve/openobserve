import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import store from "@/test/unit/helpers/store";

// Mock the store
vi.mock("@/stores", () => ({
  default: store,
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

import useAiChat from "./useAiChat";

// Mock fetch globally
const mockFetch = vi.fn();
Object.defineProperty(global, "fetch", {
  value: mockFetch,
  writable: true,
  configurable: true,
});

describe("useAiChat", () => {
  let aiChatComposable: ReturnType<typeof useAiChat>;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    mockFetch.mockReset();

    // Reset global fetch mock
    Object.defineProperty(global, "fetch", {
      value: mockFetch,
      writable: true,
      configurable: true,
    });

    // Create a fresh instance of the composable for each test
    aiChatComposable = useAiChat();

    // Clear any existing context handler
    aiChatComposable.removeAiChatHandler();
  });

  afterEach(() => {
    // Clean up after each test
    aiChatComposable.removeAiChatHandler();
  });

  describe("Composable Structure", () => {
    it("should return all expected methods", () => {
      for (const name of [
        "fetchAiChat",
        "chatHistoryServer",
        "registerAiChatHandler",
        "removeAiChatHandler",
        "getStructuredContext",
      ]) {
        expect(typeof (aiChatComposable as any)[name]).toBe("function");
      }
    });

    it("should maintain separate instances", () => {
      const instance1 = useAiChat();
      const instance2 = useAiChat();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe("registerAiChatHandler", () => {
    it("should register a valid function handler", () => {
      const mockHandler = vi.fn().mockResolvedValue("test context");

      expect(() => aiChatComposable.registerAiChatHandler(mockHandler)).not.toThrow();
    });

    it("should register a non-function handler", () => {
      const nonFunctionHandler = "not a function";

      expect(() => aiChatComposable.registerAiChatHandler(nonFunctionHandler)).not.toThrow();
    });

    it("should register null as handler", () => {
      expect(() => aiChatComposable.registerAiChatHandler(null)).not.toThrow();
    });

    it("should register undefined as handler", () => {
      expect(() => aiChatComposable.registerAiChatHandler(undefined)).not.toThrow();
    });

    it("should register an object as handler", () => {
      const objectHandler = { some: "object" };

      expect(() => aiChatComposable.registerAiChatHandler(objectHandler)).not.toThrow();
    });

    it("should overwrite previously registered handler", async () => {
      const handler1 = vi.fn().mockResolvedValue("context1");
      const handler2 = vi.fn().mockResolvedValue("context2");

      aiChatComposable.registerAiChatHandler(handler1);
      aiChatComposable.registerAiChatHandler(handler2);

      mockFetch.mockResolvedValue({ ok: true });
      await aiChatComposable.fetchAiChat([{ role: "user", content: "q" }], "m", "org1");

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe("removeAiChatHandler", () => {
    it("should remove registered handler", async () => {
      const mockHandler = vi.fn().mockResolvedValue("test context");

      aiChatComposable.registerAiChatHandler(mockHandler);
      aiChatComposable.removeAiChatHandler();

      mockFetch.mockResolvedValue({ ok: true });
      await aiChatComposable.fetchAiChat([{ role: "user", content: "q" }], "m", "org1");

      expect(mockHandler).not.toHaveBeenCalled();
    });

    it("should work when no handler is registered", () => {
      expect(() => aiChatComposable.removeAiChatHandler()).not.toThrow();
    });

    it("should work when called multiple times", () => {
      aiChatComposable.removeAiChatHandler();

      expect(() => aiChatComposable.removeAiChatHandler()).not.toThrow();
    });
  });

  describe("fetchAiChat", () => {
    const mockMessages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "How are you?" },
    ];

    beforeEach(() => {
      // Reset fetch mock
      mockFetch.mockReset();
    });

    it("should make API call with correct URL and body when model is provided", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      const model = "gpt-4";
      const orgId = "test-org";

      const result = await aiChatComposable.fetchAiChat(mockMessages, model, orgId);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:5080/api/test-org/ai/chat_stream`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            traceparent: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/),
          }),
        }),
      );
      // Verify body includes model, messages, and context with user_timezone
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      expect(requestBody.model).toBe(model);
      expect(requestBody.messages).toEqual(mockMessages);
      expect(requestBody.context).toBeDefined();
      expect(requestBody.context.user_timezone).toBeDefined();
      expect(result).toBe(mockResponse);
    });

    it("should make API call without model when model is empty string", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      const model = "";
      const orgId = "test-org";

      await aiChatComposable.fetchAiChat(mockMessages, model, orgId);

      // Verify body includes messages and context with user_timezone but no model
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      expect(requestBody.model).toBeUndefined();
      expect(requestBody.messages).toEqual(mockMessages);
      expect(requestBody.context).toBeDefined();
      expect(requestBody.context.user_timezone).toBeDefined();
    });

    it("should not mutate original messages array", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      const originalMessages = [...mockMessages];

      await aiChatComposable.fetchAiChat(mockMessages, "gpt-4", "test-org");

      expect(mockMessages).toEqual(originalMessages);
    });

    it("should add context to last message when context handler is registered", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      const mockContext = { user: "test", session: "123" };
      const mockHandler = vi.fn().mockResolvedValue(mockContext);

      aiChatComposable.registerAiChatHandler(mockHandler);

      await aiChatComposable.fetchAiChat(mockMessages, "gpt-4", "test-org");

      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      const lastMessage = requestBody.messages[requestBody.messages.length - 1];

      expect(lastMessage.content).toContain("How are you?");
      expect(lastMessage.content).toContain("Context");
      expect(lastMessage.content).toContain('user: "test"');
      expect(lastMessage.content).toContain('session: "123"');
    });

    it("should not add context when no handler is registered", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      await aiChatComposable.fetchAiChat(mockMessages, "gpt-4", "test-org");

      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      const lastMessage = requestBody.messages[requestBody.messages.length - 1];

      expect(lastMessage.content).toBe("How are you?");
    });

    it("should handle fetch success response", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ result: "success" }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await aiChatComposable.fetchAiChat(mockMessages, "gpt-4", "test-org");

      expect(result).toBe(mockResponse);
    });

    it("should handle fetch error response", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await aiChatComposable.fetchAiChat(mockMessages, "gpt-4", "test-org");

      expect(result).toBe(mockResponse);
    });

    it("should log a dropped connection as a warning, not an error", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = new TypeError("Failed to fetch");
      mockFetch.mockRejectedValue(error);

      const result = await aiChatComposable.fetchAiChat(mockMessages, "gpt-4", "test-org");

      expect(result).toBeNull();
      expect(errorSpy).not.toHaveBeenCalledWith("Error fetching AI chat:", expect.anything());
      expect(warnSpy).toHaveBeenCalledWith("Error fetching AI chat:", error);

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("should return null when fetch throws an error", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await aiChatComposable.fetchAiChat(mockMessages, "gpt-4", "test-org");

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error fetching AI chat:", expect.any(Error));

      consoleErrorSpy.mockRestore();
    });

    it("should handle different organization IDs correctly", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      await aiChatComposable.fetchAiChat(mockMessages, "gpt-4", "different-org");

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:5080/api/different-org/ai/chat_stream`,
        expect.any(Object),
      );
    });

    it("should handle empty messages array", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      await aiChatComposable.fetchAiChat([], "gpt-4", "test-org");

      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);

      expect(requestBody.messages).toEqual([]);
    });

    it("should handle single message array", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      const singleMessage = [{ role: "user", content: "Single message" }];

      await aiChatComposable.fetchAiChat(singleMessage, "gpt-4", "test-org");

      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);

      expect(requestBody.messages).toHaveLength(1);
      expect(requestBody.messages[0].content).toBe("Single message");
    });

    it("should work with context handler that returns empty string", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      const mockHandler = vi.fn().mockResolvedValue("");
      aiChatComposable.registerAiChatHandler(mockHandler);

      await aiChatComposable.fetchAiChat(mockMessages, "gpt-4", "test-org");

      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      const lastMessage = requestBody.messages[requestBody.messages.length - 1];

      expect(lastMessage.content).toBe("How are you?");
    });

    it("should work with context handler that returns null", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      const mockHandler = vi.fn().mockResolvedValue(null);
      aiChatComposable.registerAiChatHandler(mockHandler);

      await aiChatComposable.fetchAiChat(mockMessages, "gpt-4", "test-org");

      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);
      const lastMessage = requestBody.messages[requestBody.messages.length - 1];

      expect(lastMessage.content).toBe("How are you?");
    });

    it("should include x-o2-assistant-session-id header when sessionId is provided", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      const sessionId = "01234567-89ab-cdef-0123-456789abcdef";

      await aiChatComposable.fetchAiChat(
        mockMessages,
        "gpt-4",
        "test-org",
        undefined,
        undefined,
        sessionId,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-o2-assistant-session-id": sessionId,
          }),
        }),
      );
    });

    it("should not include x-o2-assistant-session-id header when sessionId is not provided", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      await aiChatComposable.fetchAiChat(mockMessages, "gpt-4", "test-org");

      const callArgs = mockFetch.mock.calls[0][1];

      expect(callArgs.headers).not.toHaveProperty("x-o2-assistant-session-id");
    });

    it("should not include x-o2-assistant-session-id header when sessionId is undefined", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      await aiChatComposable.fetchAiChat(
        mockMessages,
        "gpt-4",
        "test-org",
        undefined,
        undefined,
        undefined,
      );

      const callArgs = mockFetch.mock.calls[0][1];

      expect(callArgs.headers).not.toHaveProperty("x-o2-assistant-session-id");
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete workflow with context", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      const mockContext = { workspace: "test", user_id: "user123" };
      const mockHandler = vi.fn().mockResolvedValue(mockContext);

      // Register handler
      aiChatComposable.registerAiChatHandler(mockHandler);

      // Make API call
      const messages = [{ role: "user", content: "Test query" }];
      await aiChatComposable.fetchAiChat(messages, "gpt-4", "org123");

      // Verify the call was made with formatted context
      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);

      expect(requestBody.messages[0].content).toContain("Test query");
      expect(requestBody.messages[0].content).toContain("Context");
      expect(requestBody.messages[0].content).toContain('workspace: "test"');
      expect(requestBody.messages[0].content).toContain('user_id: "user123"');
    });

    it("should handle handler removal during workflow", async () => {
      const mockResponse = { ok: true, json: vi.fn() };
      mockFetch.mockResolvedValue(mockResponse);

      const mockHandler = vi.fn().mockResolvedValue({ data: "test" });

      // Register and then remove handler
      aiChatComposable.registerAiChatHandler(mockHandler);
      aiChatComposable.removeAiChatHandler();

      // Make API call
      const messages = [{ role: "user", content: "Test" }];
      await aiChatComposable.fetchAiChat(messages, "gpt-4", "org123");

      // Verify no context was added
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs.body);

      expect(requestBody.messages[0].content).toBe("Test");
    });
  });

  describe("server-side chat requests", () => {
    it("sends known_version only alongside known_seq", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      await aiChatComposable.chatHistoryServer().get("org1", "s1", 4, 50, "v2");
      await aiChatComposable.chatHistoryServer().get("org1", "s1", undefined, undefined, "v2");
      expect(mockFetch.mock.calls[0][0]).toContain("?known_seq=4&known_version=v2&limit=50");
      expect(mockFetch.mock.calls[1][0]).not.toContain("known_version");
    });
  });
});
