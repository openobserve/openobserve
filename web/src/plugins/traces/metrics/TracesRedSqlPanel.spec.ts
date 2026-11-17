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

const mountPanel = (hits: Record<string, unknown>[]) =>
  mount(TracesRedSqlPanel, {
    props: {
      name: "rate",
      panelSchema: { title: "Rate", queries: [{ query: "SELECT [WHERE_CLAUSE]" }], config: {} },
      status: "ready",
      hits,
      selectedTimeObj: { start_time: new Date(0), end_time: new Date(1) },
      runKey: 1,
    },
    global: { plugins: [i18n] },
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
});
