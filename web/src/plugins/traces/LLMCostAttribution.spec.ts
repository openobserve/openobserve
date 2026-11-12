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

const executeQuery = vi.fn();

vi.mock("./composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({ executeQuery, cancelAll: vi.fn() }),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn(async () => ({
      schema: [{ name: "gen_ai_response_model" }, { name: "user_id" }, { name: "tenant_id" }],
    })),
  }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "o" } } }),
}));

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("./LLMPanelCard.vue", () => ({
  default: {
    name: "LLMPanelCard",
    props: ["subtitle"],
    template: `<div><span data-test="subtitle">{{ subtitle }}</span><slot name="actions" /><slot /></div>`,
  },
}));

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    props: ["data"],
    template: `<div><div v-for="row in data" :key="row.key" :data-test="'row-' + row.key">
      <slot name="cell-value" :row="row" /></div></div>`,
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LLMCostAttribution from "./LLMCostAttribution.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";

const hit = (v: string, cost: number) => ({ v, cost, tokens: cost * 100, traces: 1 });
// The rows query gets the rows; the whole-window totals query gets their sums.
function respond(rows: ReturnType<typeof hit>[]) {
  const sum = (k: "cost" | "tokens" | "traces") => rows.reduce((s, r) => s + r[k], 0);
  executeQuery.mockImplementation(async (sql: string) =>
    sql.includes("AS n_values")
      ? [
          {
            n_values: rows.filter((r) => r.v).length,
            cost: sum("cost"),
            tokens: sum("tokens"),
            traces: sum("traces"),
          },
        ]
      : rows,
  );
}
const segment = (w: any, key: string) => w.find(`[data-test="o-segmented-bar-segment-${key}"]`);
const dot = (w: any, key: string) => w.find(`[data-test="row-${key}"] [aria-hidden="true"]`);

async function mountPanel() {
  const wrapper = mount(LLMCostAttribution, {
    props: { stream: "llm", scope: "", startTime: 1, endTime: 2 },
    global: {
      stubs: {
        OButton: { template: `<button v-bind="$attrs"><slot /></button>`, inheritAttrs: false },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LLMCostAttribution share bar", () => {
  it("draws a segment per value sized by share, leaving Unattributed as the empty track", async () => {
    respond([hit("acme", 6), hit("globex", 3), hit("", 1)]);
    const wrapper = await mountPanel();

    const acme = segment(wrapper, "v:acme");
    expect(acme.attributes("style")).toContain("width: 60%");
    expect(acme.attributes("style")).toMatch(/var\(--color-chart-series-\d+\)/);
    expect(segment(wrapper, "none").exists()).toBe(false);
    // The table is the legend: each row's dot is its segment's colour.
    expect(dot(wrapper, "v:acme").element.style.backgroundColor).toBe(
      acme.element.style.backgroundColor,
    );
    expect(dot(wrapper, "none").classes()).toContain("bg-border-default");
  });

  it("keeps a value's colour when the other values change", async () => {
    respond([hit("acme", 6), hit("globex", 3)]);
    const wrapper = await mountPanel();
    const before = segment(wrapper, "v:acme").element.style.backgroundColor;

    respond([hit("initech", 9), hit("acme", 1)]);
    await wrapper.setProps({ scope: "x = 1" });
    await flushPromises();

    expect(segment(wrapper, "v:acme").element.style.backgroundColor).toBe(before);
  });
});

describe("LLMCostAttribution dimension switch", () => {
  it("drops the previous dimension's late rows when the new one has no column", async () => {
    respond([hit("acme", 6)]);
    const wrapper = await mountPanel();
    const late = Promise.withResolvers<unknown[]>();
    executeQuery.mockReturnValue(late.promise);
    await wrapper.setProps({ scope: "x = 1" });
    // feature_name is not in the schema: the panel shows the setup hint and must stay empty.
    wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "feature");
    await flushPromises();
    late.resolve([hit("globex", 9)]);
    await flushPromises();

    expect(wrapper.find('[data-test="llm-cost-attribution-unset"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="subtitle"]').text()).toBe("");
  });
});

describe("LLMCostAttribution dimensions", () => {
  // Every LLM call has a model, so the panel opens on a view that has data.
  it("lists Model first and opens on it", async () => {
    respond([hit("gpt-4o", 6)]);
    const wrapper = await mountPanel();
    const tabs = wrapper.findAll('[data-test^="llm-cost-attribution-tab-"]');
    expect(tabs.map((tab) => tab.attributes("data-test"))).toEqual([
      "llm-cost-attribution-tab-model",
      "llm-cost-attribution-tab-user",
      "llm-cost-attribution-tab-tenant",
      "llm-cost-attribution-tab-feature",
    ]);
    expect(executeQuery.mock.calls[0][0]).toContain("gen_ai_response_model AS v");
  });

  it("queries the user dimension per trace once its tab is picked", async () => {
    respond([hit("u_1", 6)]);
    const wrapper = await mountPanel();
    wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "user");
    await flushPromises();
    expect(executeQuery.mock.calls.at(-1)![0]).toContain("MAX(user_id)");
  });

  it("explains the view and links to the mapping when no span in the window sets the attribute", async () => {
    respond([hit("", 4)]);
    const wrapper = await mountPanel();
    wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "user");
    await flushPromises();
    expect(wrapper.find('[data-test="llm-cost-attribution-about"]').text()).toBe(
      "llmAttribution.about.user",
    );
    expect(wrapper.find('[data-test="llm-cost-attribution-unset"]').text()).toContain(
      "llmAttribution.noneInWindow",
    );
    await wrapper.find('[data-test="llm-cost-attribution-map-link"]').trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "genAiAgentMapping",
      query: { org_identifier: "o" },
      hash: "#cost-attribution",
    });
  });

  // Values past the fetched rows still count toward the total, shares and "N more".
  it("takes the total and the more row from the whole-window totals", async () => {
    executeQuery.mockImplementation(async (sql: string) =>
      sql.includes("AS n_values")
        ? [{ n_values: 60, cost: 20, tokens: 2000, traces: 70 }]
        : [hit("acme", 5), hit("globex", 3), hit("", 2)],
    );
    const wrapper = await mountPanel();
    expect(segment(wrapper, "v:acme").attributes("style")).toContain("width: 25%");
    expect(wrapper.find('[data-test="row-more"]').exists()).toBe(true);
  });

  it("shows the table, not the explanation, when some spend has a value", async () => {
    respond([hit("u_1", 6), hit("", 4)]);
    const wrapper = await mountPanel();
    expect(wrapper.find('[data-test="llm-cost-attribution-unset"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="row-v:u_1"]').exists()).toBe(true);
  });
});
