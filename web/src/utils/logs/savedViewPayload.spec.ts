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

import { buildSavedViewPayload } from "./savedViewPayload";

const search = () => ({
  loading: true,
  loadingHistogram: true,
  meta: { savedBuildConfig: { a: 1 }, logsVisualizeToggle: "logs" },
  data: {
    query: "q",
    queryResults: { hits: [1] },
    histogram: {},
    sortedQueryResults: [],
    streamResults: {},
    savedViews: [],
    transforms: [],
    parsedQuery: { a: 1 },
    stream: { selectedStream: ["s"], streamLists: [], functions: [] },
  },
});

describe("buildSavedViewPayload", () => {
  it("drops runtime state, stamps the timezone and leaves the source alone", () => {
    const source = search();
    const payload = buildSavedViewPayload(source, { timezone: "UTC" });

    expect(payload.loading).toBe(false);
    expect(payload.data.timezone).toBe("UTC");
    expect(payload.data.query).toBe("q");
    expect(payload.data.stream.selectedStream).toEqual(["s"]);
    for (const key of ["queryResults", "histogram", "savedViews", "transforms", "parsedQuery"]) {
      expect(payload.data).not.toHaveProperty(key);
    }
    expect(payload.data.stream).not.toHaveProperty("streamLists");
    expect(payload.meta).not.toHaveProperty("savedBuildConfig");
    expect(source.data.queryResults).toEqual({ hits: [1] });
  });

  it("carries the mode-specific data only when given", () => {
    const plain = buildSavedViewPayload(search(), { timezone: "UTC" });
    const full = buildSavedViewPayload(search(), {
      timezone: "UTC",
      visualizationData: { v: 1 },
      buildData: { b: 1 },
    });

    expect(plain.data).not.toHaveProperty("visualizationData");
    expect(plain.data).not.toHaveProperty("buildData");
    expect(full.data.visualizationData).toEqual({ v: 1 });
    expect(full.data.buildData).toEqual({ b: 1 });
  });
});
