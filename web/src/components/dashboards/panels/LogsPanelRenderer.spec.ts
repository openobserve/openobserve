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
  it("renders one line per row with time, level tag and message, newest first", async () => {
    const view = await mountPanel();
    const lines = view.findAll('[data-test^="dashboard-logs-panel-row-"]');
    expect(lines).toHaveLength(2);
    expect(lines[0].get('[data-test="dashboard-logs-panel-time"]').text()).toBe(
      "2026-10-26 23:36:37.456",
    );
    expect(lines[0].get('[data-test="dashboard-logs-panel-level"]').text()).toBe("Info");
    expect(lines[1].get('[data-test="dashboard-logs-panel-level"]').text()).toBe("Error");
    expect(lines[1].get('[data-test="dashboard-logs-panel-message"]').text()).toContain(
      "upstream inventory failed",
    );
  });

  it("expands a row on click into its prettified JSON, with JSON-string columns parsed", async () => {
    const view = await mountPanel();
    expect(view.find('[data-test="dashboard-logs-panel-json"]').exists()).toBe(false);
    await view.get('[data-test="dashboard-logs-panel-row-0"] button').trigger("click");
    await flushPromises();
    const json = view.get('[data-test="dashboard-logs-panel-json"]').text();
    expect(json).toContain('"cart_items": 5');
    expect(json).not.toContain('\\"user\\"');
  });

  it("shows the row as stored when prettify is off", async () => {
    const view = await mountPanel({ logs_prettify_json: false });
    await view.get('[data-test="dashboard-logs-panel-row-0"] button').trigger("click");
    await flushPromises();
    expect(view.get('[data-test="dashboard-logs-panel-json"]').text()).toContain(
      '"payload":"{\\"user\\":\\"u138\\",\\"cart_items\\":5}"',
    );
  });

  it("hides the time and wraps the message when configured", async () => {
    const view = await mountPanel({ logs_show_time: false, logs_wrap: true });
    expect(view.find('[data-test="dashboard-logs-panel-time"]').exists()).toBe(false);
    expect(view.get('[data-test="dashboard-logs-panel-message"]').classes()).toContain(
      "whitespace-pre-wrap",
    );
  });

  it("truncates the message on one line by default", async () => {
    const view = await mountPanel();
    expect(view.get('[data-test="dashboard-logs-panel-message"]').classes()).not.toContain(
      "whitespace-pre-wrap",
    );
  });
});
