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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { ref } from "vue";
import { createStore } from "vuex";
import i18n from "@/locales";

const findRelatedTelemetry = vi.fn().mockResolvedValue(null);
vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({
    findRelatedTelemetry,
    semanticGroups: ref([]),
    noMatch: ref(false),
    error: ref(null),
  }),
}));
vi.mock("@/services/search", () => ({
  default: { search: vi.fn().mockResolvedValue({ data: { hits: [], total: 0 } }) },
}));
vi.mock("@/services/patterns", () => ({ default: {} }));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import DashboardLogDrawer from "@/components/dashboards/DashboardLogDrawer.vue";

const mountDrawer = (features: Record<string, string>, streamType?: string) =>
  shallowMount(DashboardLogDrawer, {
    props: { stream: "app", field: "level", value: "error", startTime: 1, endTime: 2, streamType },
    global: {
      renderStubDefaultSlot: true,
      stubs: { OButton: false },
      plugins: [
        i18n,
        createStore({
          state: { selectedOrganization: { identifier: "org" }, zoConfig: { features } },
        }),
      ],
    },
  });

const openInLogsDisabled = (wrapper: ReturnType<typeof mountDrawer>) =>
  wrapper.find('[data-test="log-explorer-open-in-logs"]').attributes("aria-disabled") === "true";

describe("DashboardLogDrawer related telemetry", () => {
  beforeEach(() => findRelatedTelemetry.mockClear());

  it("makes no correlation call while correlation is license-locked", async () => {
    const wrapper = mountDrawer({ correlation: "locked" });
    await flushPromises();
    await (wrapper.vm as any).$.setupState.openCorrelationFromLog({ _timestamp: 1 });
    expect(findRelatedTelemetry).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "logs"],
    ["metrics", "metrics"],
    ["traces", "traces"],
  ])("stream type %s with %s locked: Open in Logs is disabled with a lock", (streamType, key) => {
    const wrapper = mountDrawer({ [key]: "locked" }, streamType);
    expect(openInLogsDisabled(wrapper)).toBe(true);
    expect(wrapper.find('[data-test="log-explorer-open-in-logs-lock"]').exists()).toBe(true);
  });

  it("Open in Logs stays live while another signal is locked", () => {
    const wrapper = mountDrawer({ traces: "locked" });
    expect(openInLogsDisabled(wrapper)).toBe(false);
    expect(wrapper.find('[data-test="log-explorer-open-in-logs-lock"]').exists()).toBe(false);
  });

  it("looks up related telemetry while correlation is enabled", async () => {
    const wrapper = mountDrawer({ correlation: "enabled" });
    await flushPromises();
    await (wrapper.vm as any).$.setupState.openCorrelationFromLog({ _timestamp: 1 });
    expect(findRelatedTelemetry).toHaveBeenCalledTimes(1);
  });
});
