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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive, ref } from "vue";

const fetchFieldValues = vi.fn();
const fieldValues = ref<Record<string, any>>({});
const searchObj = reactive<any>({
  meta: { sqlMode: false, searchMode: "spans" },
  data: {
    stream: { selectedStream: { value: "otel_demo" }, selectedStreamFields: [] },
    datetime: { startTime: 1, endTime: 2 },
  },
});

vi.mock("@/types/i18n", () => ({ useI18nTyped: () => ({ t: (key: string) => key }) }));
vi.mock("vuex", () => ({ useStore: () => ({ state: { zoConfig: {} } }) }));
vi.mock("@/composables/useTraces", () => ({ default: () => ({ searchObj }) }));
vi.mock("@/composables/useFieldValuesStream", () => ({
  default: () => ({
    fieldValues,
    fetchFieldValues,
    cancelFieldStream: vi.fn(),
    resetFieldValues: vi.fn(),
  }),
}));

import { useTracesSqlTemplates } from "./useTracesSqlTemplates";

describe("useTracesSqlTemplates", () => {
  beforeEach(() => {
    fetchFieldValues.mockClear();
    fieldValues.value = {};
    searchObj.meta.sqlMode = false;
    searchObj.meta.searchMode = "spans";
    searchObj.data.stream.selectedStreamFields = [];
    searchObj.data.stream.selectedStream = { value: "otel_demo" };
    searchObj.data.datetime = { startTime: 1, endTime: 2 };
  });

  it("asks for service names only once the gallery or Examples menu shows", async () => {
    const shown = ref(false);
    const scope = effectScope();
    scope.run(() => useTracesSqlTemplates(() => shown.value));
    searchObj.meta.sqlMode = true;
    await nextTick();
    searchObj.data.datetime = { startTime: 1, endTime: 5 };
    await nextTick();
    expect(fetchFieldValues).not.toHaveBeenCalled();
    shown.value = true;
    await nextTick();
    expect(fetchFieldValues).toHaveBeenCalledTimes(1);
    expect(fetchFieldValues.mock.calls[0][0]).toMatchObject({ start_time: 1, end_time: 5 });
    scope.stop();
  });

  it("waits for a time range, asks once per stream and range, and asks again when either changes", async () => {
    searchObj.data.datetime = { startTime: 0, endTime: 0 };
    const scope = effectScope();
    scope.run(() => useTracesSqlTemplates(() => true));
    searchObj.meta.sqlMode = true;
    await nextTick();
    expect(fetchFieldValues).not.toHaveBeenCalled();

    searchObj.data.datetime = { startTime: 10, endTime: 20 };
    await nextTick();
    expect(fetchFieldValues).toHaveBeenCalledTimes(1);
    expect(fetchFieldValues.mock.calls[0][0]).toMatchObject({ start_time: 10, end_time: 20 });

    searchObj.data.stream.selectedStream = { value: "otel_demo" };
    searchObj.data.datetime = { startTime: 10, endTime: 20 };
    searchObj.meta.searchMode = "traces";
    await nextTick();
    searchObj.meta.searchMode = "spans";
    await nextTick();
    expect(fetchFieldValues).toHaveBeenCalledTimes(1);

    searchObj.data.datetime = { startTime: 10, endTime: 30 };
    await nextTick();
    expect(fetchFieldValues).toHaveBeenCalledTimes(2);

    searchObj.data.stream.selectedStream = { value: "default" };
    await nextTick();
    expect(fetchFieldValues).toHaveBeenCalledTimes(3);
    expect(fetchFieldValues.mock.calls[2][0]).toMatchObject({ stream_name: "default" });
    scope.stop();
  });

  it("asks once per relative period, not again when a Run moves the window forward", async () => {
    searchObj.data.datetime = {
      type: "relative",
      relativeTimePeriod: "15m",
      startTime: 10,
      endTime: 20,
    };
    const scope = effectScope();
    scope.run(() => useTracesSqlTemplates(() => true));
    searchObj.meta.sqlMode = true;
    await nextTick();
    expect(fetchFieldValues).toHaveBeenCalledTimes(1);

    searchObj.data.datetime = {
      type: "relative",
      relativeTimePeriod: "15m",
      startTime: 15,
      endTime: 25,
    };
    await nextTick();
    expect(fetchFieldValues).toHaveBeenCalledTimes(1);

    searchObj.data.datetime = {
      type: "relative",
      relativeTimePeriod: "1h",
      startTime: 15,
      endTime: 25,
    };
    await nextTick();
    expect(fetchFieldValues).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("reads service names for the trace questions once SQL mode is on in the Spans view", async () => {
    const { sqlTemplates } = useTracesSqlTemplates(() => true);
    expect(fetchFieldValues).not.toHaveBeenCalled();
    searchObj.meta.sqlMode = true;
    await nextTick();
    expect(fetchFieldValues).toHaveBeenCalledTimes(1);
    expect(fetchFieldValues.mock.calls[0][0]).toMatchObject({
      fields: ["service_name"],
      stream_name: "otel_demo",
      stream_type: "traces",
    });

    fieldValues.value = {
      service_name: { values: [{ key: "null" }, { key: "frontend" }, { key: "cart" }] },
    };
    const missing = sqlTemplates.value.find((tpl) => tpl.id === "missingSpan")!;
    expect(missing.services).toEqual(["frontend", "cart"]);
    expect(missing.sql).toContain("service_name = 'frontend'");
  });

  it("offers no templates and asks for nothing in the Traces view", async () => {
    searchObj.meta.searchMode = "traces";
    const { sqlTemplates } = useTracesSqlTemplates(() => true);
    searchObj.meta.sqlMode = true;
    await nextTick();
    expect(fetchFieldValues).not.toHaveBeenCalled();
    expect(sqlTemplates.value).toEqual([]);
  });

  it("gates Tokens by model on the schema", async () => {
    const { sqlTemplates } = useTracesSqlTemplates(() => true);
    searchObj.meta.sqlMode = true;
    await nextTick();
    expect(sqlTemplates.value.map((tpl) => tpl.id)).not.toContain("tokensByModel");
    searchObj.data.stream.selectedStreamFields = [{ name: "gen_ai_request_model" }];
    expect(sqlTemplates.value.map((tpl) => tpl.id)).not.toContain("tokensByModel");
    searchObj.data.stream.selectedStreamFields = [
      { name: "gen_ai_request_model" },
      { name: "gen_ai_usage_input_tokens" },
    ];
    expect(sqlTemplates.value.map((tpl) => tpl.id)).toContain("tokensByModel");
  });
});
