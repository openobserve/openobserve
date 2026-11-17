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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, h, ref } from "vue";
import { createStore } from "vuex";

import { queryClient } from "@/composables/query/queryClient";
import anomalyDetection from "@/services/anomaly_detection";
import organizations from "@/services/organizations";
import { organizationKeys } from "@/services/organizations.querykeys";

import { refreshOrgResources, useOrgHasNoResources } from "./useOrgResources";

const EMPTY_SUMMARY = {
  streams: { num_streams: 3 },
  pipelines: { num_realtime: 0, num_scheduled: 0 },
  alerts: { num_realtime: 0, num_scheduled: 0 },
  total_functions: 0,
  total_dashboards: 0,
};

const summaryIs = (data: unknown) =>
  vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({ data } as never);

function setup(anomalyEnabled = false, wanted: () => boolean = () => true) {
  queryClient.clear();
  const store = createStore({
    state: { zoConfig: { anomaly_detection_enabled: anomalyEnabled, features: {} } },
  });
  let result!: ReturnType<typeof useOrgHasNoResources>;
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useOrgHasNoResources("org1", wanted);
        return () => h("div");
      },
    }),
    { global: { plugins: [store, [VueQueryPlugin, { queryClient }]] } },
  );
  return { result, wrapper };
}

describe("useOrgHasNoResources", () => {
  const defaults = queryClient.getDefaultOptions();
  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.setDefaultOptions(defaults);
    queryClient.clear();
  });

  it("is false while the summary loads, and true once it counts nothing", async () => {
    const get = summaryIs(EMPTY_SUMMARY);
    const list = vi.spyOn(anomalyDetection, "list");
    const { result, wrapper } = setup();
    expect(result.noResources.value).toBe(false);
    await flushPromises();
    expect(get).toHaveBeenCalledWith("org1");
    expect(list).not.toHaveBeenCalled();
    expect(result.noResources.value).toBe(true);
    wrapper.unmount();
  });

  for (const [what, summary] of [
    ["one alert", { ...EMPTY_SUMMARY, alerts: { num_realtime: 0, num_scheduled: 1 } }],
    ["one pipeline", { ...EMPTY_SUMMARY, pipelines: { num_realtime: 1, num_scheduled: 0 } }],
    ["one dashboard", { ...EMPTY_SUMMARY, total_dashboards: 1 }],
    ["one function", { ...EMPTY_SUMMARY, total_functions: 1 }],
    ["a summary missing its alert counts", { ...EMPTY_SUMMARY, alerts: {} }],
  ] as const) {
    it(`is false for ${what}`, async () => {
      summaryIs(summary);
      const { result, wrapper } = setup();
      await flushPromises();
      expect(result.noResources.value).toBe(false);
      wrapper.unmount();
    });
  }

  it("is false when the summary fails, never reading the failure as empty", async () => {
    queryClient.setDefaultOptions({ queries: { retry: false } });
    vi.spyOn(organizations, "get_organization_summary").mockRejectedValue(new Error("500"));
    const { result, wrapper } = setup();
    await flushPromises();
    expect(result.noResources.value).toBe(false);
    wrapper.unmount();
  });

  it("keeps the last good answer when a later refetch fails", async () => {
    queryClient.setDefaultOptions({ queries: { retry: false } });
    const get = summaryIs(EMPTY_SUMMARY);
    const { result, wrapper } = setup();
    await flushPromises();
    expect(result.noResources.value).toBe(true);
    get.mockRejectedValue(new Error("502"));
    await refreshOrgResources("org1");
    await flushPromises();
    expect(queryClient.getQueryState(organizationKeys.summary("org1"))?.status).toBe("error");
    expect(result.noResources.value).toBe(true);
    wrapper.unmount();
  });

  it("asks nothing until the org is known to hold data", async () => {
    const get = summaryIs(EMPTY_SUMMARY);
    const list = vi.spyOn(anomalyDetection, "list").mockResolvedValue({ data: [] } as never);
    const wanted = ref(false);
    const { result, wrapper } = setup(true, () => wanted.value);
    await flushPromises();
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(result.noResources.value).toBe(false);
    wanted.value = true;
    await flushPromises();
    expect(get).toHaveBeenCalledWith("org1");
    expect(result.noResources.value).toBe(true);
    wrapper.unmount();
  });

  it("counts anomaly configs where anomaly detection is on", async () => {
    summaryIs(EMPTY_SUMMARY);
    vi.spyOn(anomalyDetection, "list").mockResolvedValue({ data: [{ id: "a1" }] } as never);
    const { result, wrapper } = setup(true);
    await flushPromises();
    expect(result.noResources.value).toBe(false);
    wrapper.unmount();
  });

  it("is true where anomaly detection is on and lists no config", async () => {
    summaryIs(EMPTY_SUMMARY);
    vi.spyOn(anomalyDetection, "list").mockResolvedValue({ data: [] } as never);
    const { result, wrapper } = setup(true);
    await flushPromises();
    expect(result.noResources.value).toBe(true);
    wrapper.unmount();
  });

  it("is false when the anomaly config list fails", async () => {
    queryClient.setDefaultOptions({ queries: { retry: false } });
    summaryIs(EMPTY_SUMMARY);
    vi.spyOn(anomalyDetection, "list").mockRejectedValue(new Error("500"));
    const { result, wrapper } = setup(true);
    await flushPromises();
    expect(result.noResources.value).toBe(false);
    wrapper.unmount();
  });

  it("marks the cached summary stale when asked to refresh", async () => {
    queryClient.setQueryData(organizationKeys.summary("org1"), EMPTY_SUMMARY);
    await refreshOrgResources("org1");
    expect(queryClient.getQueryState(organizationKeys.summary("org1"))?.isInvalidated).toBe(true);
  });
});
