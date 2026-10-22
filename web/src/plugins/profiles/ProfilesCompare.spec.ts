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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import i18n from "@/locales";
import ProfilesCompare, { type CompareState } from "./ProfilesCompare.vue";

const mocks = vi.hoisted(() => ({ tagValues: vi.fn(), diff: vi.fn() }));
vi.mock("@/services/profiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/profiles")>()),
  default: { tagValues: mocks.tagValues, diff: mocks.diff },
}));

const payload = {
  start_time: 1_000_000_000,
  end_time: 1_900_000_000,
  service_name: "storefront-api",
  profile_type: "cpu",
  profile_unit: "nanoseconds",
  filters: [{ key: "service_version", op: "=" as const, value: "v1.5.0" }],
};
const diffResponse = {
  data: {
    unit: "nanoseconds",
    profile_type: "cpu",
    baseline_total: 100,
    comparison_total: 200,
    truncated: false,
    root: { name: "total", total: 200, self: 0, before_total: 100, before_self: 0, children: [] },
    top: [
      {
        name: "encoding/json.Marshal",
        before_self: 1,
        before_total: 5,
        after_self: 2,
        after_total: 60,
      },
      { name: "net/http.serve", before_self: 0, before_total: 90, after_self: 0, after_total: 120 },
    ],
    took: 1,
  },
};

const stubs = {
  OSelect: {
    template:
      '<div :data-test="$attrs[\'data-test\']"><select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select></div>',
    props: ["modelValue", "options", "loading"],
    emits: ["update:modelValue"],
  },
  OButton: { template: "<button><slot /></button>" },
  OTooltip: true,
  CommonFlameGraph: {
    name: "FlameStub",
    props: ["root", "diffBaselineTotal", "diffComparisonTotal", "diffLabels", "summaryLabel"],
    template: "<div />",
  },
  OTable: {
    name: "TableStub",
    props: ["data", "columns"],
    template: "<div />",
  },
};

/** Mounts the view under a host that holds its v-model state, as the page does. */
const mountCompare = (initial: Partial<CompareState> = {}) => {
  const state = ref<CompareState>({
    label: null,
    baseline: null,
    comparison: null,
    display: "flame",
    ...initial,
  });
  const Host = defineComponent({
    components: { ProfilesCompare },
    setup: () => ({
      state,
      payload,
      labels: [
        { label: "deployment_environment", value: "deployment_environment" },
        { label: "service_version", value: "service_version" },
      ],
      valueFormatter: (value: number) => `${value} ns`,
    }),
    template: `<ProfilesCompare v-model:state="state" org-identifier="org" stream="default"
      :payload="payload" :labels="labels" search-query="" unit-label="CPU" :value-formatter="valueFormatter" />`,
  });
  const wrapper = mount(Host, { global: { plugins: [i18n], stubs } });
  return { wrapper, state };
};

describe("ProfilesCompare", () => {
  beforeEach(() => {
    mocks.tagValues.mockReset().mockResolvedValue({
      data: { tag: "service_version", values: ["v1.5.1", "v1.10.0", "v1.4.0", "v1.5.0"], took: 1 },
    });
    mocks.diff.mockReset().mockResolvedValue(diffResponse);
  });

  it("compares the filtered version with the one before it, by version order", async () => {
    const { state } = mountCompare();
    await flushPromises();

    expect(state.value).toMatchObject({
      label: "service_version",
      baseline: "v1.4.0",
      comparison: "v1.5.0",
    });
    // The page filter on the side label is replaced by each side's value.
    expect(mocks.tagValues).toHaveBeenCalledWith(
      "org",
      "default",
      expect.objectContaining({ tag: "service_version", filters: [] }),
    );
    expect(mocks.diff).toHaveBeenLastCalledWith(
      "org",
      "default",
      {
        baseline: expect.objectContaining({
          filters: [{ key: "service_version", op: "=", value: "v1.4.0" }],
        }),
        comparison: expect.objectContaining({
          filters: [{ key: "service_version", op: "=", value: "v1.5.0" }],
        }),
        max_nodes: 4096,
      },
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("draws the diff flame graph against the baseline total", async () => {
    const { wrapper } = mountCompare();
    await flushPromises();

    expect(wrapper.findComponent({ name: "FlameStub" }).props("diffBaselineTotal")).toBe(100);
  });

  it("names each side by its value, not as baseline and comparison", async () => {
    const { wrapper, state } = mountCompare();
    await flushPromises();

    const flame = wrapper.findComponent({ name: "FlameStub" });
    expect(flame.props("diffLabels")).toEqual({ baseline: "v1.4.0", comparison: "v1.5.0" });
    expect(flame.props("summaryLabel")).toBe("v1.5.0");

    state.value.display = "table";
    await flushPromises();
    const headers = (
      wrapper.findComponent({ name: "TableStub" }).props("columns") as { header: string }[]
    ).map((column) => column.header);
    expect(headers).toEqual(["Functions", "v1.4.0", "v1.5.0", "v1.4.0 %", "v1.5.0 %", "Change"]);
  });

  it("draws each side as its own flame graph in Side by Side", async () => {
    mocks.diff.mockResolvedValue({
      data: {
        ...diffResponse.data,
        root: {
          name: "total",
          total: 200,
          self: 0,
          before_total: 100,
          before_self: 0,
          children: [
            { name: "json", total: 120, self: 120, before_total: 0, before_self: 0 },
            { name: "http", total: 80, self: 80, before_total: 100, before_self: 100 },
          ],
        },
      },
    });
    const { wrapper } = mountCompare({ display: "sides" });
    await flushPromises();

    const sides = wrapper.findAllComponents({ name: "FlameStub" });
    expect(sides.map((side) => side.props("summaryLabel"))).toEqual(["v1.4.0", "v1.5.0"]);
    // The first version never ran json, so its graph leaves it out. Each frame keeps both
    // sides' totals, so both graphs colour it by the same change.
    expect(sides[0].props("root")).toEqual({
      name: "total",
      total: 100,
      self: 0,
      before_total: 100,
      after_total: 200,
      children: [
        { name: "http", total: 100, self: 100, before_total: 100, after_total: 80, children: [] },
      ],
    });
    for (const side of sides) {
      expect(side.props()).toMatchObject({
        diffBaselineTotal: 100,
        diffComparisonTotal: 200,
        diffLabels: { baseline: "v1.4.0", comparison: "v1.5.0" },
      });
    }
    expect(sides[1].props("root").children.map((c: { name: string }) => c.name)).toEqual([
      "json",
      "http",
    ]);
    // Both graphs use the diff colours, so the legend stays.
    expect(wrapper.find('[data-test="profiles-compare-legend"]').isVisible()).toBe(true);
  });

  it("lists the change in each function's share in the diff table", async () => {
    const { wrapper } = mountCompare({ display: "table" });
    await flushPromises();
    await nextTick();

    const rows = wrapper.findComponent({ name: "TableStub" }).props("data") as {
      name: string;
      change: number;
    }[];
    expect(rows.map((row) => [row.name, Number(row.change.toFixed(2))])).toEqual([
      ["encoding/json.Marshal", 25],
      ["net/http.serve", -30],
    ]);
  });

  it("swaps the sides", async () => {
    const { wrapper, state } = mountCompare();
    await flushPromises();

    await wrapper.find('[data-test="profiles-compare-swap"]').trigger("click");
    await flushPromises();

    expect(state.value).toMatchObject({ baseline: "v1.5.0", comparison: "v1.4.0" });
  });

  it("asks for another label when the label has one value", async () => {
    mocks.tagValues.mockResolvedValue({
      data: { tag: "service_version", values: ["v1"], took: 1 },
    });
    const { wrapper } = mountCompare();
    await flushPromises();

    expect(wrapper.find('[data-test="profiles-compare-message"]').text()).toContain(
      "fewer than two values",
    );
  });
});
