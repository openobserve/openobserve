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
    template: `<div><div v-for="(row, i) in data" :key="i" :data-test="'row-' + i"
      @click="$emit('row-click', row)">
      <span data-test="message"><slot name="cell-message" :value="row.message" /></span>
      <span data-test="where"><slot name="cell-operation" :row="row" /></span></div>
      <span data-test="empty">{{ emptyMessage }}</span></div>`,
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LLMTopErrorsTable from "./LLMTopErrorsTable.vue";
import { LLM_INSIGHTS_PANELS } from "./config/llmInsightsPanels";

const panel = LLM_INSIGHTS_PANELS.find((p) => p.id === "top-errors")!;

async function mountTable(agentFilter = "") {
  const wrapper = mount(LLMTopErrorsTable, {
    props: { panel, streamName: "llm", startTime: 1, endTime: 2, agentFilter },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => vi.clearAllMocks());

describe("LLMTopErrorsTable", () => {
  it("shows each message with where it came from and opens its traces on click", async () => {
    executeQuery.mockResolvedValue([
      { message: "429 from the provider", operation: "chat gpt-4o", operations: 3, traces: 31 },
    ]);
    const wrapper = await mountTable("gen_ai_agent_name = 'omp'");

    expect(executeQuery.mock.calls[0][0]).toContain("AND gen_ai_agent_name = 'omp'");
    expect(wrapper.find('[data-test="message"]').text()).toBe("429 from the provider");
    expect(wrapper.find('[data-test="where"]').text()).toBe("chat gpt-4o +2");
    await wrapper.find('[data-test="row-0"]').trigger("click");
    expect(wrapper.emitted("drill")?.[0]).toEqual([
      { panel, series: "429 from the provider", atMicros: null },
    ]);
  });

  it("names a row with no message instead of leaving it blank", async () => {
    executeQuery.mockResolvedValue([
      { message: "", operation: "execute_tool grep", operations: 1, traces: 2 },
    ]);
    const wrapper = await mountTable();
    expect(wrapper.find('[data-test="message"]').text()).toBe(
      "aiObservability.panels.topErrors.noMessage",
    );
    expect(wrapper.find('[data-test="where"]').text()).toBe("execute_tool grep");
  });

  it("says it could not load instead of reporting no errors", async () => {
    executeQuery.mockRejectedValue(new Error("boom"));
    const wrapper = await mountTable();
    expect(wrapper.find('[data-test="empty"]').text()).toBe(
      "aiObservability.panels.topErrors.loadFailed",
    );
  });
});
