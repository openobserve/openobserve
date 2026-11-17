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
import store from "@/test/unit/helpers/store";
import type { PathFlow } from "@/utils/rum/productAnalyticsModel";

vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  default: { name: "ChartRenderer", props: ["data"], template: "<div />" },
}));

import PathsFlow from "./PathsFlow.vue";

const node = (name: string, depth: number, value: number) => ({
  name,
  depth,
  key: name.slice(name.indexOf(":") + 1),
  kind: "p" as const,
  value,
  pct: value / 40,
});

const flow: PathFlow = {
  nodes: [
    node("0:p:/", 0, 40),
    node("1:p:/category/home", 1, 3),
    node("1:p:/category/office", 1, 1),
    node("1:p:/category/shoes", 1, 1),
  ],
  links: [
    { source: "0:p:/", target: "1:p:/category/home", value: 3, pathKeys: [] },
    { source: "0:p:/", target: "1:p:/category/office", value: 1, pathKeys: [] },
    { source: "0:p:/", target: "1:p:/category/shoes", value: 1, pathKeys: [] },
  ],
  kept: new Map(),
  anchorSessions: 40,
  truncated: false,
};

describe("PathsFlow", () => {
  it("hides the label of a small node that would overlap its neighbour's", () => {
    const wrapper = mount(PathsFlow, {
      props: { flow, seriesId: "paths", selected: null, direction: "next" },
      global: { plugins: [i18n, store] },
    });

    const series = (wrapper.vm as any).chartData.options.series[0];
    expect(series.type).toBe("sankey");
    expect(series.labelLayout).toEqual({ hideOverlap: true });
  });
});
