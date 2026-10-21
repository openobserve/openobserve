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

import { describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { useColorizedQuery } from "./useColorizedQuery";

const coloured = (query: string, language: string) =>
  Promise.resolve(`<span data-lang="${language}">${query}</span><img src=x onerror="x()">`);

describe("useColorizedQuery", () => {
  it("returns sanitized coloured HTML for the query's language", async () => {
    const html = useColorizedQuery(() => ({ query: "up", language: "promql" }), coloured);
    await flushPromises();
    expect(html.value).toContain('<span data-lang="promql">up</span>');
    expect(html.value).not.toContain("onerror");
  });

  it("stays empty for an empty query, so the caller shows nothing coloured", async () => {
    const colorize = vi.fn(coloured);
    const html = useColorizedQuery(() => ({ query: "", language: "sql" }), colorize);
    await flushPromises();
    expect(html.value).toBe("");
    expect(colorize).not.toHaveBeenCalled();
  });

  it("stays empty when colouring fails, leaving the caller's plain text", async () => {
    const html = useColorizedQuery(
      () => ({ query: "up", language: "promql" }),
      () => Promise.reject(new Error("chunk failed")),
    );
    await flushPromises();
    expect(html.value).toBe("");
  });

  it("keeps only the latest query's colouring when an earlier one finishes last", async () => {
    let finishFirst: (value: string) => void = () => undefined;
    const query = ref("first");
    const html = useColorizedQuery(
      () => ({ query: query.value, language: "sql" }),
      (text, language) =>
        text === "first"
          ? new Promise((resolve) => (finishFirst = resolve))
          : coloured(text, language),
    );
    query.value = "second";
    await nextTick();
    await flushPromises();
    finishFirst("<b>stale</b>");
    await flushPromises();
    expect(html.value).toContain("second");
    expect(html.value).not.toContain("stale");
  });
});
