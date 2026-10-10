// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import Index from "./Index.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { resetFreeTextSchemasForTests } from "@/composables/useLogs/freeTextSearch";
import { readLogsSignature, resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";

const { sent, streams } = vi.hoisted(() => ({
  sent: [] as {
    type: string;
    queryReq: { query: { sql: string; start_time: number; end_time: number } };
  }[],
  streams: [
    {
      name: "nofts",
      schema: [
        { name: "_timestamp", type: "Int64" },
        { name: "message", type: "Utf8" },
      ],
      settings: {},
    },
    {
      name: "fts",
      schema: [
        { name: "_timestamp", type: "Int64" },
        { name: "message", type: "Utf8" },
      ],
      settings: { full_text_search_keys: ["message"] },
    },
  ],
}));
vi.mock("@/stores", async () => ({ default: (await import("@/test/unit/helpers/store")).default }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: (typeof sent)[number]) => {
      sent.push(payload);
      return Promise.resolve();
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("@/composables/useStreams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useStreams")>();
  return {
    ...actual,
    default: () => ({
      ...actual.default(),
      getStream: async (name: string) => streams.find((stream) => stream.name === name),
      getStreams: async () => ({ list: streams }),
    }),
  };
});

let wrapper: ReturnType<typeof mount<typeof Index>>;
const results = () => sent.filter((entry) => entry.type === "search");
const app = document.createElement("div");
app.id = "app";
document.body.appendChild(app);

beforeEach(async () => {
  resetLogsAutoRunForTests();
  resetFreeTextSchemasForTests();
  (store.state as any).logs = { isInitialized: true, logs: {} };
  vi.spyOn(store, "dispatch").mockResolvedValue(undefined as any);
  wrapper = mount(Index, {
    attachTo: "#app",
    global: { provide: { store }, plugins: [i18n, router] },
  });
  await flushPromises();
  const state = wrapper.vm.searchObj;
  state.data.streamResults = { list: streams };
  state.data.stream.streamLists = streams.map((stream) => ({
    label: stream.name,
    value: stream.name,
  }));
  state.data.stream.selectedStream = ["nofts"];
  state.data.stream.selectedStreamFields = streams[0].schema.map((field) => ({
    name: field.name,
    streams: ["nofts"],
  }));
  state.meta.sqlMode = false;
  state.meta.showHistogram = false;
  state.meta.logsVisualizeToggle = "logs";
  state.meta.refreshInterval = 0;
  state.meta.jobId = "";
  state.data.query = "timeout";
  state.data.editorValue = "timeout";
  state.data.errorMsg = "";
  state.data.filterErrMsg = "";
  state.loading = false;
  state.loadingStream = false;
  state.meta.searchApplied = true;
  state.data.freeTextBlocked = {
    streams: ["nofts"],
    plan: { kind: "freeText", root: { k: "text", value: "timeout" }, units: ["timeout"] },
  };
  await flushPromises();
  sent.length = 0;
});
afterEach(() => {
  streams.splice(2);
  wrapper?.unmount();
  vi.restoreAllMocks();
  resetLogsAutoRunForTests();
  resetFreeTextSchemasForTests();
});

describe("Index no-FTS recovery requests", { timeout: 30000 }, () => {
  it.each([
    ["-refused", ""],
    ["debug -message", "debug"],
    ['-"connection refused"', ""],
  ])("field recovery never prefills an exclusion from %s", async (query, value) => {
    wrapper.vm.searchObj.data.query = query;
    await wrapper.get('[data-test="logs-no-fts-search-fields-btn"]').trigger("click");
    expect(wrapper.findComponent(OForm).vm.form.state.values.value).toBe(value);
    expect(sent).toHaveLength(0);
  });

  it.each(["debug -message", "-refused", "-debug -info"])(
    "sends the complete previewed field filter for %s",
    async (query) => {
      wrapper.vm.searchObj.data.query = query;
      await wrapper.get('[data-test="logs-no-fts-search-fields-btn"]').trigger("click");
      const preview = wrapper.get('[data-test="logs-no-fts-preview"]').text();
      expect(preview).toContain("NOT (message IS NOT NULL AND str_match_ignore_case(message,");
      await wrapper.get('[data-test="logs-no-fts-field-form"]').trigger("submit");
      await vi.waitFor(() => expect(results()).toHaveLength(1));
      expect(wrapper.vm.searchObj.data.query).toBe(preview);
      expect(results()[0].queryReq.query.sql.replace(/"message"/g, "message")).toContain(preview);
    },
  );

  it("a validation-blocked Run clears the button's dirty state until the next edit", async () => {
    const state = wrapper.vm.searchObj;
    state.data.stream.selectedStream = ["nofts", "fts"];
    state.data.freeTextBlocked = null;
    state.meta.executed = {
      generation: 0,
      signature: readLogsSignature(state),
      req: {},
      complete: true,
    };
    state.data.query = "nosuch=1";
    state.data.editorValue = "nosuch=1";
    wrapper.vm.autoRun.engine.markEditorDirty();
    await flushPromises();
    expect(wrapper.vm.searchBarRef.showRunQueryPending).toBe(true);
    wrapper.vm.searchBarRef.handleRunQueryFn();
    await flushPromises();
    expect(sent).toHaveLength(0);
    expect(state.data.filterErrMsg).not.toBe("");
    expect(wrapper.vm.searchBarRef.showRunQueryPending).toBe(false);
    state.data.query = "nosuch=2";
    state.data.editorValue = "nosuch=2";
    wrapper.vm.autoRun.engine.markEditorDirty();
    await flushPromises();
    expect(wrapper.vm.searchBarRef.showRunQueryPending).toBe(true);
  });

  it("blocks text on a user-defined schema without any full-text field", async () => {
    const state = wrapper.vm.searchObj;
    streams.push({
      ...streams[1],
      name: "uds",
      settings: { ...streams[1].settings, defined_schema_fields: ["_timestamp"] },
    });
    state.data.streamResults = { list: streams };
    state.data.stream.selectedStream = ["uds"];
    state.data.query = "row";
    state.data.editorValue = "row";
    wrapper.vm.searchBarRef.handleRunQueryFn();
    await flushPromises();
    expect(sent).toHaveLength(0);
    expect(state.data.freeTextBlocked?.streams).toEqual(["uds"]);
  });

  it("defaults UDS recovery to an allowed field", async () => {
    const state = wrapper.vm.searchObj;
    streams.push({
      name: "uds",
      schema: [
        { name: "_timestamp", type: "Int64" },
        { name: "extra", type: "Utf8" },
        { name: "level", type: "Utf8" },
        { name: "log", type: "Utf8" },
      ],
      settings: { defined_schema_fields: ["level"] },
    });
    state.data.streamResults = { list: streams };
    state.data.stream.selectedStream = ["uds"];
    state.data.query = "error";
    state.data.freeTextBlocked = { ...state.data.freeTextBlocked, streams: ["uds"] };
    await flushPromises();
    expect(wrapper.vm.noFtsRecoverySchemas[0].schema.map((field) => field.name)).toEqual([
      "_timestamp",
      "level",
    ]);
    await wrapper.get('[data-test="logs-no-fts-search-fields-btn"]').trigger("click");
    expect(wrapper.findComponent(OForm).vm.form.state.values.field).toBe("level");
    const preview = wrapper.get('[data-test="logs-no-fts-preview"]').text();
    await wrapper.get('[data-test="logs-no-fts-field-form"]').trigger("submit");
    await vi.waitFor(() => expect(results()).toHaveLength(1));
    expect(results()[0].queryReq.query.sql.replace(/"level"/g, "level")).toContain(preview);
  });

  it("open, edit and cancel issue zero requests and restore the triggering card", async () => {
    const trigger = wrapper.get('[data-test="logs-no-fts-search-fields-btn"]');
    await trigger.trigger("click");
    const form = wrapper.findComponent(OForm).vm.form;
    form.setFieldValue("value", "O'Reilly");
    await flushPromises();
    expect(wrapper.get('[data-test="logs-no-fts-preview"]').text()).toBe(
      "(message IS NOT NULL AND str_match_ignore_case(message, 'o''reilly'))",
    );
    expect(sent).toHaveLength(0);
    await wrapper.get('[aria-label="Close field search"]').trigger("click");
    await flushPromises();
    expect(sent).toHaveLength(0);
    expect(document.activeElement).toBe(trigger.element);
    expect(wrapper.vm.searchObj.data.query).toBe("timeout");
  });

  it.each([
    ["O'Reilly", "(message IS NOT NULL AND str_match_ignore_case(message, 'o''reilly'))"],
    ["Ошибка", "(message IS NOT NULL AND str_match_ignore_case(message, 'ошибка'))"],
    ["--debug", "(message IS NOT NULL AND str_match_ignore_case(message, '--debug'))"],
  ])(
    "submitting %s emits one results request with exactly the previewed filter and scan off",
    async (value, expected) => {
      await wrapper.get('[data-test="logs-no-fts-search-fields-btn"]').trigger("click");
      wrapper.findComponent(OForm).vm.form.setFieldValue("value", value);
      await flushPromises();
      const preview = wrapper.get('[data-test="logs-no-fts-preview"]').text();
      expect(preview).toBe(expected);
      await wrapper.get('[data-test="logs-no-fts-field-form"]').trigger("submit");
      await vi.waitFor(() => expect(results()).toHaveLength(1));
      expect(results()[0].queryReq.query.sql.replace(/"message"/g, "message")).toContain(expected);
      expect(wrapper.vm.searchObj.data.query).toBe(preview);
      expect(wrapper.vm.searchObj.meta.freeTextScan ?? {}).toEqual({});
      expect(results()[0].queryReq.query.sql).not.toContain("match_all");
    },
  );

  it("clear-and-run retains all streams and the time window and sends one results run", async () => {
    const state = wrapper.vm.searchObj;
    state.data.stream.selectedStream = ["nofts", "fts"];
    state.data.datetime.type = "absolute";
    state.data.datetime.startTime = 1700000000000000;
    state.data.datetime.endTime = 1700000900000000;
    const before = {
      startTime: state.data.datetime.startTime,
      endTime: state.data.datetime.endTime,
    };
    await wrapper.get('[data-test="logs-no-fts-clear-run-btn"]').trigger("click");
    await vi.waitFor(() => expect(results()).toHaveLength(1));
    expect(state.data.query).toBe("");
    expect(state.data.stream.selectedStream).toEqual(["nofts", "fts"]);
    expect(state.data.datetime).toMatchObject(before);
    expect(results()[0].queryReq.query.start_time).toBe(before.startTime);
    expect(results()[0].queryReq.query.end_time).toBe(before.endTime);
    expect(results()[0].queryReq.query.sql).not.toContain("timeout");
    expect(results()[0].queryReq.query.sql).toContain("nofts");
    expect(results()[0].queryReq.query.sql).toContain("fts");
  });

  it("mixed-banner cancel retains chips and rows; submitting selects only the named skipped stream", async () => {
    const state = wrapper.vm.searchObj;
    state.data.stream.selectedStream = ["fts", "nofts"];
    state.data.freeTextBlocked = null;
    state.data.freeTextExcluded = ["nofts"];
    state.data.missingStreamMessage = "nofts was skipped";
    state.data.queryResults = {
      total: 1,
      hits: [{ _timestamp: 1700000000000000, message: "timeout" }],
    };
    await flushPromises();
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="logs-missing-stream-banner"]').exists()).toBe(true),
    );
    const banner = wrapper.get('[data-test="logs-missing-stream-banner"]');
    const originalRows = [...state.data.queryResults.hits];
    await banner.get('[data-test="logs-no-fts-search-fields-btn"]').trigger("click");
    expect(banner.text()).toContain("Search nofts only; fts will be deselected.");
    await banner.get('[aria-label="Close field search"]').trigger("click");
    await flushPromises();
    expect(sent).toHaveLength(0);
    expect(state.data.stream.selectedStream).toEqual(["fts", "nofts"]);
    expect(state.data.queryResults.hits).toEqual(originalRows);
    await banner.get('[data-test="logs-no-fts-search-fields-btn"]').trigger("click");
    await banner.get("form").trigger("submit");
    await vi.waitFor(() => expect(results()).toHaveLength(1));
    expect(state.data.stream.selectedStream).toEqual(["nofts"]);
    expect(results()[0].queryReq.query.sql).toContain('"nofts"');
    expect(results()[0].queryReq.query.sql).not.toContain('"fts"');
  });
});
