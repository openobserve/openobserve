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

import type { AlertLibraryEntry } from "@/types/alertLibrary";

import {
  highlightRanges,
  highlightSegments,
  matchesSearchWords,
  searchWords,
} from "./librarySearch";

const entry = (over: Partial<AlertLibraryEntry> = {}): AlertLibraryEntry => ({
  id: "k8s/pod-high-restart-rate",
  name: "pod-high-restart-rate",
  pack: "k8s",
  category: "pod",
  title: "Pod High Restart Rate",
  severity: "warning",
  description: "A container keeps restarting.",
  stream: "kube_pod_container_status_restarts_total",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["kube_pod_container_status_restarts_total"],
  path: "packs/k8s/alerts/pod/pod-high-restart-rate.json",
  content_hash: "hash",
  ...over,
});

describe("searchWords", () => {
  it("splits on whitespace, lowercases, and drops empties and repeats", () => {
    expect(searchWords("  Pod  RESTART pod ")).toEqual(["pod", "restart"]);
  });

  it("returns no words for a blank query", () => {
    expect(searchWords("   ")).toEqual([]);
  });
});

describe("matchesSearchWords", () => {
  it("matches every entry when there are no words", () => {
    expect(matchesSearchWords(entry(), [])).toBe(true);
  });

  it("matches words that are not adjacent in any one field", () => {
    expect(matchesSearchWords(entry(), searchWords("pod restart"))).toBe(true);
  });

  it("needs every word to match somewhere", () => {
    expect(matchesSearchWords(entry(), searchWords("pod oom"))).toBe(false);
  });

  it("matches the pack by its display name", () => {
    expect(matchesSearchWords(entry(), searchWords("kubernetes pod restart"))).toBe(true);
  });

  it("matches the pack and category ids", () => {
    const other = entry({ pack: "databases", category: "clickhouse", title: "Node down" });
    expect(matchesSearchWords(other, searchWords("databases clickhouse"))).toBe(true);
  });

  it("matches tags", () => {
    expect(matchesSearchWords(entry({ tags: ["crashloop"] }), searchWords("crashloop"))).toBe(true);
  });

  it("matches the stream and the description", () => {
    expect(matchesSearchWords(entry(), searchWords("status_restarts keeps"))).toBe(true);
  });

  it("survives an entry with missing or non-string fields", () => {
    const broken = entry({
      title: undefined,
      description: undefined,
      tags: [1, null] as unknown as string[],
    } as unknown as Partial<AlertLibraryEntry>);
    expect(matchesSearchWords(broken, searchWords("undefined"))).toBe(false);
    expect(matchesSearchWords(broken, searchWords("pod"))).toBe(true);
  });
});

describe("highlightRanges", () => {
  it("returns every occurrence of every word, case-insensitively", () => {
    expect(highlightRanges("Pod restart, pod", ["pod"])).toEqual([
      [0, 3],
      [13, 16],
    ]);
  });

  it("merges overlapping and touching matches into one range", () => {
    expect(highlightRanges("restarting", ["restart", "art", "ing"])).toEqual([[0, 10]]);
  });

  it("returns nothing when no word occurs", () => {
    expect(highlightRanges("Pod", ["node"])).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("splits text into matched and unmatched runs that rejoin to the original", () => {
    const segments = highlightSegments("Pod High Restart Rate", ["pod", "restart"]);
    expect(segments).toEqual([
      { text: "Pod", match: true },
      { text: " High ", match: false },
      { text: "Restart", match: true },
      { text: " Rate", match: false },
    ]);
    expect(segments.map((s) => s.text).join("")).toBe("Pod High Restart Rate");
  });

  it("returns the whole text as one unmatched run without words", () => {
    expect(highlightSegments("Pod", [])).toEqual([{ text: "Pod", match: false }]);
  });

  it("returns no runs for non-string text", () => {
    expect(highlightSegments(undefined as unknown as string, ["pod"])).toEqual([]);
  });
});
