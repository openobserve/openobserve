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

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createStore } from "vuex";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

import DbmMetricPanel from "./DbmMetricPanel.vue";

vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: { name: "PanelSchemaRenderer", template: "<div />" },
}));

const EXPLORE = "http://localhost/web/metrics?org_identifier=org1";

const mountPanel = (features: Record<string, string>) =>
  mount(DbmMetricPanel, {
    props: {
      panelKey: "load-cpu",
      title: raw("CPU"),
      schema: { queries: [] },
      startTime: 0,
      endTime: 1,
      exploreUrl: EXPLORE,
    },
    global: {
      plugins: [i18n, createStore({ state: { zoConfig: { features } } })],
      stubs: { PanelSchemaRenderer: true, OSkeleton: true },
    },
  });

describe("DbmMetricPanel explore link", () => {
  it("is a disabled lock with no href when the metrics license is locked", () => {
    const wrapper = mountPanel({ metrics: "locked" });
    const explore = wrapper.find('[data-test="dbm-metric-panel-explore-load-cpu"]');
    expect(explore.element.tagName).toBe("SPAN");
    expect(explore.attributes("aria-disabled")).toBe("true");
    expect(explore.attributes("href")).toBeUndefined();
    expect(wrapper.find('[data-test="dbm-metric-panel-explore-lock-load-cpu"]').exists()).toBe(
      true,
    );
  });

  it("links into the Metrics explorer when the license enables metrics", () => {
    const wrapper = mountPanel({ metrics: "enabled" });
    const explore = wrapper.find('[data-test="dbm-metric-panel-explore-load-cpu"]');
    expect(explore.element.tagName).toBe("A");
    expect(explore.attributes("href")).toBe(EXPLORE);
    expect(wrapper.find('[data-test="dbm-metric-panel-explore-lock-load-cpu"]').exists()).toBe(
      false,
    );
  });
});
