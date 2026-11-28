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

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LARGE_STREAM_BYTES,
  estimateWindowBytes,
  largeStreamThreshold,
  useLargeStreamGate,
  type LargeStreamGateInput,
} from "./useLargeStreamGate";

const HOUR = 3_600_000_000;
const DAY = 24 * HOUR;
const MB = 1024 ** 2;
// 10 days of data, 3 TB stored: 300 GB per day.
const stats = { storage_size: 3 * 1024 * 1024, doc_time_min: 10 * DAY, doc_time_max: 20 * DAY };

const input = (over: Partial<LargeStreamGateInput> = {}): LargeStreamGateInput => ({
  mode: "stream",
  agentSelected: false,
  searchQuery: "",
  stream: "default",
  agentStreams: [],
  stats,
  start: 19 * DAY,
  end: 20 * DAY,
  ...over,
});

describe("estimateWindowBytes", () => {
  it("scales stored size by the share of the stream's span the window covers", () => {
    expect(estimateWindowBytes(stats, 19 * DAY, 20 * DAY)).toBeCloseTo((3 * 1024 * 1024 * MB) / 10);
  });

  it("counts only the part of the window that overlaps the data", () => {
    expect(estimateWindowBytes(stats, 19 * DAY, 30 * DAY)).toBeCloseTo((3 * 1024 * 1024 * MB) / 10);
  });

  it("returns null without usable stats", () => {
    expect(estimateWindowBytes(undefined, 0, 1)).toBeNull();
    expect(estimateWindowBytes({ storage_size: 5 }, 0, 1)).toBeNull();
  });
});

describe("largeStreamThreshold", () => {
  it("defaults to 200 GB and reads an optional server value", () => {
    expect(largeStreamThreshold({})).toBe(DEFAULT_LARGE_STREAM_BYTES);
    expect(DEFAULT_LARGE_STREAM_BYTES).toBe(200 * 1024 ** 3);
    expect(largeStreamThreshold({ llm_insights_large_stream_bytes: 10 })).toBe(10);
  });
});

describe("useLargeStreamGate", () => {
  afterEach(() => sessionStorage.clear());
  const gate = () =>
    useLargeStreamGate(
      () => "org1",
      () => DEFAULT_LARGE_STREAM_BYTES,
    );

  it("holds a large stream-mode scan with no filter", () => {
    expect(gate().heldBytes(input())).toBeGreaterThan(DEFAULT_LARGE_STREAM_BYTES);
  });

  it("lets a window below the threshold run", () => {
    expect(gate().heldBytes(input({ start: 19.5 * DAY }))).toBeNull();
  });

  it("does not hold with a search filter, a picked agent, or an LLM-only stream", () => {
    const g = gate();
    expect(g.heldBytes(input({ searchQuery: "model = 'x'" }))).toBeNull();
    expect(g.heldBytes(input({ mode: "agent", agentSelected: true }))).toBeNull();
    expect(g.heldBytes(input({ agentStreams: ["default"] }))).toBeNull();
  });

  it("still holds in Agent mode with all agents", () => {
    expect(gate().heldBytes(input({ mode: "agent", agentSelected: false }))).not.toBeNull();
  });

  it("fails open without stream stats", () => {
    expect(gate().heldBytes(input({ stats: undefined }))).toBeNull();
  });

  it("remembers Run anyway per stream for the browser tab", () => {
    const g = gate();
    g.runAnyway("default");
    expect(g.heldBytes(input())).toBeNull();
    expect(g.heldBytes(input({ stream: "other" }))).not.toBeNull();
    expect(gate().heldBytes(input())).toBeNull();
  });
});
