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
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useQueryPlaceholder } from "@/components/logs/useQueryPlaceholder";
import { raw, type TranslateFn } from "@/types/i18n";
import { planFilter, suggestRecovery } from "@/utils/query/freeTextFilter";

const t = ((key: string) => raw(key)) as TranslateFn;

const FIELDS = [
  { name: "_timestamp", dataType: "Int64" },
  { name: "level", isInterestingField: true, dataType: "Utf8" },
  { name: "status", isInterestingField: true, dataType: "Int64" },
  { name: "body", ftsKey: true, dataType: "Utf8" },
  { name: "host", dataType: "Utf8" },
  { name: "group", label: true },
];

const VALUES = {
  level: { isLoading: false, values: [{ key: "error", count: 3 }], hasMore: false, errMsg: "" },
  body: { isLoading: false, values: [{ key: "boom", count: 2 }], hasMore: false, errMsg: "" },
};

type Options = Parameters<typeof useQueryPlaceholder>[5];

function examplesFor(options: Options, sqlMode = false, values: object = VALUES): string[] {
  let captured: string[] = [];
  const Probe = defineComponent({
    setup() {
      const { examples } = useQueryPlaceholder(
        ref(FIELDS),
        ref(values as never),
        ref(sqlMode),
        ref(false),
        t,
        options,
      );
      captured = examples.value;
      return () => h("div");
    },
  });
  mount(Probe).unmount();
  return captured;
}

describe("useQueryPlaceholder", () => {
  it("keeps the Traces list (excludeMatchAll) unchanged", () => {
    expect(examplesFor({ excludeMatchAll: true })).toMatchInlineSnapshot(`
      [
        "level='error'",
        "str_match(level, 'error')",
      ]
    `);
    expect(examplesFor({ excludeMatchAll: true }, true)).toMatchInlineSnapshot(`
      [
        "SELECT * FROM stream WHERE level = 'error'",
        "SELECT * FROM stream WHERE level = 'error' AND status >= 500",
        "SELECT * FROM stream WHERE level = 'error' OR status >= 500",
      ]
    `);
  });

  it("keeps the RUM list (no options, no values) unchanged", () => {
    expect(examplesFor(undefined, false, {})).toMatchInlineSnapshot(`
      [
        "level='value'",
        "match_all('error')",
        "level='value' AND match_all('error')",
        "match_all('error*')",
        "level='value' AND status=200 AND match_all('error')",
        "match_all('*error')",
        "str_match(level, 'value')",
        "level='value' OR match_all('*error')",
      ]
    `);
    expect(examplesFor(undefined, true, {})).toMatchInlineSnapshot(`
      [
        "SELECT * FROM stream WHERE level = 'value'",
        "SELECT * FROM stream WHERE level = 'value' AND status >= 500",
        "SELECT * FROM stream WHERE level = 'value' OR status >= 500",
        "SELECT * FROM stream WHERE match_all('error')",
        "SELECT * FROM stream WHERE level = 'value' AND match_all('error')",
      ]
    `);
  });

  it("keeps the pipeline, alert and function lists (noStreamText) unchanged", () => {
    const options = { noStreamText: "pick a stream" };
    expect(examplesFor(options)).toMatchInlineSnapshot(`
      [
        "level='error'",
        "match_all('boom')",
        "level='error' AND match_all('boom')",
        "match_all('boom*')",
        "level='error' AND status=200 AND match_all('boom')",
        "match_all('*boom')",
        "str_match(level, 'error')",
        "level='error' OR match_all('*boom')",
      ]
    `);
    expect(examplesFor(options, true, {})).toMatchInlineSnapshot(`
      [
        "SELECT * FROM stream WHERE level = 'value'",
        "SELECT * FROM stream WHERE level = 'value' AND status >= 500",
        "SELECT * FROM stream WHERE level = 'value' OR status >= 500",
        "SELECT * FROM stream WHERE match_all('error')",
        "SELECT * FROM stream WHERE level = 'value' AND match_all('error')",
      ]
    `);
  });

  it("keeps the default Logs list unchanged without the option", () => {
    expect(examplesFor({})).toMatchInlineSnapshot(`
      [
        "level='error'",
        "match_all('boom')",
        "level='error' AND match_all('boom')",
        "match_all('boom*')",
        "level='error' AND status=200 AND match_all('boom')",
        "match_all('*boom')",
        "str_match(level, 'error')",
        "level='error' OR match_all('*boom')",
      ]
    `);
  });

  it("leads Logs filter mode with bare words and never shows an implicit text+SQL mix", () => {
    const list = examplesFor({ freeText: true });
    const fields = new Set(FIELDS.map((f) => f.name));
    expect(list).toEqual([
      "timeout",
      '"connection refused"',
      "level='error'",
      "level='error' AND match_all('timeout')",
      "match_all('boom*')",
      "str_match(level, 'error')",
    ]);
    expect(list.slice(0, 2).map((q) => planFilter(q, fields).kind)).toEqual([
      "freeText",
      "freeText",
    ]);
    expect(list.filter((q) => q.includes("match_all"))).toHaveLength(2);
    for (const example of list) {
      expect(suggestRecovery(example, fields, true).runSuggestion).toBeNull();
    }
  });

  it("leaves SQL mode and the no-match_all variant consistent with the option", () => {
    expect(examplesFor({ freeText: true }, true)).toEqual(examplesFor({}, true));
    expect(examplesFor({ freeText: true, excludeMatchAll: true })).toEqual([
      "timeout",
      '"connection refused"',
      "level='error'",
      "str_match(level, 'error')",
    ]);
  });
});
