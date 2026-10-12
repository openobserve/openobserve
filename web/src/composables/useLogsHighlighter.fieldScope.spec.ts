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

// Uses the real useTextHighlighter so a cell's query is highlighted end to end.
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";
import { gt } from "@/types/i18n";

vi.mock("vuex", () => ({ useStore: () => ({ state: { theme: "light" } }) }));
vi.mock("@/composables/useTheme", () => ({ useTheme: () => ({ isDark: ref(false) }) }));

const highlightedTexts = (html: string) =>
  [...html.matchAll(/class="[^"]*log-highlighted[^"]*">([^<]*)</g)].map((match) => match[1]);

describe("useLogsHighlighter field-scoped highlighting", () => {
  const hit = {
    body: "ERROR connection refused to db",
    edge_case: "kelvin_sign",
  };
  const columns = [{ id: "body" }, { id: "edge_case" }, { id: "source" }];

  it("should highlight case-sensitive terms with uppercase letters in table cells", async () => {
    const { processHitsInChunks } = useLogsHighlighter(gt);
    const results = await processHitsInChunks(
      [hit],
      columns,
      true,
      "str_match(body, 'ERROR') AND re_match(body, '^ERROR connection')",
      50,
      ["body"],
    );
    expect(highlightedTexts(results.body_0)).toEqual(["ERROR", " ", "connection"]);
  });

  it("should apply a field filter only to its own column and key", async () => {
    const { processHitsInChunks } = useLogsHighlighter(gt);
    const results = await processHitsInChunks(
      [{ body: "kelvin reading", edge_case: "kelvin_sign" }],
      columns,
      true,
      "str_match_ignore_case(body, 'kelvin')",
      50,
      ["body", "edge_case"],
    );
    expect(highlightedTexts(results.body_0)).toEqual(["kelvin"]);
    expect(highlightedTexts(results.edge_case_0)).toEqual([]);
    // The source column renders every key; only body's value is highlighted
    expect(highlightedTexts(results.source_0)).toEqual(["kelvin"]);
  });

  it("should keep match_all keywords global", async () => {
    const { processHitsInChunks } = useLogsHighlighter(gt);
    const results = await processHitsInChunks(
      [{ body: "kelvin reading", edge_case: "kelvin_sign" }],
      columns,
      true,
      "match_all('kelvin')",
      50,
      ["body", "edge_case"],
    );
    expect(highlightedTexts(results.body_0)).toEqual(["kelvin"]);
    expect(highlightedTexts(results.edge_case_0)).toEqual(["kelvin"]);
  });
});
