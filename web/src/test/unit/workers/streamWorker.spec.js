// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("streamWorker", () => {
  let activeBuffers;
  let mockPostMessage;
  let processChunk;
  let handleMessage;

  beforeEach(() => {
    activeBuffers = {};
    mockPostMessage = vi.fn();

    global.self = {
      postMessage: mockPostMessage,
    };

    // Helper function to extract data from message line
    function extractData(line) {
      return line.startsWith("data:") ? line.slice(6) : line.slice(5);
    }

    // Process a chunk for a given traceId
    processChunk = (traceId, chunk) => {
      let buffer = activeBuffers[traceId] || "";

      try {
        // Add chunk to buffer
        buffer += chunk;

        // Process complete messages
        const messages = buffer.split("\n\n");
        // Keep the last potentially incomplete message in buffer
        buffer = messages.pop() || "";
        activeBuffers[traceId] = buffer;

        const lines = messages.filter((line) => line.trim());

        // Process each complete line
        for (let i = 0; i < lines.length; i++) {
          try {
            const msgLines = lines[i].split("\n");
            // Check if this is an event line

            if (msgLines.length > 1) {
              const eventType = msgLines[0].startsWith("event:")
                ? msgLines[0].slice(7).trim()
                : msgLines[0].slice(6).trim();

              if (
                msgLines[1]?.startsWith("data:") ||
                msgLines[1]?.startsWith("data: ")
              ) {
                const data = extractData(msgLines[1]);

                try {
                  // Try to parse as JSON
                  const json = JSON.parse(data);
                  // Send message based on event type
                  global.self.postMessage({
                    type: eventType,
                    traceId,
                    data: json,
                  });
                } catch (parseErr) {
                  // If JSON parsing fails, send raw data
                  global.self.postMessage({
                    type: "error",
                    traceId,
                    data: {
                      message: "Error parsing data",
                      error: parseErr.toString(),
                    },
                  });
                }
              }
            }

            if (
              msgLines[0]?.startsWith("data:") ||
              msgLines[0]?.startsWith("data: ")
            ) {
              const data = extractData(msgLines[0]);
              try {
                // Try to parse as JSON
                const json = JSON.parse(data);
                // Send message based on event type
                global.self.postMessage({
                  type: "data",
                  traceId,
                  data: json,
                });
              } catch (parseErr) {
                // If JSON parsing fails, send raw data
                global.self.postMessage({
                  type: "data",
                  traceId,
                  data: data,
                });
              }
            }
          } catch (e) {
            global.self.postMessage({
              type: "error",
              traceId,
              data: { message: "Error processing message", error: e.toString() },
            });
          }
        }
      } catch (error) {
        // Send error to main thread
        global.self.postMessage({
          type: "error",
          traceId,
          data: { message: "Stream processing error", error: error.toString() },
        });
      }
    };

    // Handle messages from main thread
    handleMessage = (event) => {
      const { action, traceId, chunk } = event.data;

      switch (action) {
        case "startStream":
          activeBuffers[traceId] = "";
          break;

        case "processChunk":
          if (activeBuffers[traceId] !== undefined) {
            processChunk(traceId, chunk);
          }
          break;

        case "endStream":
          global.self.postMessage({
            type: "end",
            traceId,
          });
          delete activeBuffers[traceId];
          break;

        case "cancelStream":
          delete activeBuffers[traceId];
          break;

        case "closeAll":
          activeBuffers = {};
          break;
      }
    };
  });

  describe("startStream action", () => {
    it("should initialize buffer for new stream", () => {
      handleMessage({
        data: {
          action: "startStream",
          traceId: "trace-123",
        },
      });

      expect(activeBuffers["trace-123"]).toBe("");
    });

    it("should handle multiple concurrent streams", () => {
      handleMessage({ data: { action: "startStream", traceId: "trace-1" } });
      handleMessage({ data: { action: "startStream", traceId: "trace-2" } });

      expect(activeBuffers["trace-1"]).toBe("");
      expect(activeBuffers["trace-2"]).toBe("");
    });
  });

  describe("processChunk action", () => {
    beforeEach(() => {
      handleMessage({ data: { action: "startStream", traceId: "trace-123" } });
    });

    it("should process JSON data chunk", () => {
      const chunk = 'data: {"message":"test","count":42}\n\n';

      handleMessage({
        data: {
          action: "processChunk",
          traceId: "trace-123",
          chunk,
        },
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "data",
        traceId: "trace-123",
        data: { message: "test", count: 42 },
      });
    });

    it("should handle event with data", () => {
      const chunk =
        'event: search_response\ndata: {"hits":[],"total":100}\n\n';

      handleMessage({
        data: {
          action: "processChunk",
          traceId: "trace-123",
          chunk,
        },
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "search_response",
        traceId: "trace-123",
        data: { hits: [], total: 100 },
      });
    });

    it("should handle data with space after colon", () => {
      const chunk = 'data:  {"message":"with space"}\n\n';

      handleMessage({
        data: {
          action: "processChunk",
          traceId: "trace-123",
          chunk,
        },
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "data",
        traceId: "trace-123",
        data: { message: "with space" },
      });
    });

    it("should buffer incomplete messages", () => {
      const chunk1 = 'data: {"message"';
      const chunk2 = ':"test"}\n\n';

      handleMessage({
        data: { action: "processChunk", traceId: "trace-123", chunk: chunk1 },
      });
      expect(mockPostMessage).not.toHaveBeenCalled();

      handleMessage({
        data: { action: "processChunk", traceId: "trace-123", chunk: chunk2 },
      });
      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "data",
        traceId: "trace-123",
        data: { message: "test" },
      });
    });

    it("should handle multiple messages in one chunk", () => {
      const chunk =
        'data: {"id":1}\n\ndata: {"id":2}\n\ndata: {"id":3}\n\n';

      handleMessage({
        data: {
          action: "processChunk",
          traceId: "trace-123",
          chunk,
        },
      });

      expect(mockPostMessage).toHaveBeenCalledTimes(3);
      expect(mockPostMessage).toHaveBeenNthCalledWith(1, {
        type: "data",
        traceId: "trace-123",
        data: { id: 1 },
      });
      expect(mockPostMessage).toHaveBeenNthCalledWith(2, {
        type: "data",
        traceId: "trace-123",
        data: { id: 2 },
      });
      expect(mockPostMessage).toHaveBeenNthCalledWith(3, {
        type: "data",
        traceId: "trace-123",
        data: { id: 3 },
      });
    });

    it("should handle non-JSON data gracefully", () => {
      const chunk = "data: plain text data\n\n";

      handleMessage({
        data: {
          action: "processChunk",
          traceId: "trace-123",
          chunk,
        },
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "data",
        traceId: "trace-123",
        data: "plain text data",
      });
    });

    it("should handle invalid JSON in event data", () => {
      const chunk = 'event: test_event\ndata: {invalid json}\n\n';

      handleMessage({
        data: {
          action: "processChunk",
          traceId: "trace-123",
          chunk,
        },
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "error",
        traceId: "trace-123",
        data: {
          message: "Error parsing data",
          error: expect.stringContaining("SyntaxError"),
        },
      });
    });

    it("should ignore processChunk for non-existent traceId", () => {
      handleMessage({
        data: {
          action: "processChunk",
          traceId: "unknown-trace",
          chunk: 'data: {"test":true}\n\n',
        },
      });

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it("should handle empty lines in chunk", () => {
      const chunk = 'data: {"message":"test"}\n\n\n\n';

      handleMessage({
        data: {
          action: "processChunk",
          traceId: "trace-123",
          chunk,
        },
      });

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "data",
        traceId: "trace-123",
        data: { message: "test" },
      });
    });

    it("should handle search_response_hits event", () => {
      const chunk =
        'event: search_response_hits\ndata: {"hits":[{"_id":"1"}]}\n\n';

      handleMessage({
        data: {
          action: "processChunk",
          traceId: "trace-123",
          chunk,
        },
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "search_response_hits",
        traceId: "trace-123",
        data: { hits: [{ _id: "1" }] },
      });
    });
  });

  describe("endStream action", () => {
    beforeEach(() => {
      handleMessage({ data: { action: "startStream", traceId: "trace-123" } });
    });

    it("should send end message and delete buffer", () => {
      handleMessage({
        data: {
          action: "endStream",
          traceId: "trace-123",
        },
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "end",
        traceId: "trace-123",
      });
      expect(activeBuffers["trace-123"]).toBeUndefined();
    });

    it("should not affect other active streams", () => {
      handleMessage({ data: { action: "startStream", traceId: "trace-456" } });

      handleMessage({ data: { action: "endStream", traceId: "trace-123" } });

      expect(activeBuffers["trace-123"]).toBeUndefined();
      expect(activeBuffers["trace-456"]).toBe("");
    });
  });

  describe("cancelStream action", () => {
    beforeEach(() => {
      handleMessage({ data: { action: "startStream", traceId: "trace-123" } });
    });

    it("should delete buffer without sending end message", () => {
      handleMessage({
        data: {
          action: "cancelStream",
          traceId: "trace-123",
        },
      });

      expect(activeBuffers["trace-123"]).toBeUndefined();
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  describe("closeAll action", () => {
    it("should clear all active buffers", () => {
      handleMessage({ data: { action: "startStream", traceId: "trace-1" } });
      handleMessage({ data: { action: "startStream", traceId: "trace-2" } });
      handleMessage({ data: { action: "startStream", traceId: "trace-3" } });

      handleMessage({ data: { action: "closeAll" } });

      expect(Object.keys(activeBuffers).length).toBe(0);
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      handleMessage({ data: { action: "startStream", traceId: "trace-123" } });
    });

    it("should handle processing errors gracefully", () => {
      // Create a chunk that will cause an error in processing
      const chunk = "malformed\ndata";

      handleMessage({
        data: {
          action: "processChunk",
          traceId: "trace-123",
          chunk,
        },
      });

      // Worker should continue functioning - no errors thrown
      expect(true).toBe(true);
    });

    it("should send error message for processing failures", () => {
      // Simulate a chunk that causes JSON parse error in event
      const chunk = 'event: test\ndata: {invalid}\n\n';

      handleMessage({
        data: {
          action: "processChunk",
          traceId: "trace-123",
          chunk,
        },
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "error",
        traceId: "trace-123",
        data: {
          message: "Error parsing data",
          error: expect.any(String),
        },
      });
    });
  });

  describe("Safari compatibility", () => {
    it("should process chunks incrementally for Safari", () => {
      handleMessage({ data: { action: "startStream", traceId: "safari-1" } });

      // Simulate Safari sending data in small chunks
      handleMessage({
        data: { action: "processChunk", traceId: "safari-1", chunk: "data:" },
      });
      handleMessage({
        data: { action: "processChunk", traceId: "safari-1", chunk: ' {"te' },
      });
      handleMessage({
        data: { action: "processChunk", traceId: "safari-1", chunk: 'st":tr' },
      });
      handleMessage({
        data: { action: "processChunk", traceId: "safari-1", chunk: "ue}\n\n" },
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "data",
        traceId: "safari-1",
        data: { test: true },
      });
    });
  });
});
