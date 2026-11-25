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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import ExplorerFilterBar from "./ExplorerFilterBar.vue";
import QueryEditor from "@/components/QueryEditor.vue";
import { EXPLORER_FILTER_MODE_KEY } from "@/utils/dashboard/pointExplorers";

// The one chips-or-own key all three explorers share, apart from the Logs/Traces pages' keys.
const KEY = EXPLORER_FILTER_MODE_KEY;
const PAGE_KEYS = ["o2.logs.queryInput", "o2.traces.queryInput"];

describe("ExplorerFilterBar", () => {
  let wrapper: VueWrapper<any>;
  const loadValues = vi.fn(async (field: string) => [`${field}-a`, `${field}-b`]);
  const mountBar = (
    ownKind: "where" | "sql" = "where",
    prefix = "x",
    stubs: Record<string, unknown> = {
      QueryEditor: {
        name: "QueryEditor",
        props: {
          query: String,
          dataTestPrefix: String,
          filterMode: Boolean,
          fullTextSearch: Boolean,
          keywords: Array,
          fieldValueResolver: Function,
          editorHeight: String,
          hideNlToggle: Boolean,
          languages: Array,
        },
        emits: ["update:query", "run-query"],
        template: "<div :data-test='dataTestPrefix' />",
      },
    },
  ) => {
    wrapper = mount(ExplorerFilterBar, {
      props: {
        chipsQuery: "level = 'error'",
        ownKind,
        ownValue:
          ownKind === "sql" ? `SELECT * FROM "app" WHERE level = 'error'` : "level = 'error'",
        fields: [{ name: "level", type: "string" }],
        loadValues,
        dataTestPrefix: prefix,
      },
      attachTo: document.body,
      global: { plugins: [i18n, store], stubs },
    });
    return wrapper;
  };
  // The user's Auto Run toggle from the Logs/Traces "Run query" menu: "true" is on, anything else off.
  const AUTO_RUN_KEY = "oo_toggle_auto_run";
  const autoRun = (value: string | null) => {
    if (value === null) localStorage.removeItem(AUTO_RUN_KEY);
    else localStorage.setItem(AUTO_RUN_KEY, value);
  };
  const server = (on: boolean) => {
    (store.state.zoConfig as any).auto_query_enabled = on;
  };
  const builder = () => wrapper.findComponent({ name: "SqlFilterBuilder" });
  const toggle = () => wrapper.find("[data-test='x-filter-builder-toggle']");

  beforeEach(() => {
    localStorage.setItem(KEY, "builder");
    PAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  });
  afterEach(() => {
    wrapper?.unmount();
    autoRun(null);
    server(false);
    vi.useRealTimers();
  });

  it("is the Traces page's filter row: no box, chips from the left, <> pinned top-right, no Run", () => {
    mountBar();
    const row = wrapper.find("[data-test='x-filter-box']");
    expect(row.classes()).not.toContain("rounded-default");
    expect(row.classes()).toEqual(expect.arrayContaining(["flex", "border-t"]));
    const toggle = row.find("[data-test='x-filter-builder-toggle']");
    expect(toggle.classes()).toEqual(expect.arrayContaining(["absolute!", "top-0.75", "right-1"]));
    // The chips' scroller leaves the right end to the builder's clear-all and the toggle.
    expect(row.find("[data-test='x-filter-builder']").element.parentElement?.className).toContain(
      "ps-1.5",
    );
    expect(row.find("[data-test='x-filter-builder']").element.parentElement?.className).toContain(
      "pe-10",
    );
    expect(row.find("[data-test='x-filter-run']").exists()).toBe(false);
    expect(builder().props("query")).toBe("level = 'error'");
  });

  it("'write your own' is the WHERE text for traces and the full SQL editor for logs and metrics", async () => {
    mountBar("where");
    await toggle().trigger("click");
    expect(wrapper.find("[data-test='x-filter-input']").exists()).toBe(true);
    wrapper.unmount();
    localStorage.setItem(KEY, "builder");
    mountBar("sql");
    await toggle().trigger("click");
    const editor = wrapper.findComponent({ name: "QueryEditor" });
    expect(editor.props("query")).toBe(`SELECT * FROM "app" WHERE level = 'error'`);
    // The editor sits in the same row as the toggle.
    expect(wrapper.find("[data-test='x-filter-box'] [data-test='x-editor']").exists()).toBe(true);
    expect(editor.props()).toMatchObject({ filterMode: false, fullTextSearch: true, keywords: [] });
    editor.vm.$emit("update:query", "SELECT 1");
    editor.vm.$emit("run-query");
    expect(wrapper.emitted("update:ownValue")?.at(-1)).toEqual(["SELECT 1"]);
    expect(wrapper.emitted("run")).toHaveLength(1);
  });

  it("uses the one shared key: a choice made in one explorer is how another opens", async () => {
    expect(KEY).toBe("o2.dashboard.explorer.queryInput");
    localStorage.removeItem(KEY);
    // Traces (WHERE text) switches to chips…
    mountBar("where", "trace");
    await wrapper.find("[data-test='trace-filter-builder-toggle']").trigger("click");
    expect(localStorage.getItem(KEY)).toBe("builder");
    wrapper.unmount();
    // …so Metrics (full SQL) opens on chips too.
    mountBar("sql", "metrics");
    expect(wrapper.find("[data-test='metrics-filter-builder']").exists()).toBe(true);
    await wrapper.find("[data-test='metrics-filter-builder-toggle']").trigger("click");
    expect(localStorage.getItem(KEY)).toBe("query");
    wrapper.unmount();
    // …and back to write-your-own in Logs.
    mountBar("sql", "logs");
    expect(wrapper.find("[data-test='logs-filter-builder']").exists()).toBe(false);
  });

  it("opens in write-your-own when nothing is stored, as the Logs and Traces pages do", () => {
    localStorage.removeItem(KEY);
    mountBar();
    expect(builder().exists()).toBe(false);
    expect(wrapper.find("[data-test='x-filter-input']").exists()).toBe(true);
  });

  it("opens on chips when 'builder' is stored; <> writes 'query' / 'builder'; a remount keeps it", async () => {
    mountBar();
    expect(builder().exists()).toBe(true);
    await toggle().trigger("click");
    expect(localStorage.getItem(KEY)).toBe("query");
    wrapper.unmount();
    mountBar();
    expect(wrapper.find("[data-test='x-filter-input']").exists()).toBe(true);
    await toggle().trigger("click");
    expect(localStorage.getItem(KEY)).toBe("builder");
    wrapper.unmount();
    mountBar();
    expect(builder().exists()).toBe(true);
    PAGE_KEYS.forEach((key) => expect(localStorage.getItem(key)).toBeNull());
  });

  it("with the server setting and the user's Auto Run both on, chip edits settle into one run", async () => {
    autoRun("true");
    server(true);
    mountBar();
    vi.useFakeTimers();
    builder().vm.$emit("update:query", "level = 'warn'");
    builder().vm.$emit("update:query", "level = 'info'");
    vi.advanceTimersByTime(299);
    expect(wrapper.emitted("run")).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(wrapper.emitted("run")).toHaveLength(1);
    expect(wrapper.emitted("update:chipsQuery")?.at(-1)).toEqual(["level = 'info'"]);

    autoRun("false");
    builder().vm.$emit("update:query", "level = 'debug'");
    vi.advanceTimersByTime(1000);
    expect(wrapper.emitted("run")).toHaveLength(1);
  });

  it.each([
    ["the Auto Run key missing, server on", null, true],
    ["the Auto Run key 'false', server on", "false", true],
    ["Auto Run on, server off", "true", false],
  ])("with %s, a chip edit only writes the condition", async (_name, value, serverOn) => {
    autoRun(value);
    server(serverOn);
    mountBar();
    vi.useFakeTimers();
    builder().vm.$emit("update:query", "level = 'warn'");
    vi.advanceTimersByTime(1000);
    expect(wrapper.emitted("run")).toBeUndefined();
    expect(wrapper.emitted("update:chipsQuery")?.at(-1)).toEqual(["level = 'warn'"]);
    // The drawer never writes the user's toggle.
    expect(localStorage.getItem(AUTO_RUN_KEY)).toBe(value);
  });

  it("the WHERE text is the code editor in filter mode, no WHERE prefix, the fields and their values offered", async () => {
    localStorage.removeItem(KEY);
    mountBar();
    const editor = wrapper.findComponent({ name: "QueryEditor" });
    expect(editor.props()).toMatchObject({
      query: "level = 'error'",
      dataTestPrefix: "x-filter-input",
      filterMode: true,
      fullTextSearch: false,
      editorHeight: "4rem",
      hideNlToggle: true,
      languages: ["sql"],
    });
    expect(editor.props("keywords")).toEqual([
      { name: "level", label: "level", kind: "Field", insertText: "level" },
    ]);
    expect(await editor.props("fieldValueResolver")("level")).toEqual(["level-a", "level-b"]);
    expect(loadValues).toHaveBeenCalledWith("level", "");
    expect(wrapper.find("[data-test='x-filter-box']").text()).not.toContain("WHERE");
    // The bare condition goes out as typed.
    editor.vm.$emit("update:query", "level = 'warn'");
    expect(wrapper.emitted("update:ownValue")?.at(-1)).toEqual(["level = 'warn'"]);
  });

  it("the WHERE editor runs on its run-query (Ctrl+Enter) only, even with auto run on", async () => {
    autoRun("true");
    server(true);
    localStorage.removeItem(KEY);
    mountBar();
    vi.useFakeTimers();
    const editor = wrapper.findComponent({ name: "QueryEditor" });
    editor.vm.$emit("update:query", "level = 'warn'");
    vi.advanceTimersByTime(1000);
    expect(wrapper.emitted("run")).toBeUndefined();
    editor.vm.$emit("run-query");
    expect(wrapper.emitted("run")).toHaveLength(1);
  });

  it("hands filter mode, fields and values through the real QueryEditor, and its Ctrl+Enter runs", async () => {
    localStorage.removeItem(KEY);
    mountBar("where", "x", {
      CodeQueryEditor: {
        name: "CodeQueryEditor",
        props: ["query", "filterMode", "fullTextSearch", "keywords", "fieldValueResolver"],
        emits: ["update:query", "run-query"],
        template: "<div data-test='code-editor' />",
      },
    });
    await flushPromises();
    expect(wrapper.findComponent(QueryEditor).exists()).toBe(true);
    const code = wrapper.findComponent({ name: "CodeQueryEditor" });
    expect(code.props()).toMatchObject({
      query: "level = 'error'",
      filterMode: true,
      fullTextSearch: false,
    });
    expect(code.props("keywords")).toEqual([
      { name: "level", label: "level", kind: "Field", insertText: "level" },
    ]);
    expect(await code.props("fieldValueResolver")("level")).toEqual(["level-a", "level-b"]);
    code.vm.$emit("run-query");
    await flushPromises();
    expect(wrapper.emitted("run")).toHaveLength(1);
  });
});
