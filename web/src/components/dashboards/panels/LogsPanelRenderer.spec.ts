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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// JSDOM has no layout, so the real virtualizer renders no rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed: vueComputed, unref } = await import("vue");
  return {
    useVirtualizer: (options: any) =>
      vueComputed(() => {
        const count = unref(options).count;
        return {
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: index,
              start: index * 28,
              size: 28,
              end: (index + 1) * 28,
              lane: 0,
            })),
          getTotalSize: () => count * 28,
          scrollToIndex: () => {},
          measureElement: () => {},
        };
      }),
  };
});

import LogsPanelRenderer from "@/components/dashboards/panels/LogsPanelRenderer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import JsonPreview from "@/plugins/logs/JsonPreview.vue";
import { severityIndicatorColor } from "@/utils/logs/statusParser";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { convertLogsPanelData } from "@/utils/dashboard/convertLogsPanelData";

const schema = (config: Record<string, unknown> = {}) => ({ queries: [{ config: {} }], config });
const rows = [
  {
    _timestamp: 1793057797456039,
    level: "info",
    message: "GET /api/search/update 26ms",
    payload: '{"user":"u138","cart_items":5}',
  },
  {
    _timestamp: 1793057797456037,
    level: "error",
    message: "upstream inventory failed: timeout after 103ms",
    payload: '{"user":"u278","cart_items":5}',
  },
];

let wrapper: VueWrapper<any> | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

const mountPanel = async (config: Record<string, unknown> = {}) => {
  const data = convertLogsPanelData(schema(config), [rows], {
    state: { timezone: "UTC", zoConfig: {} },
  });
  wrapper = mount(LogsPanelRenderer, {
    props: { data, config },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
};

describe("LogsPanelRenderer", () => {
  const table = () => wrapper!.findComponent(OTable);
  const expandFirst = async () => {
    table().vm.$emit("update:expandedIds", ["0"]);
    await flushPromises();
  };

  it("renders through the logs table with a timestamp and message column, newest first", async () => {
    await mountPanel();
    const columns = table().props("columns") as any[];
    expect(columns.map((col) => col.id)).toEqual(["_timestamp", "message"]);
    expect(String(columns[0].header)).toContain("UTC");
    expect(columns[0].size).toBe(236);
    const data = table().props("data") as any[];
    expect(data.map((row) => row.level)).toEqual(["info", "error"]);
    expect(columns[0].accessorFn(data[0])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(table().props("pinnedFirstColumn")).toBe("_timestamp");
  });

  it("colours each row's severity rail from the level field, like the logs table", async () => {
    await mountPanel();
    const data = table().props("data") as any[];
    const color = table().props("getRowStatusColor") as (row: any) => string;
    const error = { level: "error", source: "field", field: "level", notFetched: false } as const;
    expect(color(data[1])).toBe(severityIndicatorColor(error));
    expect(color(data[1])).not.toBe(color(data[0]));
  });

  it("expands a row into the logs page's read-only JSON preview", async () => {
    await mountPanel();
    await expandFirst();
    const preview = wrapper!.findComponent(JsonPreview);
    expect(preview.exists()).toBe(true);
    expect(preview.props("mode")).toBe("expanded");
    expect(preview.props("value")).toMatchObject({ level: "info" });
    for (const flag of [
      "hideViewRelated",
      "hideViewTrace",
      "hideSearchTermActions",
      "hideFieldOptions",
      "hideAddFieldToTable",
    ]) {
      expect(preview.props(flag), flag).toBe(true);
    }
  });

  it("opens and closes a row's JSON on a row click", async () => {
    await mountPanel();
    const first = (table().props("data") as any[])[0];
    table().vm.$emit("row-click", first, new MouseEvent("click"));
    await flushPromises();
    expect(table().props("expandedIds")).toEqual(["0"]);
    table().vm.$emit("row-click", first, new MouseEvent("click"));
    await flushPromises();
    expect(table().props("expandedIds")).toEqual([]);
  });

  it("shows the row as stored, on one line, when pretty JSON is off", async () => {
    await mountPanel({ logs_prettify_json: false });
    await expandFirst();
    expect(wrapper!.findComponent(JsonPreview).exists()).toBe(false);
    expect(wrapper!.find('[data-test="dashboard-logs-panel-json"]').text()).toContain(
      '"payload":"{\\"user\\":\\"u138\\"',
    );
  });

  it("hides the timestamp column and wraps cells when configured", async () => {
    await mountPanel({ logs_show_time: false, logs_wrap: true });
    expect((table().props("columns") as any[]).map((col) => col.id)).toEqual(["message"]);
    expect(table().props("wrap")).toBe(true);
    expect(table().props("pinnedFirstColumn")).toBeUndefined();
  });

  it("falls back to the logs table's source column when the rows have no message field", async () => {
    const data = convertLogsPanelData(schema(), [[{ _timestamp: 1793057797456039, code: 7 }]], {
      state: { timezone: "UTC", zoConfig: {} },
    });
    wrapper = mount(LogsPanelRenderer, {
      props: { data, config: {} },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();
    const columns = table().props("columns") as any[];
    expect(columns.map((col) => col.id)).toEqual(["_timestamp", "source"]);
    expect(columns[1].accessorFn({ code: 7 })).toBe('{"code":7}');
  });
});
