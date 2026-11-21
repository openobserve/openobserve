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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import SearchBar from "@/plugins/logs/SearchBar.vue";

/**
 * Drives the real `addSearchTerm` watcher in SearchBar.vue — the code path that
 * runs when a user clicks a field value in the index list to add it as a filter.
 *
 * These tests mount the component rather than re-implementing the watcher, so a
 * regression in the production code actually fails the suite.
 */
describe("SearchBar — adding a filter term to the query", () => {
  let wrapper: VueWrapper<any>;

  const mountSearchBar = () =>
    mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });

  /**
   * Sets the filter the index list would hand over and lets the watcher run.
   * Returns the query the user ends up with in the editor.
   */
  const addFilterTerm = async (filter: string) => {
    wrapper.vm.searchObj.data.stream.addToFilter = filter;
    await nextTick();
    return wrapper.vm.searchObj.data.query;
  };

  beforeEach(() => {
    wrapper = mountSearchBar();

    // searchObj is a module-level singleton in useLogs — reset what these tests touch.
    wrapper.vm.searchObj.meta.sqlMode = false;
    wrapper.vm.searchObj.data.query = "";
    wrapper.vm.searchObj.data.editorValue = "";
    wrapper.vm.searchObj.data.stream.addToFilter = "";
    wrapper.vm.searchObj.data.stream.addToFilterMode = "replace";
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("appends the filter after a match_all term that contains a pipe", async () => {
    wrapper.vm.searchObj.data.query = "match_all('text | error')";

    const query = await addFilterTerm("kubernetes_namespace_name='ziox'");

    expect(query).toBe("match_all('text | error') and kubernetes_namespace_name='ziox'");
  });

  it("leaves a match_all term with several pipes intact", async () => {
    wrapper.vm.searchObj.data.query = "match_all('a | b | c')";

    const query = await addFilterTerm("code=200");

    expect(query).toBe("match_all('a | b | c') and code=200");
  });

  it("appends the filter after a match_all term with no pipe", async () => {
    wrapper.vm.searchObj.data.query = "match_all('error')";

    const query = await addFilterTerm("code=200");

    expect(query).toBe("match_all('error') and code=200");
  });

  it("uses the filter as the whole query when the query is empty", async () => {
    const query = await addFilterTerm("code=200");

    expect(query).toBe("code=200");
  });

  it("mirrors the resulting query into the editor value", async () => {
    wrapper.vm.searchObj.data.query = "match_all('text | error')";

    await addFilterTerm("code=200");

    expect(wrapper.vm.searchObj.data.editorValue).toBe("match_all('text | error') and code=200");
  });

  it("clears addToFilter once the term has been applied", async () => {
    wrapper.vm.searchObj.data.query = "match_all('text | error')";

    await addFilterTerm("code=200");

    expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe("");
  });

  describe("two streams joined in SQL mode", () => {
    const base = `SELECT * FROM "a" JOIN "b" ON "a".k = "b".k WHERE "a".x = 1`;

    beforeEach(() => {
      wrapper.vm.searchObj.meta.sqlMode = true;
      wrapper.vm.searchObj.data.stream.selectedStream = ["a", "b"];
    });

    afterEach(() => {
      wrapper.vm.searchObj.data.stream.selectedStream = [];
    });

    it.each([
      ["k = 'v'", `"a".k = 'v'`],
      ["(k is null OR k = '')", `("a".k is null OR "a".k = '')`],
      ["(k = 'x' OR k = 'y')", `("a".k = 'x' OR "a".k = 'y')`],
    ])("qualifies every condition of %s with the first stream", async (filter, qualified) => {
      wrapper.vm.searchObj.data.query = base;
      expect(await addFilterTerm(filter)).toBe(`${base} AND ${qualified}`);
    });
  });

  describe("a field whose name ends another field's name", () => {
    const base = `SELECT * FROM "qa" WHERE db_operation_name = 'SELECT'`;

    beforeEach(() => {
      wrapper.vm.searchObj.meta.sqlMode = true;
    });

    it("adds an include and an exclude in SQL mode without touching the longer field", async () => {
      wrapper.vm.searchObj.data.query = base;
      expect(await addFilterTerm("operation_name = 'GET /'")).toBe(
        `${base} AND operation_name = 'GET /'`,
      );

      wrapper.vm.searchObj.data.query = base;
      expect(await addFilterTerm("operation_name != 'GET /'")).toBe(
        `${base} AND operation_name != 'GET /'`,
      );
    });

    it("adds a multi-value group in SQL mode without touching the longer field's group", async () => {
      const group = "(db_operation_name = 'SELECT' OR db_operation_name = 'INSERT')";
      const added = "(operation_name = 'GET /' OR operation_name = 'POST /')";
      wrapper.vm.searchObj.data.query = `SELECT * FROM "qa" WHERE ${group}`;

      expect(await addFilterTerm(added)).toBe(`SELECT * FROM "qa" WHERE ${group} AND ${added}`);
    });

    it("still replaces the exact field's condition, plain or stream-qualified", async () => {
      wrapper.vm.searchObj.data.query = `${base} AND operation_name = 'POST /'`;
      expect(await addFilterTerm("operation_name = 'GET /'")).toBe(
        `${base} AND operation_name = 'GET /'`,
      );

      wrapper.vm.searchObj.data.query = `${base} AND "qa".operation_name = 'POST /'`;
      expect(await addFilterTerm(`"qa".operation_name = 'GET /'`)).toBe(
        `${base} AND "qa".operation_name = 'GET /'`,
      );
    });

    it("still replaces a quoted exact field and leaves a quoted longer field alone", async () => {
      wrapper.vm.searchObj.data.query = `${base} AND "db_operation_name" != 'INSERT' AND "operation_name" = 'POST /' AND operation_name = 'PUT /'`;

      expect(await addFilterTerm("operation_name = 'GET /'")).toBe(
        `${base} AND "db_operation_name" != 'INSERT' AND operation_name = 'GET /' AND operation_name = 'GET /'`,
      );
    });

    it("keeps the longer field in non-SQL mode", async () => {
      wrapper.vm.searchObj.meta.sqlMode = false;
      wrapper.vm.searchObj.data.query = "db_operation_name = 'SELECT'";

      expect(await addFilterTerm("operation_name = 'GET /'")).toBe(
        "db_operation_name = 'SELECT' and operation_name = 'GET /'",
      );
    });
  });

  describe("SQL mode outer WHERE handling", () => {
    beforeEach(() => {
      wrapper.vm.searchObj.meta.sqlMode = true;
    });

    const run = async (query: string, filter: string) => {
      wrapper.vm.searchObj.data.query = query;
      return addFilterTerm(filter);
    };

    it("keeps UNION ALL on its own line after a branch ending in a line comment", async () => {
      const query = [
        "SELECT id FROM t WHERE a = 1 -- first branch",
        "UNION ALL",
        "SELECT id FROM t WHERE b = 2",
      ].join("\n");

      expect(await run(query, "c = 2")).toBe(
        [
          "SELECT id FROM t WHERE a = 1 AND c = 2 -- first branch",
          " UNION ALL ",
          "SELECT id FROM t WHERE b = 2 AND c = 2",
        ].join("\n"),
      );
    });

    it("does not replace a field that only occurs in a subquery", async () => {
      const query =
        "SELECT id FROM t\nWHERE level = 'error'\n   OR id IN (SELECT id FROM t WHERE svc_name = 'beta')";

      expect(await run(query, "svc_name = 'alpha'")).toBe(
        "SELECT id FROM t\nWHERE (level = 'error'\n   OR id IN (SELECT id FROM t WHERE svc_name = 'beta')) AND svc_name = 'alpha'",
      );
    });

    it("replaces only the outer condition when the field is also in a subquery", async () => {
      const query =
        "SELECT id FROM t WHERE svc_name = 'x' AND id IN (SELECT id FROM t WHERE svc_name = 'beta')";

      expect(await run(query, "svc_name = 'alpha'")).toBe(
        "SELECT id FROM t WHERE svc_name = 'alpha' AND id IN (SELECT id FROM t WHERE svc_name = 'beta')",
      );
    });

    it("still replaces a multi-value group in the outer WHERE", async () => {
      expect(
        await run(
          "SELECT id FROM t WHERE (svc_name = 'x' OR svc_name = 'y') ORDER BY id",
          "svc_name = 'alpha'",
        ),
      ).toBe("SELECT id FROM t WHERE svc_name = 'alpha' ORDER BY id");
    });

    it("ignores a where inside a string literal and handles each UNION branch alone", async () => {
      expect(
        await run(
          "SELECT id FROM t WHERE svc_name = 'x' UNION SELECT id FROM u WHERE msg = 'where svc_name = ''z'''",
          "svc_name = 'alpha'",
        ),
      ).toBe(
        "SELECT id FROM t WHERE svc_name = 'alpha'  UNION  SELECT id FROM u WHERE msg = 'where svc_name = ''z''' AND svc_name = 'alpha'",
      );
    });
  });

  describe("a field's included and excluded values from the values panel (U6, F1)", () => {
    const steps = (q: (field: string) => string) => [
      `(${q("level")} = 'a' OR ${q("level")} = 'b')`,
      `((${q("level")} = 'a' OR ${q("level")} = 'b') AND ${q("level")} != 'c')`,
      `(${q("level")} = 'a' AND ${q("level")} != 'c')`,
      `${q("level")} != 'c'`,
    ];

    it.each([
      ["quick mode", false, "code=200", (f: string) => f],
      ["SQL mode", true, `SELECT * FROM "s" WHERE code=200`, (f: string) => f],
      [
        "SQL mode with a quoted field",
        true,
        `SELECT * FROM "s" WHERE code=200`,
        (f: string) => `"${f}"`,
      ],
    ])("replaces the field's group on every change in %s", async (_mode, sql, start, quote) => {
      wrapper.vm.searchObj.meta.sqlMode = sql;
      wrapper.vm.searchObj.data.query = start;
      const joiner = sql ? " AND " : " and ";
      for (const filter of steps(quote)) {
        expect(await addFilterTerm(filter)).toBe(`${start}${joiner}${filter}`);
      }
    });
  });

  it("replaces the + placeholder with the picked values, in quick and SQL mode (M3)", async () => {
    wrapper.vm.searchObj.data.query = "code=200 and level=''";
    expect(await addFilterTerm("(level = 'a' OR level = 'b')")).toBe(
      "code=200 and (level = 'a' OR level = 'b')",
    );
    wrapper.vm.searchObj.meta.sqlMode = true;
    wrapper.vm.searchObj.data.query = `SELECT * FROM "s" WHERE code=200 AND "level"=''`;
    expect(await addFilterTerm("level = 'a'")).toBe(
      `SELECT * FROM "s" WHERE code=200 AND level = 'a'`,
    );
  });

  describe("free text (item 1 AC6.9)", () => {
    const stream = (name: string, fts: boolean) => ({
      name,
      schema: [
        { name: fts ? "body" : "msg_text", type: "Utf8" },
        { name: "level", type: "Utf8" },
      ],
      settings: fts ? { full_text_search_keys: ["body"] } : {},
    });

    const select = (...streams: any[]) => {
      wrapper.vm.searchObj.data.stream.selectedStream = streams.map((s) => s.name);
      wrapper.vm.searchObj.data.streamResults = { list: streams };
      wrapper.vm.searchObj.data.stream.selectedStreamFields = [{ name: "level" }];
    };

    afterEach(() => {
      wrapper.vm.searchObj.data.stream.selectedStream = [];
      wrapper.vm.searchObj.data.streamResults = { list: [] };
    });

    it("materialises the text and wraps every OR branch before adding the facet", async () => {
      select(stream("fts_a", true));
      wrapper.vm.searchObj.data.query = "timeout OR refused";

      const query = await addFilterTerm("level='error'");

      expect(query).toBe("(\nmatch_all('timeout') OR match_all('refused')\n) AND level='error'");
    });

    it("keeps today's plain append when a selected stream cannot search text", async () => {
      select(stream("fts_a", true), stream("nofts_b", false));
      wrapper.vm.searchObj.data.query = "timeout";

      const query = await addFilterTerm("level='error'");

      expect(query).toBe("timeout and level='error'");
    });

    it("uses the facet alone for a comment-only filter", async () => {
      select(stream("fts_a", true));
      wrapper.vm.searchObj.data.query = "-- note";

      expect(await addFilterTerm("level='error'")).toBe("level='error'");
    });
  });
});
