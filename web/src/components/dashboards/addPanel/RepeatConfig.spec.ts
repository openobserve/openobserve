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
import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import RepeatConfig from "@/components/dashboards/addPanel/RepeatConfig.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";

const panelData = reactive<{ data: Record<string, any> }>({ data: { type: "line" } });

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => ({ dashboardPanelData: panelData })),
}));

const variable = (name: string, extra: Record<string, any> = {}) => ({
  name,
  type: "query_values",
  scope: "global",
  multiSelect: true,
  value: ["api", "web", "db", "cache"],
  options: [],
  ...extra,
});

describe("RepeatConfig", () => {
  let wrapper: any;

  beforeEach(() => {
    panelData.data = { type: "line" };
  });

  afterEach(() => wrapper?.unmount());

  const createWrapper = (values: any[]) =>
    mount(RepeatConfig, {
      props: { variablesData: { values } },
      global: { plugins: [i18n, store] },
    });

  it("explains how to enable repeat when no variable qualifies", () => {
    wrapper = createWrapper([
      variable("single", { multiSelect: false }),
      variable("panelOnly", { scope: "panels" }),
    ]);
    expect(wrapper.find('[data-test="dashboard-config-repeat-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Multi-select");
  });

  it("offers only multi-select global and tab variables", () => {
    wrapper = createWrapper([
      variable("host"),
      variable("region", { scope: "tabs", type: "custom" }),
      variable("single", { multiSelect: false }),
    ]);
    const options = wrapper.findComponent(OSelect).props("options");
    expect(options.map((o: any) => o.value)).toEqual(["host", "region"]);
  });

  it("saves the repeat config with defaults when a variable is picked", async () => {
    wrapper = createWrapper([variable("host")]);
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", "host");
    await nextTick();
    expect(panelData.data.repeat).toEqual({ direction: "h", maxPerRow: 4, variable: "host" });
    expect(wrapper.find('[data-test="dashboard-config-repeat-preview"]').text()).toBe(
      "Will create 4 panels: api, web, db, …",
    );
  });

  it("hides max per row for vertical repeats", async () => {
    panelData.data.repeat = { variable: "host", direction: "h", maxPerRow: 4 };
    wrapper = createWrapper([variable("host")]);
    expect(wrapper.find('[data-test="dashboard-config-repeat-max-per-row"]').exists()).toBe(true);
    wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "v");
    await nextTick();
    expect(panelData.data.repeat.direction).toBe("v");
    expect(wrapper.find('[data-test="dashboard-config-repeat-max-per-row"]').exists()).toBe(false);
  });

  it("previews All as the full option list", () => {
    panelData.data.repeat = { variable: "host", direction: "h", maxPerRow: 4 };
    wrapper = createWrapper([
      variable("host", {
        value: [SELECT_ALL_VALUE],
        options: [
          { label: "a", value: "a" },
          { label: "b", value: "b" },
        ],
      }),
    ]);
    expect(wrapper.find('[data-test="dashboard-config-repeat-preview"]').text()).toBe(
      "Will create 2 panels: a, b",
    );
  });

  it("tells the author the value arrives already quoted", () => {
    panelData.data.repeat = { variable: "host", direction: "h", maxPerRow: 4 };
    wrapper = createWrapper([variable("host")]);
    expect(wrapper.find('[data-test="dashboard-config-repeat-quote-hint"]').text()).toBe(
      "Each value is inserted already quoted, so write = $host or IN ($host) without quotes.",
    );
  });

  it("shows the quoting hint before a variable is chosen", () => {
    wrapper = createWrapper([variable("host")]);
    expect(wrapper.find('[data-test="dashboard-config-repeat-quote-hint"]').text()).toContain(
      "without quotes",
    );
  });

  it("counts All as every value even when the editor's options are capped", () => {
    panelData.data.repeat = { variable: "host", direction: "h", maxPerRow: 4 };
    wrapper = createWrapper([variable("host", { value: [SELECT_ALL_VALUE], options: [] })]);
    expect(wrapper.find('[data-test="dashboard-config-repeat-preview"]').text()).toBe(
      "Will create one panel for each value of $host, up to 50.",
    );
  });

  it("describes an empty selection the way the dashboard shows it", () => {
    panelData.data.repeat = { variable: "host", direction: "h", maxPerRow: 4 };
    wrapper = createWrapper([variable("host", { value: [] })]);
    expect(wrapper.find('[data-test="dashboard-config-repeat-preview"]').text()).toContain(
      "No values selected for $host",
    );
  });

  it("recomputes the preview when the variable changes", async () => {
    wrapper = createWrapper([
      variable("module", { value: ["alert"] }),
      variable("status", { value: ["a", "b"] }),
    ]);
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", "module");
    await nextTick();
    expect(wrapper.find('[data-test="dashboard-config-repeat-preview"]').text()).toBe(
      "Will create 1 panel: alert",
    );
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", "status");
    await nextTick();
    expect(wrapper.find('[data-test="dashboard-config-repeat-preview"]').text()).toBe(
      "Will create 2 panels: a, b",
    );
  });

  it("removes the repeat config when the variable is cleared", async () => {
    panelData.data.repeat = { variable: "host", direction: "h", maxPerRow: 4 };
    wrapper = createWrapper([variable("host")]);
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", null);
    await nextTick();
    expect("repeat" in panelData.data).toBe(false);
  });
});
