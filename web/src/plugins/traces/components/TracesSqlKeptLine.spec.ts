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

import { beforeAll, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import TracesSqlKeptLine from "./TracesSqlKeptLine.vue";

const parser = vi.hoisted(() => ({ value: null as any }));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ tracesParser: parser }),
}));

beforeAll(async () => {
  const mod = await import("@openobserve/node-sql-parser/build/datafusionsql");
  parser.value = new mod.default.Parser();
});

const GROUPED = `SELECT service_name, count(*) FROM "default" WHERE a = 1 GROUP BY service_name`;

const mountLine = (props: Record<string, unknown> = {}) =>
  mount(TracesSqlKeptLine, {
    props: { sql: GROUPED, filter: "b = 2", filterFromSql: null, stream: "default", ...props },
    global: { plugins: [i18n] },
  });

const text = (wrapper: ReturnType<typeof mountLine>) =>
  wrapper.find('[data-test="traces-sql-kept-line-text"]').text();
const useWhere = (wrapper: ReturnType<typeof mountLine>) =>
  wrapper.find('[data-test="traces-sql-kept-line-use-where-btn"]');

describe("TracesSqlKeptLine", () => {
  it("says the filter is not from the SQL when one is set", () => {
    expect(text(mountLine())).toBe("SQL stays in Spans. This filter is not from your SQL.");
  });

  it("says every trace shows when no filter is set", () => {
    expect(text(mountLine({ filter: "  " }))).toBe(
      "SQL stays in Spans. No filter is set, so this shows every trace in the range.",
    );
  });

  it("says the WHERE came from the SQL while the filter is unchanged, and what is not applied", () => {
    expect(text(mountLine({ filter: "a = 1", filterFromSql: "a = 1" }))).toBe(
      "Using the WHERE from your SQL. It replaced your filter. GROUP BY and HAVING are not applied.",
    );
    const plain = `SELECT * FROM "default" WHERE a = 1`;
    expect(text(mountLine({ sql: plain, filter: "a = 1", filterFromSql: "a = 1" }))).toBe(
      "Using the WHERE from your SQL. It replaced your filter.",
    );
    expect(text(mountLine({ filter: "a = 2", filterFromSql: "a = 1" }))).toBe(
      "SQL stays in Spans. This filter is not from your SQL.",
    );
  });

  it("stops saying the WHERE came from the SQL once the SQL's WHERE was edited", () => {
    const edited = `SELECT * FROM "default" WHERE a = 2`;
    expect(text(mountLine({ sql: edited, filter: "a = 1", filterFromSql: "a = 1" }))).toBe(
      "SQL stays in Spans. This filter is not from your SQL.",
    );
  });

  it("names the stream when the SQL reads another one", () => {
    expect(text(mountLine({ sql: `SELECT * FROM "other" WHERE a = 1` }))).toContain(
      "Your SQL reads other; this list uses the stream picker.",
    );
  });

  it("emits both actions", async () => {
    const wrapper = mountLine();
    await useWhere(wrapper).trigger("click");
    await wrapper.find('[data-test="traces-sql-kept-line-back-to-sql-btn"]').trigger("click");
    expect(wrapper.emitted("use-where")).toHaveLength(1);
    expect(wrapper.emitted("back-to-sql")).toHaveLength(1);
  });

  it.each([
    [
      `SELECT trace_id FROM "default" GROUP BY trace_id HAVING count(*) > 450`,
      "Your SQL has no WHERE that the Traces view can run.",
    ],
    [
      `SELECT * FROM "default" WHERE trace_id IN (SELECT trace_id FROM "default")`,
      "Your SQL has no WHERE that the Traces view can run.",
    ],
    [`SELECT * FROM "default" WHERE (a = 1`, "Your SQL can't be read. Fix it in Spans first."],
  ])("shows Use WHERE from SQL disabled, never hidden, for %s", async (sql, reason) => {
    const wrapper = mountLine({ sql });
    expect(useWhere(wrapper).attributes("aria-disabled")).toBe("true");
    expect(useWhere(wrapper).text()).toContain(reason);
    await useWhere(wrapper).trigger("click");
    expect(wrapper.emitted("use-where")).toBeUndefined();
  });
});
