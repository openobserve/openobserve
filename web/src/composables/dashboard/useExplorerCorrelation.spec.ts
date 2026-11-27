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
import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import { useExplorerCorrelation } from "./useExplorerCorrelation";

const pending: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];
vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({
    findRelatedTelemetry: vi.fn(
      () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    ),
    semanticGroups: ref([]),
    noMatch: ref(false),
    error: ref(null),
  }),
}));
vi.mock("@/composables/useFeatureLock", () => ({
  useLicenseLock: () => ({ locked: ref(false) }),
}));

const answer = (service: string) => ({
  correlationData: {
    service_name: service,
    matched_dimensions: {},
    matched_set_id: "s",
    related_streams: { logs: [], metrics: [], traces: [], profiles: [] },
  },
});

const setup = () => {
  const selected = ref<Record<string, any> | null>({ _timestamp: 1 });
  let api!: ReturnType<typeof useExplorerCorrelation>;
  mount(
    defineComponent({
      setup() {
        api = useExplorerCorrelation({ sourceType: "logs", stream: () => "app", selected });
        return () => h("div");
      },
    }),
    { global: { plugins: [i18n] } },
  );
  return { selected, api };
};

describe("useExplorerCorrelation", () => {
  it("an older event's answer never lands on the next event, nor ends its loading", async () => {
    pending.length = 0;
    const { selected, api } = setup();
    void api.openCorrelation({ _timestamp: 1 });
    selected.value = { _timestamp: 2 };
    await nextTick();
    void api.openCorrelation({ _timestamp: 2 });
    expect(pending).toHaveLength(2);

    pending[0].resolve(answer("old"));
    await flushPromises();
    expect(api.correlationDashboardProps.value).toBeNull();
    expect(api.correlationLoading.value).toBe(true);

    pending[1].resolve(answer("new"));
    await flushPromises();
    expect(api.correlationError.value).toBeNull();
    expect(api.correlationDashboardProps.value?.serviceName).toBe("new");
    expect(api.correlationLoading.value).toBe(false);
  });

  it("an older event's error is dropped too", async () => {
    pending.length = 0;
    const { selected, api } = setup();
    void api.openCorrelation({ _timestamp: 1 });
    selected.value = { _timestamp: 2 };
    await nextTick();
    void api.openCorrelation({ _timestamp: 2 });
    pending[0].reject(new Error("boom"));
    await flushPromises();
    expect(api.correlationError.value).toBeNull();
    expect(api.correlationLoading.value).toBe(true);
  });
});
