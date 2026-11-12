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

vi.mock("vuex", () => ({ useStore: () => ({ state: { timezone: "UTC" } }) }));

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

vi.mock("./LLMPanelCard.vue", () => ({
  default: { name: "LLMPanelCard", template: "<div><slot /></div>" },
}));

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    props: ["data", "emptyMessage"],
    emits: ["row-click"],
    template: `<div><div v-for="row in data" :key="row.tool" :data-test="'row-' + row.tool"
      @click="$emit('row-click', row)"><slot name="cell-rate" :row="row" /></div>
      <span data-test="empty">{{ emptyMessage }}</span></div>`,
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LLMFailingToolsTable from "./LLMFailingToolsTable.vue";
import { LLM_INSIGHTS_PANELS } from "./config/llmInsightsPanels";

const panel = LLM_INSIGHTS_PANELS.find((p) => p.id === "failing-tools")!;

async function mountTable(agentFilter = "") {
  const wrapper = mount(LLMFailingToolsTable, {
    props: { panel, streamName: "llm", startTime: 1, endTime: 2, agentFilter },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => vi.clearAllMocks());

describe("LLMFailingToolsTable", () => {
  it("shows each tool's share of failed calls and opens its failed traces on click", async () => {
    executeQuery.mockResolvedValue([
      { tool: "web_search", failures: 15, calls: 60, traces: 12, last_failed: 1 },
    ]);
    const wrapper = await mountTable("gen_ai_agent_name = 'omp'");

    expect(executeQuery.mock.calls[0][0]).toContain("AND gen_ai_agent_name = 'omp'");
    const row = wrapper.find('[data-test="row-web_search"]');
    expect(row.text()).toBe("25%");
    await row.trigger("click");
    expect(wrapper.emitted("drill")?.[0]).toEqual([
      { panel, series: "web_search", atMicros: null },
    ]);
  });

  it("says it could not load instead of reporting no failures", async () => {
    executeQuery.mockRejectedValue(new Error("boom"));
    const wrapper = await mountTable();
    expect(wrapper.find('[data-test="empty"]').text()).toBe(
      "aiObservability.panels.failingTools.loadFailed",
    );
  });
});
