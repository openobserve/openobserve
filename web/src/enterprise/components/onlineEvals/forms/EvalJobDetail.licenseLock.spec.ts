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

import { ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "vuex";
import i18n from "@/locales";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import EvalJobDetail from "./EvalJobDetail.vue";

const { push } = vi.hoisted(() => ({ push: vi.fn(() => Promise.resolve()) }));

vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const run = { id: "span-1", evaluatorTraceId: "eval-1", timestampMs: 1000, status: "ok" };

vi.mock("../composables/useEvalJobRuns", () => ({
  useEvalJobRuns: () => ({
    kpis: ref({ totalRuns: 0, successRate: null, avgLatencyMs: null, failureCount: null }),
    runs: ref([run]),
    failures: ref([]),
    isLoadingKpis: ref(false),
    isLoading: ref(false),
    refresh: vi.fn(),
  }),
}));

const OTableStub = {
  name: "OTable",
  props: ["data"],
  emits: ["rowClick"],
  template: `<div><div v-for="row in data" :key="row.id" class="o-row" @click="$emit('rowClick', row)"><slot name="cell-timestampMs" :row="row" /></div></div>`,
};

const mountRuns = async (features: Record<string, string>) => {
  const store = createStore({
    state: { selectedOrganization: { identifier: "org1" }, zoConfig: { features } },
  });
  const wrapper = mount(EvalJobDetail, {
    props: { row: { id: "job-1", scorers: [] } as any, scorers: [], scoreConfigs: [] },
    global: {
      plugins: [i18n, withQueryClient(), store],
      stubs: {
        ODrawer: { template: "<div><slot /></div>" },
        OTable: OTableStub,
        DateTimePickerDashboard: true,
        KpiCardsSkeleton: true,
        OTabs: true,
        OSelect: true,
      },
    },
  });
  (wrapper.vm as any).$.setupState.activeTab = "runs";
  await flushPromises();
  return wrapper;
};

// OTable keys the row pointer cursor on whether a row-click listener is bound.
const rowListener = (wrapper: Awaited<ReturnType<typeof mountRuns>>) =>
  wrapper.findComponent({ name: "OTable" }).vm.$.vnode.props?.onRowClick;

describe("EvalJobDetail run rows and the traces license", () => {
  beforeEach(() => push.mockClear());

  it("drops the row affordance, shows the lock and opens nothing while traces are locked", async () => {
    const wrapper = await mountRuns({ traces: "locked" });

    expect(rowListener(wrapper)).toBeUndefined();
    expect(wrapper.find('[data-test="eval-job-detail-run-lock"]').exists()).toBe(true);
    await wrapper.find(".o-row").trigger("click");
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps rows clickable and opens the evaluator trace when traces are enabled", async () => {
    const wrapper = await mountRuns({ traces: "enabled" });

    expect(rowListener(wrapper)).toBeTypeOf("function");
    expect(wrapper.find('[data-test="eval-job-detail-run-lock"]').exists()).toBe(false);
    await wrapper.find(".o-row").trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "traceDetails",
        query: expect.objectContaining({ trace_id: "eval-1" }),
      }),
    );
  });
});
