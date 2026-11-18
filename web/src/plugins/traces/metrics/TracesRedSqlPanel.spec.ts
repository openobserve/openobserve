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
import { mount } from "@vue/test-utils";
import i18n from "@/locales";

vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: {
    name: "PanelSchemaRenderer",
    template: '<div data-test="panel-schema-renderer-stub"></div>',
    props: ["panelSchema", "selectedTimeObj", "variablesData", "forceLoad", "searchResponse"],
  },
}));

import TracesRedSqlPanel from "./TracesRedSqlPanel.vue";

const mountPanel = (hits: Record<string, unknown>[], caption?: string[]) =>
  mount(TracesRedSqlPanel, {
    props: {
      caption,
      name: "rate",
      panelSchema: { title: "Rate", queries: [{ query: "SELECT [WHERE_CLAUSE]" }], config: {} },
      status: "ready",
      hits,
      selectedTimeObj: { start_time: new Date(0), end_time: new Date(1) },
      runKey: 1,
    },
    global: {
      plugins: [i18n],
      stubs: { OTooltip: { template: "<div><slot name='content' /></div>" } },
    },
  });

describe("TracesRedSqlPanel", () => {
  it("draws the fetched rows", () => {
    const wrapper = mountPanel([{ time_bucket: "2026-01-01T00:00:00", max_rate: 1 }]);
    const renderer = wrapper.findComponent({ name: "PanelSchemaRenderer" });
    expect(renderer.props("searchResponse")).toEqual({
      hits: [{ time_bucket: "2026-01-01T00:00:00", max_rate: 1 }],
    });
  });

  it("never mounts the renderer without rows, so it cannot run the panel's placeholder query", () => {
    const wrapper = mountPanel([]);
    expect(wrapper.findComponent({ name: "PanelSchemaRenderer" }).exists()).toBe(false);
  });

  it("says there is no data when a ready panel has no buckets, instead of a blank body", () => {
    const wrapper = mountPanel([]);
    expect(wrapper.find('[data-test="traces-red-sql-panel-rate-no-data"]').text()).toBe("No data");
    expect(
      mountPanel([{ time_bucket: "t", max_rate: 1 }])
        .find('[data-test="traces-red-sql-panel-rate-no-data"]')
        .exists(),
    ).toBe(false);
  });

  it("shows the caption behind an info icon after the title, and no icon without one", () => {
    const wrapper = mountPanel([], ["Charts: a", "Scope: b"]);
    const title = wrapper.find("[data-test='traces-red-sql-panel-rate']").element
      .firstElementChild!;
    expect(title.querySelector("[data-test='traces-red-caption-info-rate']")).not.toBeNull();
    const lines = wrapper.findAll("[data-test='traces-red-caption-rate'] span");
    expect(lines.map((l) => l.text())).toEqual(["Charts: a", "Scope: b"]);
    expect(mountPanel([]).find("[data-test='traces-red-caption-info-rate']").exists()).toBe(false);
  });
});
