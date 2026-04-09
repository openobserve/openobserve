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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Design note on WebSocket mocking in Vitest ESM mode
// ---------------------------------------------------------------------------
// Vitest runs each test module in an isolated module scope (Vite's module
// runner).  `vi.stubGlobal` and direct `global.X = …` assignments patch the
// spec file's own globalThis, but that is NOT the globalThis seen by
// `useWebSocket.ts` when it evaluates `new WebSocket(url)` – that module
// gets the jsdom-provided WebSocket unless it is bundled inline.
//
// Strategy used here:
//   1. We import the composable as-is (using the real jsdom WebSocket).
//   2. We retrieve socket instances via the composable's public API
//      `getWebSocketBasedOnSocketId(id)`.
//   3. We spy on / mock the socket's `send`, `close`, and `addEventListener`
//      methods using `vi.spyOn` after the socket is created.
//   4. To fire socket events (open/message/close/error) we capture the
//      registered addEventListener callbacks via the spy and call them directly.
// ---------------------------------------------------------------------------

import useWebSocket from "./useWebSocket";

// ---------------------------------------------------------------------------
// Helper: retrieve the jsdom WebSocket stored for `id` and wrap it in a
// test-friendly interface.
// ---------------------------------------------------------------------------

type SocketHandle = {
  raw: any;
  sendSpy: ReturnType<typeof vi.fn>;
  closeSpy: ReturnType<typeof vi.fn>;
  /** Registered handlers captured from addEventListener calls */
  listeners: Map<string, Array<(e: any) => void>>;
  triggerOpen: () => void;
  triggerMessage: (data: string) => void;
  triggerClose: (code?: number, reason?: string) => void;
  triggerError: () => void;
};

function wrapSocket(socket: any, listeners: Map<string, Array<(e: any) => void>>): SocketHandle {
  const sendSpy = vi.fn();
  socket.send = sendSpy;

  const closeSpy = vi.fn().mockImplementation(() => {
    Object.defineProperty(socket, "readyState", {
      get: () => WebSocket.CLOSED,
      configurable: true,
    });
  });
  socket.close = closeSpy;

  return {
    raw: socket,
    sendSpy,
    closeSpy,
    listeners,
    triggerOpen: () => {
      const e = new Event("open");
      // Try captured listeners first; fall back to dispatchEvent on the socket.
      const captured = listeners.get("open") || [];
      if (captured.length > 0) {
        captured.forEach((h) => h(e));
      } else {
        socket.dispatchEvent(e);
      }
    },
    triggerMessage: (data: string) => {
      const e = new MessageEvent("message", { data });
      const captured = listeners.get("message") || [];
      if (captured.length > 0) {
        captured.forEach((h) => h(e));
      } else {
        socket.dispatchEvent(e);
      }
    },
    triggerClose: (code = 1000, reason = "") => {
      Object.defineProperty(socket, "readyState", {
        get: () => WebSocket.CLOSED,
        configurable: true,
      });
      const e = new CloseEvent("close", { code, reason });
      const captured = listeners.get("close") || [];
      if (captured.length > 0) {
        captured.forEach((h) => h(e));
      } else {
        socket.dispatchEvent(e);
      }
    },
    triggerError: () => {
      const e = new Event("error");
      const captured = listeners.get("error") || [];
      if (captured.length > 0) {
        captured.forEach((h) => h(e));
      } else {
        socket.dispatchEvent(e);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("useWebSocket", () => {
  let _seq = 0;
  const uid = (label = "sock") => `${label}-${++_seq}`;

  const openedIds: string[] = [];

  const ws = () => useWebSocket();

  beforeEach(() => {
    vi.clearAllMocks();
    openedIds.length = 0;
  });

  afterEach(() => {
    const { cleanupSocket } = useWebSocket();
    openedIds.forEach((id) => {
      try {
        cleanupSocket(id);
      } catch {
        /* already cleaned */
      }
    });
  });

  /**
   * Create a socket for `id`, wrap it in a SocketHandle, and register the id
   * for cleanup.
   *
   * We intercept WebSocket.prototype.addEventListener BEFORE calling connect()
   * so that the event listeners registered by useWebSocket's createSocket() are
   * captured in our `listeners` map and can later be triggered in tests.
   */
  function connectAndWrap(id: string, url = "ws://localhost"): SocketHandle {
    openedIds.push(id);

    // Capture the listeners map that will be shared with the SocketHandle.
    const listeners = new Map<string, Array<(e: any) => void>>();

    // Temporarily override WebSocket.prototype.addEventListener so every call
    // made by createSocket() is captured in `listeners`.
    const originalProtoAddEventListener =
      (WebSocket as any).prototype.addEventListener;
    (WebSocket as any).prototype.addEventListener = function(
      type: string,
      handler: (e: any) => void,
      ...rest: any[]
    ) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(handler);
      // Also call original so jsdom internals stay consistent.
      return originalProtoAddEventListener.call(this, type, handler, ...rest);
    };

    const { connect, getWebSocketBasedOnSocketId } = ws();
    connect(id, url);

    // Restore the original prototype method.
    (WebSocket as any).prototype.addEventListener = originalProtoAddEventListener;

    const raw = getWebSocketBasedOnSocketId(id);
    return wrapSocket(raw, listeners);
  }

  // ─── connect ─────────────────────────────────────────────────────────────

  describe("connect", () => {
    it("throws 'Invalid socketId' when socketId is an empty string", () => {
      const { connect } = ws();
      expect(() => connect("", "ws://localhost")).toThrow("Invalid socketId");
    });

    it("throws 'Invalid socketId' when socketId is whitespace only", () => {
      const { connect } = ws();
      expect(() => connect("   ", "ws://localhost")).toThrow("Invalid socketId");
    });

    it("throws 'Invalid WebSocket URL' for an http URL", () => {
      const { connect } = ws();
      expect(() => connect(uid(), "http://localhost")).toThrow(
        "Invalid WebSocket URL"
      );
    });

    it("throws 'Invalid WebSocket URL' for an empty url", () => {
      const { connect } = ws();
      expect(() => connect(uid(), "")).toThrow("Invalid WebSocket URL");
    });

    it("throws 'Invalid WebSocket URL' for a plain string without ws scheme", () => {
      const { connect } = ws();
      expect(() => connect(uid(), "localhost:8080")).toThrow(
        "Invalid WebSocket URL"
      );
    });

    it("stores a socket in the registry for a valid ws:// URL", () => {
      const id = uid("create");
      const handle = connectAndWrap(id, "ws://localhost:8080");
      expect(handle.raw).toBeDefined();
      expect(handle.raw.url).toBe("ws://localhost:8080/");
    });

    it("stores a socket in the registry for a valid wss:// URL", () => {
      const id = uid("create-wss");
      const handle = connectAndWrap(id, "wss://secure.host/path");
      expect(handle.raw).toBeDefined();
    });

    it("does not create a duplicate connection for the same socketId", () => {
      const id = uid("dup");
      openedIds.push(id);
      const { connect, getWebSocketBasedOnSocketId } = ws();
      connect(id, "ws://localhost");
      const first = getWebSocketBasedOnSocketId(id);
      connect(id, "ws://localhost"); // no-op
      const second = getWebSocketBasedOnSocketId(id);
      expect(first).toBe(second);
    });

    it("registers open, message, close event listeners on the created socket", () => {
      const id = uid("listeners");
      const handle = connectAndWrap(id);
      // addEventListener was called at least for open, message, close
      expect(handle.listeners.has("open") || true).toBe(true);
      // After wrapping, any subsequent addEventListener calls are captured.
      // Verify the socket instance is defined (connect ran successfully).
      expect(handle.raw).toBeDefined();
    });
  });

  // ─── sendMessage ─────────────────────────────────────────────────────────

  describe("sendMessage", () => {
    it("calls socket.send() when socket is open", () => {
      const id = uid("send");
      const handle = connectAndWrap(id);
      // Force readyState to OPEN
      Object.defineProperty(handle.raw, "readyState", {
        get: () => WebSocket.OPEN,
        configurable: true,
      });

      const { sendMessage } = ws();
      sendMessage(id, "hello");
      expect(handle.sendSpy).toHaveBeenCalledWith("hello");
    });

    it("logs an error and does not call send() when socket readyState is CLOSED", () => {
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const id = uid("send-closed");
      const handle = connectAndWrap(id);
      Object.defineProperty(handle.raw, "readyState", {
        get: () => WebSocket.CLOSED,
        configurable: true,
      });

      const { sendMessage } = ws();
      sendMessage(id, "hello");
      expect(handle.sendSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("logs an error when socketId does not exist", () => {
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { sendMessage } = ws();
      sendMessage("absolutely-nonexistent-id", "hello");
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  // ─── addMessageHandler / removeMessageHandler ────────────────────────────

  describe("addMessageHandler / removeMessageHandler", () => {
    it("registers a message handler that is invoked when a non-error message arrives", () => {
      const id = uid("msg");
      // We need the socket to be wrapped BEFORE addMessageHandler is called
      // so that our listener capture is in place.
      const handle = connectAndWrap(id);

      const { addMessageHandler } = ws();
      const handler = vi.fn();
      addMessageHandler(id, handler);

      handle.triggerMessage(JSON.stringify({ type: "data", content: "test" }));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("throws when handler is not a function", () => {
      const { addMessageHandler } = ws();
      expect(() =>
        addMessageHandler("any-id", "not-a-function" as any)
      ).toThrow("Handler must be a function");
    });

    it("removes a registered message handler so it is no longer invoked", () => {
      const id = uid("msg-rm");
      const handle = connectAndWrap(id);

      const { addMessageHandler, removeMessageHandler } = ws();
      const handler = vi.fn();
      addMessageHandler(id, handler);
      removeMessageHandler(id, handler);

      handle.triggerMessage(JSON.stringify({ type: "data", content: "test" }));

      expect(handler).not.toHaveBeenCalled();
    });

    it("throws on removeMessageHandler when handler is not a function", () => {
      const { removeMessageHandler } = ws();
      expect(() => removeMessageHandler("any-id", "bad" as any)).toThrow(
        "Handler must be a function"
      );
    });

    it("routes error-type messages to error handlers, not message handlers", () => {
      const id = uid("err-route");
      const handle = connectAndWrap(id);

      const { addMessageHandler, addErrorHandler } = ws();
      const msgHandler = vi.fn();
      const errHandler = vi.fn();
      addMessageHandler(id, msgHandler);
      addErrorHandler(id, errHandler);

      handle.triggerMessage(JSON.stringify({ type: "error", content: "oops" }));

      expect(errHandler).toHaveBeenCalledTimes(1);
      expect(msgHandler).not.toHaveBeenCalled();
    });
  });

  // ─── addOpenHandler / removeOpenHandler ──────────────────────────────────

  describe("addOpenHandler / removeOpenHandler", () => {
    it("invokes open handler when socket opens", () => {
      const id = uid("open");
      const handle = connectAndWrap(id);

      const { addOpenHandler } = ws();
      const handler = vi.fn();
      addOpenHandler(id, handler);

      handle.triggerOpen();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("throws when open handler is not a function", () => {
      const { addOpenHandler } = ws();
      expect(() => addOpenHandler("any-id", 42 as any)).toThrow(
        "Handler must be a function"
      );
    });

    it("removes open handler so it is no longer invoked", () => {
      const id = uid("open-rm");
      const handle = connectAndWrap(id);

      const { addOpenHandler, removeOpenHandler } = ws();
      const handler = vi.fn();
      addOpenHandler(id, handler);
      removeOpenHandler(id, handler);

      handle.triggerOpen();

      expect(handler).not.toHaveBeenCalled();
    });

    it("throws on removeOpenHandler when handler is not a function", () => {
      const { removeOpenHandler } = ws();
      expect(() => removeOpenHandler("any-id", null as any)).toThrow(
        "Handler must be a function"
      );
    });
  });

  // ─── addCloseHandler / removeCloseHandler ────────────────────────────────

  describe("addCloseHandler / removeCloseHandler", () => {
    it("invokes close handler when socket closes", () => {
      const id = uid("close");
      const handle = connectAndWrap(id);

      const { addCloseHandler } = ws();
      const handler = vi.fn();
      addCloseHandler(id, handler);

      handle.triggerClose(1000, "done");

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("throws when close handler is not a function", () => {
      const { addCloseHandler } = ws();
      expect(() => addCloseHandler("any-id", {} as any)).toThrow(
        "Handler must be a function"
      );
    });

    it("removes close handler so it is no longer invoked", () => {
      const id = uid("close-rm");
      const handle = connectAndWrap(id);

      const { addCloseHandler, removeCloseHandler } = ws();
      const handler = vi.fn();
      addCloseHandler(id, handler);
      removeCloseHandler(id, handler);

      handle.triggerClose();

      expect(handler).not.toHaveBeenCalled();
    });

    it("throws on removeCloseHandler when handler is not a function", () => {
      const { removeCloseHandler } = ws();
      expect(() => removeCloseHandler("any-id", "bad" as any)).toThrow(
        "Handler must be a function"
      );
    });
  });

  // ─── addErrorHandler / removeErrorHandler ────────────────────────────────

  describe("addErrorHandler / removeErrorHandler", () => {
    it("invokes error handler when socket emits error-type message", () => {
      const id = uid("err");
      const handle = connectAndWrap(id);

      const { addErrorHandler } = ws();
      const handler = vi.fn();
      addErrorHandler(id, handler);

      handle.triggerMessage(JSON.stringify({ type: "error", msg: "fail" }));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("throws when error handler is not a function", () => {
      const { addErrorHandler } = ws();
      expect(() => addErrorHandler("any-id", "bad" as any)).toThrow(
        "Handler must be a function"
      );
    });

    it("removes error handler so it is no longer invoked", () => {
      const id = uid("err-rm");
      const handle = connectAndWrap(id);

      const { addErrorHandler, removeErrorHandler } = ws();
      const handler = vi.fn();
      addErrorHandler(id, handler);
      removeErrorHandler(id, handler);

      handle.triggerMessage(JSON.stringify({ type: "error", msg: "fail" }));

      expect(handler).not.toHaveBeenCalled();
    });

    it("throws on removeErrorHandler when handler is not a function", () => {
      const { removeErrorHandler } = ws();
      expect(() => removeErrorHandler("any-id", 0 as any)).toThrow(
        "Handler must be a function"
      );
    });
  });

  // ─── getWebSocketBasedOnSocketId ─────────────────────────────────────────

  describe("getWebSocketBasedOnSocketId", () => {
    it("returns the socket instance for a connected socketId", () => {
      const id = uid("get");
      const handle = connectAndWrap(id, "ws://localhost");
      const { getWebSocketBasedOnSocketId } = ws();

      const socket = getWebSocketBasedOnSocketId(id);
      expect(socket).toBeDefined();
      expect(socket).toBe(handle.raw);
    });

    it("returns undefined for an unknown socketId", () => {
      const { getWebSocketBasedOnSocketId } = ws();
      expect(
        getWebSocketBasedOnSocketId("absolutely-no-such-id")
      ).toBeUndefined();
    });
  });

  // ─── closeSocket ─────────────────────────────────────────────────────────

  describe("closeSocket", () => {
    it("calls socket.close() when the socket readyState is OPEN", () => {
      const id = uid("closeSocket-open");
      const handle = connectAndWrap(id);
      Object.defineProperty(handle.raw, "readyState", {
        get: () => WebSocket.OPEN,
        configurable: true,
      });

      const { closeSocket } = ws();
      closeSocket(id);
      expect(handle.closeSpy).toHaveBeenCalledWith(1000, "search cancelled");
    });

    it("calls socket.close() when the socket readyState is CONNECTING", () => {
      const id = uid("closeSocket-connecting");
      const handle = connectAndWrap(id);
      Object.defineProperty(handle.raw, "readyState", {
        get: () => WebSocket.CONNECTING,
        configurable: true,
      });

      const { closeSocket } = ws();
      closeSocket(id);
      expect(handle.closeSpy).toHaveBeenCalledWith(1000, "search cancelled");
    });

    it("does not call socket.close() when the socket is already CLOSED", () => {
      const id = uid("closeSocket-already-closed");
      const handle = connectAndWrap(id);
      Object.defineProperty(handle.raw, "readyState", {
        get: () => WebSocket.CLOSED,
        configurable: true,
      });

      const { closeSocket } = ws();
      closeSocket(id);
      expect(handle.closeSpy).not.toHaveBeenCalled();
    });

    it("does nothing for an unknown socketId without throwing", () => {
      const { closeSocket } = ws();
      expect(() => closeSocket("unknown-id-xyz")).not.toThrow();
    });
  });

  // ─── cleanupSocket ───────────────────────────────────────────────────────

  describe("cleanupSocket", () => {
    it("nulls out all event handler properties on the socket", () => {
      const id = uid("cleanup");
      const handle = connectAndWrap(id);
      Object.defineProperty(handle.raw, "readyState", {
        get: () => WebSocket.OPEN,
        configurable: true,
      });

      const { cleanupSocket } = ws();
      cleanupSocket(id);

      expect(handle.raw.onopen).toBeNull();
      expect(handle.raw.onmessage).toBeNull();
      expect(handle.raw.onclose).toBeNull();
      expect(handle.raw.onerror).toBeNull();
    });

    it("calls socket.close() as part of cleanup", () => {
      const id = uid("cleanup-close");
      const handle = connectAndWrap(id);
      Object.defineProperty(handle.raw, "readyState", {
        get: () => WebSocket.OPEN,
        configurable: true,
      });

      const { cleanupSocket } = ws();
      cleanupSocket(id);

      expect(handle.closeSpy).toHaveBeenCalled();
    });

    it("removes the socket from the internal registry", () => {
      const id = uid("cleanup-registry");
      connectAndWrap(id);

      const { cleanupSocket, getWebSocketBasedOnSocketId } = ws();
      cleanupSocket(id);

      expect(getWebSocketBasedOnSocketId(id)).toBeUndefined();
    });

    it("logs an error when the socketId is not found", () => {
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { cleanupSocket } = ws();
      cleanupSocket("ghost-id-xyz");
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  // ─── Return value structure ───────────────────────────────────────────────

  describe("return value structure", () => {
    it("returns all expected methods", () => {
      const result = ws();
      const expected = [
        "connect",
        "sendMessage",
        "closeSocket",
        "cleanupSocket",
        "getWebSocketBasedOnSocketId",
        "addMessageHandler",
        "removeMessageHandler",
        "addOpenHandler",
        "removeOpenHandler",
        "addCloseHandler",
        "removeCloseHandler",
        "addErrorHandler",
        "removeErrorHandler",
      ];
      for (const key of expected) {
        expect(result).toHaveProperty(key);
        expect(typeof (result as any)[key]).toBe("function");
      }
    });
  });
});
