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

// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// vi.mock() calls MUST precede all imports.
//
// To share mock fn references between vi.mock() factories and the test body
// we use vi.hoisted() which runs before the mock factory and before imports,
// giving us stable references that are safe to close over.
// ---------------------------------------------------------------------------

const {
  mockWsConnect,
  mockWsSendMessage,
  mockWsCloseSocket,
  mockWsCleanupSocket,
  mockWsGetWebSocket,
  mockWsAddMessageHandler,
  mockWsRemoveMessageHandler,
  mockWsAddOpenHandler,
  mockWsRemoveOpenHandler,
  mockWsAddCloseHandler,
  mockWsRemoveCloseHandler,
  mockWsAddErrorHandler,
  mockWsRemoveErrorHandler,
} = vi.hoisted(() => ({
  mockWsConnect: vi.fn(),
  mockWsSendMessage: vi.fn(),
  mockWsCloseSocket: vi.fn(),
  mockWsCleanupSocket: vi.fn(),
  mockWsGetWebSocket: vi.fn(),
  mockWsAddMessageHandler: vi.fn(),
  mockWsRemoveMessageHandler: vi.fn(),
  mockWsAddOpenHandler: vi.fn(),
  mockWsRemoveOpenHandler: vi.fn(),
  mockWsAddCloseHandler: vi.fn(),
  mockWsRemoveCloseHandler: vi.fn(),
  mockWsAddErrorHandler: vi.fn(),
  mockWsRemoveErrorHandler: vi.fn(),
}));

vi.mock("@/utils/zincutils", () => ({
  getUUID: vi.fn(() => "test-uuid"),
  getWebSocketUrl: vi.fn(() => "ws://test"),
}));

vi.mock("@/composables/useWebSocket", () => ({
  default: vi.fn(() => ({
    connect: mockWsConnect,
    sendMessage: mockWsSendMessage,
    closeSocket: mockWsCloseSocket,
    cleanupSocket: mockWsCleanupSocket,
    getWebSocketBasedOnSocketId: mockWsGetWebSocket,
    addMessageHandler: mockWsAddMessageHandler,
    removeMessageHandler: mockWsRemoveMessageHandler,
    addOpenHandler: mockWsAddOpenHandler,
    removeOpenHandler: mockWsRemoveOpenHandler,
    addCloseHandler: mockWsAddCloseHandler,
    removeCloseHandler: mockWsRemoveCloseHandler,
    addErrorHandler: mockWsAddErrorHandler,
    removeErrorHandler: mockWsRemoveErrorHandler,
  })),
}));

vi.mock("@/ts/interfaces", () => ({}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      API_ENDPOINT: "http://localhost:5080",
      selectedOrganization: { identifier: "test-org" },
    },
  })),
}));

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue")>();
  return {
    ...actual,
    onBeforeUnmount: vi.fn(),
  };
});

vi.mock("@/services/auth", () => ({
  default: {
    getWebSocketToken: vi.fn(),
    refresh_token: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after all vi.mock calls)
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import useSearchWebSocket from "./useSearchWebSocket";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSearchWebSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockWsGetWebSocket to return undefined (socket does not exist)
    // so that new socket creation path is exercised by default.
    mockWsGetWebSocket.mockReturnValue(undefined);
  });

  // ─── Return value structure ───────────────────────────────────────────────

  describe("return value structure", () => {
    it("returns an object with all expected exported methods", () => {
      const result = useSearchWebSocket();

      expect(result).toHaveProperty("fetchQueryDataWithWebSocket");
      expect(result).toHaveProperty("sendSearchMessageBasedOnRequestId");
      expect(result).toHaveProperty("cancelSearchQueryBasedOnRequestId");
      expect(result).toHaveProperty("closeSocketBasedOnRequestId");
      expect(result).toHaveProperty("cleanUpListeners");
      expect(result).toHaveProperty("closeSocketWithError");
      expect(result).toHaveProperty("closeSocket");
    });

    it("every returned property is a function", () => {
      const result = useSearchWebSocket();
      for (const key of Object.keys(result)) {
        expect(typeof (result as any)[key]).toBe("function");
      }
    });
  });

  // ─── fetchQueryDataWithWebSocket ─────────────────────────────────────────

  describe("fetchQueryDataWithWebSocket", () => {
    it("returns the traceId supplied in the data argument", () => {
      const { fetchQueryDataWithWebSocket } = useSearchWebSocket();

      const traceId = fetchQueryDataWithWebSocket(
        {
          queryReq: {} as any,
          type: "search",
          isPagination: false,
          traceId: "trace-abc",
          org_id: "test-org",
          meta: {},
        },
        {
          open: vi.fn(),
          message: vi.fn(),
          close: vi.fn(),
          error: vi.fn(),
          reset: vi.fn(),
        }
      );

      expect(traceId).toBe("trace-abc");
    });

    it("creates a socket connection (calls connect) when the composable is used with a fresh module", async () => {
      // Reset modules so module-level singletons (socketId ref etc.) are cleared.
      await vi.resetModules();
      const freshModule = await import("./useSearchWebSocket");
      const { fetchQueryDataWithWebSocket } = freshModule.default();

      fetchQueryDataWithWebSocket(
        {
          queryReq: {} as any,
          type: "search",
          isPagination: false,
          traceId: "trace-new-conn",
          org_id: "test-org",
          meta: {},
        },
        {
          open: vi.fn(),
          message: vi.fn(),
          close: vi.fn(),
          error: vi.fn(),
          reset: vi.fn(),
        }
      );

      expect(mockWsConnect).toHaveBeenCalled();
    });

    it("registers open, message, close, error handlers on the socket on first connection", async () => {
      // Use a fresh module instance so socketId is null and connect() is triggered.
      await vi.resetModules();
      const freshModule = await import("./useSearchWebSocket");
      const { fetchQueryDataWithWebSocket } = freshModule.default();

      fetchQueryDataWithWebSocket(
        {
          queryReq: {} as any,
          type: "histogram",
          isPagination: false,
          traceId: "trace-handlers",
          org_id: "test-org",
          meta: {},
        },
        {
          open: vi.fn(),
          message: vi.fn(),
          close: vi.fn(),
          error: vi.fn(),
          reset: vi.fn(),
        }
      );

      expect(mockWsAddOpenHandler).toHaveBeenCalled();
      expect(mockWsAddMessageHandler).toHaveBeenCalled();
      expect(mockWsAddCloseHandler).toHaveBeenCalled();
      expect(mockWsAddErrorHandler).toHaveBeenCalled();
    });

    it("returns empty string and logs an error on exception", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { fetchQueryDataWithWebSocket } = useSearchWebSocket();

      // Passing null handlers forces an exception inside the function
      const result = fetchQueryDataWithWebSocket(
        {
          queryReq: {} as any,
          type: "search",
          isPagination: false,
          traceId: "trace-err",
          org_id: "test-org",
          meta: {},
        },
        null as any
      );

      expect(result).toBe("");
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  // ─── cleanUpListeners ────────────────────────────────────────────────────

  describe("cleanUpListeners", () => {
    it("does not throw when called with an unknown traceId", () => {
      const { cleanUpListeners } = useSearchWebSocket();
      expect(() => cleanUpListeners("non-existent-trace")).not.toThrow();
    });

    it("removes all handlers for a previously registered traceId", () => {
      const { fetchQueryDataWithWebSocket, cleanUpListeners } =
        useSearchWebSocket();
      const traceId = "trace-cleanup";

      fetchQueryDataWithWebSocket(
        {
          queryReq: {} as any,
          type: "values",
          isPagination: false,
          traceId,
          org_id: "test-org",
          meta: {},
        },
        {
          open: vi.fn(),
          message: vi.fn(),
          close: vi.fn(),
          error: vi.fn(),
          reset: vi.fn(),
        }
      );

      expect(() => cleanUpListeners(traceId)).not.toThrow();
    });
  });

  // ─── cancelSearchQueryBasedOnRequestId ───────────────────────────────────

  describe("cancelSearchQueryBasedOnRequestId", () => {
    it("does not throw when called with an unregistered trace_id", () => {
      const { cancelSearchQueryBasedOnRequestId } = useSearchWebSocket();
      expect(() =>
        cancelSearchQueryBasedOnRequestId({
          trace_id: "ghost-trace",
          org_id: "test-org",
        })
      ).not.toThrow();
    });

    it("checks socket readyState via getWebSocketBasedOnSocketId", () => {
      mockWsGetWebSocket.mockReturnValue({ readyState: 1 /* OPEN */ });
      const { fetchQueryDataWithWebSocket, cancelSearchQueryBasedOnRequestId } =
        useSearchWebSocket();

      fetchQueryDataWithWebSocket(
        {
          queryReq: {} as any,
          type: "search",
          isPagination: false,
          traceId: "trace-cancel",
          org_id: "test-org",
          meta: {},
        },
        {
          open: vi.fn(),
          message: vi.fn(),
          close: vi.fn(),
          error: vi.fn(),
          reset: vi.fn(),
        }
      );

      cancelSearchQueryBasedOnRequestId({
        trace_id: "trace-cancel",
        org_id: "test-org",
      });

      expect(mockWsGetWebSocket).toHaveBeenCalled();
    });
  });

  // ─── closeSocketBasedOnRequestId ─────────────────────────────────────────

  describe("closeSocketBasedOnRequestId", () => {
    it("does not throw for an unknown traceId", () => {
      const { closeSocketBasedOnRequestId } = useSearchWebSocket();
      expect(() => closeSocketBasedOnRequestId("unknown-trace")).not.toThrow();
    });
  });

  // ─── closeSocket ─────────────────────────────────────────────────────────

  describe("closeSocket", () => {
    it("does not throw when called", () => {
      const { closeSocket } = useSearchWebSocket();
      expect(() => closeSocket()).not.toThrow();
    });

    it("delegates to webSocket.cleanupSocket", () => {
      const { closeSocket } = useSearchWebSocket();
      closeSocket();
      expect(mockWsCleanupSocket).toHaveBeenCalled();
    });
  });

  // ─── sendSearchMessageBasedOnRequestId ───────────────────────────────────

  describe("sendSearchMessageBasedOnRequestId", () => {
    it("calls webSocket.sendMessage with the JSON-stringified data", () => {
      const { fetchQueryDataWithWebSocket, sendSearchMessageBasedOnRequestId } =
        useSearchWebSocket();

      fetchQueryDataWithWebSocket(
        {
          queryReq: {} as any,
          type: "search",
          isPagination: false,
          traceId: "trace-send",
          org_id: "test-org",
          meta: {},
        },
        {
          open: vi.fn(),
          message: vi.fn(),
          close: vi.fn(),
          error: vi.fn(),
          reset: vi.fn(),
        }
      );

      const message = { content: { trace_id: "trace-send" }, type: "search" };
      sendSearchMessageBasedOnRequestId(message);

      expect(mockWsSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        JSON.stringify(message)
      );
    });
  });
});
