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

import { describe, expect, it } from "vitest";
import { createStreamingHits, mergeHits } from "./streamingHits";

const meta = (streamingAggs?: boolean) => ({
  type: "search_response_metadata",
  content: { ...(streamingAggs ? { streaming_aggs: true } : {}), results: { hits: [] } },
});
const hits = (rows: unknown[]) => ({
  type: "search_response_hits",
  content: { results: { hits: rows } },
});

describe("createStreamingHits", () => {
  it("appends every batch of a plain query", () => {
    const step = createStreamingHits();
    expect([step(meta()), step(hits([1])), step(meta()), step(hits([2]))]).toEqual([
      "keep",
      "append",
      "keep",
      "append",
    ]);
  });

  it("replaces with each partition's running answer under streaming_aggs from the metadata", () => {
    const step = createStreamingHits();
    expect([step(meta(true)), step(hits([1])), step(meta(true)), step(hits([1, 2]))]).toEqual([
      "keep",
      "replace",
      "keep",
      "replace",
    ]);
  });

  it("replaces with every later chunk of one partition too, as Logs does", () => {
    const step = createStreamingHits();
    expect([step(meta(true)), step(hits([1])), step(hits([2]))]).toEqual([
      "keep",
      "replace",
      "replace",
    ]);
  });

  it("keeps the last answer when a streaming aggregate ends with an empty batch", () => {
    const step = createStreamingHits();
    step(meta(true));
    step(hits([1, 2]));
    step(meta(true));
    expect(step(hits([]))).toBe("keep");
  });

  it("reads the flag from the results too", () => {
    const step = createStreamingHits();
    step({ type: "search_response_metadata", content: { results: { streaming_aggs: true } } });
    step(hits([1]));
    step(meta());
    expect(step(hits([1, 2]))).toBe("replace");
  });
});

describe("mergeHits", () => {
  it("applies a step to the rows held so far", () => {
    expect(mergeHits([1], [2], "append")).toEqual([1, 2]);
    expect(mergeHits([1], [2], "replace")).toEqual([2]);
    expect(mergeHits([1], [], "keep")).toEqual([1]);
  });
});
