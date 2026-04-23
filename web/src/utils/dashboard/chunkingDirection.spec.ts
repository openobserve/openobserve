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

import { describe, it, expect } from "vitest";
import {
  detectChunkingDirection,
  shouldPrependChunk,
} from "./chunkingDirection";

describe("detectChunkingDirection", () => {
  it("returns true (LTR) when first chunk start matches user start", () => {
    expect(detectChunkingDirection(1000, 1500, 1000, 2000)).toBe(true);
  });

  it("returns false (RTL) when first chunk end matches user end", () => {
    expect(detectChunkingDirection(1500, 2000, 1000, 2000)).toBe(false);
  });

  it("returns true (LTR) when start distance is smaller than end distance", () => {
    // |1010 - 1000| = 10 vs |1500 - 2000| = 500 → LTR
    expect(detectChunkingDirection(1010, 1500, 1000, 2000)).toBe(true);
  });

  it("returns false (RTL) when end distance is smaller than start distance", () => {
    // |1500 - 1000| = 500 vs |1990 - 2000| = 10 → RTL
    expect(detectChunkingDirection(1500, 1990, 1000, 2000)).toBe(false);
  });

  it("returns true (LTR) when distances are equal (<=)", () => {
    // |1500 - 1000| = 500 vs |1500 - 2000| = 500 → equal → LTR
    expect(detectChunkingDirection(1500, 1500, 1000, 2000)).toBe(true);
  });

  it("returns null when firstChunkStart is 0", () => {
    expect(detectChunkingDirection(0, 1500, 1000, 2000)).toBeNull();
  });

  it("returns null when firstChunkEnd is 0", () => {
    expect(detectChunkingDirection(1000, 0, 1000, 2000)).toBeNull();
  });

  it("returns null when userStart is 0", () => {
    expect(detectChunkingDirection(1000, 1500, 0, 2000)).toBeNull();
  });

  it("returns null when userEnd is 0", () => {
    expect(detectChunkingDirection(1000, 1500, 1000, 0)).toBeNull();
  });

  it("returns null when all inputs are 0", () => {
    expect(detectChunkingDirection(0, 0, 0, 0)).toBeNull();
  });

  it("works with real microsecond timestamps", () => {
    // LTR: first chunk starts at user start
    const userStart = 1776324119965000;
    const userEnd = 1776327719965000;
    expect(
      detectChunkingDirection(
        1776324119965000,
        1776324300000000,
        userStart,
        userEnd,
      ),
    ).toBe(true);

    // RTL: first chunk ends at user end
    expect(
      detectChunkingDirection(
        1776327600000000,
        1776327773801000,
        1776324173801000,
        1776327773801000,
      ),
    ).toBe(false);
  });
});

describe("shouldPrependChunk", () => {
  it("RTL + asc → prepend (true)", () => {
    expect(shouldPrependChunk(false, true)).toBe(true);
  });

  it("RTL + desc → append (false)", () => {
    expect(shouldPrependChunk(false, false)).toBe(false);
  });

  it("LTR + asc → append (false)", () => {
    expect(shouldPrependChunk(true, true)).toBe(false);
  });

  it("LTR + desc → prepend (true)", () => {
    expect(shouldPrependChunk(true, false)).toBe(true);
  });
});
