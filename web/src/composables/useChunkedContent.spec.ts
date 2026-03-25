// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { useChunkedContent } from "./useChunkedContent";

// Each test creates a fresh composable instance so chunk state is isolated.

const KB = 1024;
const DEFAULT_CHUNK_BYTES = 50 * KB; // 51200

/** Generate a string of exactly `n` characters */
const makeContent = (n: number): string => "x".repeat(n);

describe("useChunkedContent", () => {
  let composable: ReturnType<typeof useChunkedContent>;

  beforeEach(() => {
    vi.clearAllMocks();
    composable = useChunkedContent();
  });

  describe("exported constants", () => {
    it("CHUNK_SIZE_KB is 50", () => {
      expect(composable.CHUNK_SIZE_KB).toBe(50);
    });

    it("CHUNK_SIZE_BYTES is 51200", () => {
      expect(composable.CHUNK_SIZE_BYTES).toBe(51200);
    });
  });

  describe("initializeChunk", () => {
    it("creates a single chunk for content smaller than chunk size", () => {
      const { initializeChunk, chunkStates } = composable;
      const small = makeContent(100);
      initializeChunk("field1", small);
      expect(chunkStates.value["field1"].totalChunks).toBe(1);
      expect(chunkStates.value["field1"].currentChunkIndex).toBe(0);
    });

    it("creates multiple chunks for content larger than chunk size", () => {
      const { initializeChunk, chunkStates } = composable;
      // 3 full chunks + 1 partial = 4 chunks total
      const large = makeContent(DEFAULT_CHUNK_BYTES * 3 + 1);
      initializeChunk("field2", large);
      expect(chunkStates.value["field2"].totalChunks).toBe(4);
    });

    it("stores the full content and chunk size", () => {
      const { initializeChunk, chunkStates } = composable;
      const content = "hello world";
      initializeChunk("f", content, 5);
      expect(chunkStates.value["f"].fullContent).toBe(content);
      expect(chunkStates.value["f"].chunkSize).toBe(5);
    });

    it("accepts a custom chunkSizeBytes override", () => {
      const { initializeChunk, chunkStates } = composable;
      const content = makeContent(100);
      initializeChunk("f", content, 25);
      expect(chunkStates.value["f"].totalChunks).toBe(4);
    });
  });

  describe("getVisibleContent", () => {
    it("returns empty string for an unknown fieldKey", () => {
      expect(composable.getVisibleContent("nonexistent")).toBe("");
    });

    it("returns only the first chunk of content initially", () => {
      const { initializeChunk, getVisibleContent } = composable;
      // chunk size = 10, content = 25 chars
      const content = makeContent(25);
      initializeChunk("f", content, 10);
      // index 0 → endIndex = (0+1)*10 = 10 → first 10 chars
      expect(getVisibleContent("f")).toBe(content.substring(0, 10));
    });

    it("returns all content when a single chunk covers the whole string", () => {
      const { initializeChunk, getVisibleContent } = composable;
      const content = "hello";
      initializeChunk("f", content, 100);
      expect(getVisibleContent("f")).toBe("hello");
    });
  });

  describe("loadNextChunk", () => {
    it("advances currentChunkIndex by one", () => {
      const { initializeChunk, loadNextChunk, chunkStates } = composable;
      initializeChunk("f", makeContent(25), 10);
      loadNextChunk("f");
      expect(chunkStates.value["f"].currentChunkIndex).toBe(1);
    });

    it("does not advance past the last chunk", () => {
      const { initializeChunk, loadNextChunk, chunkStates } = composable;
      // content=10, chunkSize=10 → totalChunks=1, max index=0
      initializeChunk("f", makeContent(10), 10);
      loadNextChunk("f");
      expect(chunkStates.value["f"].currentChunkIndex).toBe(0);
    });

    it("is a no-op for an unknown fieldKey", () => {
      // Should not throw
      expect(() => composable.loadNextChunk("ghost")).not.toThrow();
    });
  });

  describe("hasMoreChunks", () => {
    it("returns false for an unknown fieldKey", () => {
      expect(composable.hasMoreChunks("nonexistent")).toBe(false);
    });

    it("returns true when more chunks remain", () => {
      const { initializeChunk, hasMoreChunks } = composable;
      initializeChunk("f", makeContent(25), 10); // 3 chunks, index starts at 0
      expect(hasMoreChunks("f")).toBe(true);
    });

    it("returns false when on the last chunk", () => {
      const { initializeChunk, loadNextChunk, hasMoreChunks } = composable;
      initializeChunk("f", makeContent(20), 10); // 2 chunks
      loadNextChunk("f"); // advance to index 1 (last)
      expect(hasMoreChunks("f")).toBe(false);
    });

    it("returns false for single-chunk content", () => {
      const { initializeChunk, hasMoreChunks } = composable;
      initializeChunk("f", makeContent(5), 10); // 1 chunk
      expect(hasMoreChunks("f")).toBe(false);
    });
  });

  describe("getChunkInfo", () => {
    it("returns all-zero object for an unknown fieldKey", () => {
      expect(composable.getChunkInfo("ghost")).toEqual({
        currentChunk: 0,
        totalChunks: 0,
        loadedSizeKB: 0,
        totalSizeKB: 0,
      });
    });

    it("returns correct info after initialization", () => {
      const { initializeChunk, getChunkInfo } = composable;
      // 102 KB content, chunk size = 50 KB → 3 chunks; initial chunk = 1
      const totalBytes = 102 * KB;
      const content = makeContent(totalBytes);
      initializeChunk("f", content, DEFAULT_CHUNK_BYTES);
      const info = getChunkInfo("f");
      expect(info.currentChunk).toBe(1);
      expect(info.totalChunks).toBe(3);
      // loaded = min(50KB, 102KB) = 50KB → Math.round(50*1024/1024) = 50
      expect(info.loadedSizeKB).toBe(50);
      expect(info.totalSizeKB).toBe(102);
    });

    it("loadedSizeKB does not exceed totalSizeKB on the last chunk", () => {
      const { initializeChunk, loadNextChunk, getChunkInfo } = composable;
      const content = makeContent(10); // tiny content
      initializeChunk("f", content, 8); // 2 chunks
      loadNextChunk("f"); // advance to last chunk
      const info = getChunkInfo("f");
      expect(info.loadedSizeKB).toBeLessThanOrEqual(info.totalSizeKB + 1);
    });
  });

  describe("resetChunks", () => {
    it("removes all chunk states", () => {
      const { initializeChunk, resetChunks, chunkStates } = composable;
      initializeChunk("f1", makeContent(100), 10);
      initializeChunk("f2", makeContent(200), 10);
      resetChunks();
      expect(Object.keys(chunkStates.value)).toHaveLength(0);
    });
  });

  describe("resetChunk", () => {
    it("removes only the specific field's state", () => {
      const { initializeChunk, resetChunk, chunkStates } = composable;
      initializeChunk("f1", makeContent(100), 10);
      initializeChunk("f2", makeContent(100), 10);
      resetChunk("f1");
      expect(chunkStates.value["f1"]).toBeUndefined();
      expect(chunkStates.value["f2"]).toBeDefined();
    });

    it("is a no-op for an unknown fieldKey", () => {
      const { initializeChunk, resetChunk, chunkStates } = composable;
      initializeChunk("f1", makeContent(10), 5);
      expect(() => resetChunk("ghost")).not.toThrow();
      expect(chunkStates.value["f1"]).toBeDefined();
    });
  });

  describe("needsChunking", () => {
    it("returns false for content equal to the default threshold", () => {
      // length > threshold, so exactly equal → false
      expect(composable.needsChunking(makeContent(DEFAULT_CHUNK_BYTES))).toBe(false);
    });

    it("returns false for content smaller than the default threshold", () => {
      expect(composable.needsChunking(makeContent(100))).toBe(false);
    });

    it("returns true for content larger than the default threshold", () => {
      expect(composable.needsChunking(makeContent(DEFAULT_CHUNK_BYTES + 1))).toBe(true);
    });

    it("respects a custom threshold", () => {
      expect(composable.needsChunking(makeContent(10), 5)).toBe(true);
      expect(composable.needsChunking(makeContent(3), 5)).toBe(false);
    });
  });
});
