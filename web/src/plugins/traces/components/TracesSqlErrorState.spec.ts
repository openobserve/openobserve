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
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import TracesSqlErrorState from "./TracesSqlErrorState.vue";
import { ONE_HOUR_US } from "@/utils/traces/tracesSqlErrors";

const FIELD_ERROR =
  "Search field not found: Schema error: No field named servce_name.\nValid fields are otel_demo._timestamp.";
const OOM_ERROR =
  "Search SQL execute error: Resources exhausted: Failed to allocate additional 1 GB for HashJoinInput[0]";
const QUERY = `SELECT servce_name, count(*) FROM "default" WHERE x = 'servce_name' GROUP BY servce_name`;

const mountState = (props: Record<string, unknown>) =>
  mount(TracesSqlErrorState, {
    props: {
      errorCode: 400,
      errorMsg: FIELD_ERROR,
      errorDetail: "",
      aiEnabled: false,
      streamName: "default",
      query: QUERY,
      suggestions: [],
      fields: ["service_name", "duration"],
      rangeUs: ONE_HOUR_US,
      ...props,
    },
    global: { plugins: [i18n, store] },
  });

const card = (wrapper: ReturnType<typeof mountState>, name: string) =>
  wrapper.find(`[data-test="traces-sql-fix-${name}-card"]`);

describe("TracesSqlErrorState", () => {
  it("offers Did you mean for an unknown field and runs the query with the field replaced outside strings", async () => {
    const wrapper = mountState({});
    expect(wrapper.text()).toContain("Field not found: servce_name");
    const fix = card(wrapper, "suggestion");
    expect(fix.text()).toContain("Did you mean service_name?");
    await fix.trigger("click");
    expect(wrapper.emitted("run-sql")?.[0]).toEqual([
      `SELECT service_name, count(*) FROM "default" WHERE x = 'servce_name' GROUP BY service_name`,
    ]);
  });

  it("prefers the suggestion the server sent", async () => {
    const wrapper = mountState({
      errorCode: 20004,
      errorMsg: "unknown field 'servce_name'",
      suggestions: ["service_names"],
    });
    expect(card(wrapper, "suggestion").text()).toContain("Did you mean service_names?");
  });

  it("offers Use last 1 hour for an out-of-memory error over a longer range", async () => {
    const wrapper = mountState({ errorCode: 500, errorMsg: OOM_ERROR, rangeUs: 24 * ONE_HOUR_US });
    expect(wrapper.text()).toContain(i18n.global.t("traces.sqlMode.errors.outOfMemoryTitle"));
    await card(wrapper, "last-hour").trigger("click");
    expect(wrapper.emitted("use-last-hour")).toHaveLength(1);
  });

  it("says the stream name is missing for FROM where, with no card", () => {
    const wrapper = mountState({ errorCode: 20002, errorMsg: "Search stream not found: where" });
    expect(wrapper.text()).toContain("Stream name missing after FROM");
    expect(wrapper.find('[data-test^="traces-sql-fix-"]').exists()).toBe(false);
  });

  it("says the stream name is missing for a parser error on FROM WHERE", () => {
    const wrapper = mountState({
      errorCode: 400,
      errorMsg: `Error# SQL error: ParserError("Expected: end of statement, found: > at Line: 1, Column: 30")`,
      query: "SELECT * FROM WHERE duration > 1",
    });
    expect(wrapper.text()).toContain("Stream name missing after FROM");
    expect(wrapper.find('[data-test^="traces-sql-fix-"]').exists()).toBe(false);
  });

  it("offers Search one field instead when match_all needs full-text fields, and runs the rewrite", async () => {
    const wrapper = mountState({
      errorCode: 20001,
      errorMsg: "Search SQL not valid",
      errorDetail: "match_all() should only apply to the stream that have full text search fields",
      query: `SELECT * FROM "default" WHERE match_all('redis')`,
    });
    const fix = card(wrapper, "str-match");
    expect(fix.text()).toContain("Search one field instead");
    await fix.trigger("click");
    expect(wrapper.emitted("run-sql")?.[0]).toEqual([
      `SELECT * FROM "default" WHERE str_match(operation_name, 'redis')`,
    ]);
  });

  it("lets a fix card grow to its text instead of the shared card width", () => {
    const classes = card(mountState({}), "suggestion").classes();
    expect(classes).toEqual(expect.arrayContaining(["flex-none!", "basis-auto!", "max-w-full!"]));
  });

  it("shows any other error with no fix card", () => {
    const wrapper = mountState({ errorCode: 500, errorMsg: "Search SQL execute error: boom" });
    expect(wrapper.find('[data-test^="traces-sql-fix-"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="query-error-fix-query-card"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("boom");
  });

  it("offers Ask AI only when AI is enabled", async () => {
    expect(mountState({}).find('[data-test="query-error-ask-ai-btn"]').exists()).toBe(false);
    const wrapper = mountState({ aiEnabled: true });
    await wrapper.find('[data-test="query-error-ask-ai-btn"]').trigger("click");
    expect(wrapper.emitted("ask-ai")).toHaveLength(1);
  });
});
