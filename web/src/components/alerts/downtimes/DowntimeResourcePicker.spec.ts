// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import downtimes from "@/services/downtimes";
import serviceStreams from "@/services/service_streams";
import { queryClient } from "@/composables/query/queryClient";
import type { DimensionCondition } from "@/services/downtimes";
import DowntimeResourcePicker from "./DowntimeResourcePicker.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

vi.mock("@/services/downtimes", () => ({ default: { values: vi.fn(), resources: vi.fn() } }));

vi.mock("@/services/service_streams", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return {
    ...actual,
    default: {
      ...actual.default,
      getSemanticGroups: vi.fn(),
      getDimensionAnalytics: vi.fn(),
    },
  };
});

const group = (id: string) => ({ id, display: id, fields: [id] });

const CONDITION: DimensionCondition = {
  type: "pair",
  key: "service",
  operator: "=",
  value: "payments-api",
};

const mountPicker = async () => {
  const wrapper = mount(DowntimeResourcePicker, {
    props: { condition: CONDITION, folder: "planned" },
    global: { plugins: [store] },
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
};

describe("DowntimeResourcePicker", () => {
  beforeEach(() => {
    queryClient.clear();
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "acme",
    };
    vi.mocked(downtimes.values).mockReset();
    vi.mocked(downtimes.resources).mockReset();
    vi.mocked(serviceStreams.getDimensionAnalytics).mockReset();
    vi.mocked(downtimes.values).mockResolvedValue({
      data: {
        values: [
          { value: "node-1", source: "inventory", items: 1, last_seen: 1791500000000000 },
          { value: "node-2", source: "registry", items: 0 },
        ],
        partial: false,
      },
    } as any);
  });

  it("refines by host by default and lists its values with their item counts", async () => {
    vi.mocked(serviceStreams.getSemanticGroups).mockResolvedValue({
      data: [group("aws-ecs-cluster"), group("service"), group("host")],
    } as any);
    const wrapper = await mountPicker();
    expect(downtimes.values).toHaveBeenCalledWith(
      "acme",
      {
        key: "host",
        prefix: "",
        condition: {
          type: "group",
          op: "and",
          items: [{ type: "pair", key: "service", operator: "=", value: "payments-api" }],
        },
      },
      "planned",
    );
    expect(serviceStreams.getDimensionAnalytics).not.toHaveBeenCalled();
    const table = wrapper.get('[data-test="downtime-resource-picker-table"]');
    expect(table.text()).toContain("node-1");
    expect(table.text()).toContain("node-2");
    expect(table.text()).toContain("Items");
    expect(downtimes.resources).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="downtime-resource-picker-load"]').exists()).toBe(true);
  });

  it("falls back to the first priority dimension when the org has no host group", async () => {
    vi.mocked(serviceStreams.getSemanticGroups).mockResolvedValue({
      data: [group("aws-ecs-cluster"), group("service"), group("k8s-pod")],
    } as any);
    vi.mocked(serviceStreams.getDimensionAnalytics).mockResolvedValue({
      data: { recommended_priority_dimensions: ["unknown", "k8s-pod", "service"] },
    } as any);
    await mountPicker();
    const keys = vi.mocked(downtimes.values).mock.calls.map((call) => call[1].key);
    expect(keys[keys.length - 1]).toBe("k8s-pod");
  });

  it("keeps Load resources for the full list with streams", async () => {
    vi.mocked(serviceStreams.getSemanticGroups).mockResolvedValue({
      data: [group("service"), group("host")],
    } as any);
    vi.mocked(downtimes.resources).mockResolvedValue({
      data: {
        dimension: "host",
        values: [{ value: "node-9", last_seen: 1, streams: ["logs/app_logs"] }],
        total: 1,
        source: "search",
      },
    } as any);
    const wrapper = await mountPicker();
    await wrapper.get('[data-test="downtime-resource-picker-load"]').trigger("click");
    await flushPromises();
    expect(downtimes.resources).toHaveBeenCalledWith(
      "acme",
      { condition: CONDITION, refine_by: "host" },
      "planned",
    );
    const table = wrapper.get('[data-test="downtime-resource-picker-table"]');
    expect(table.text()).toContain("node-9");
    expect(table.text()).toContain("logs/app_logs");
  });
  it("never offers host rows under service while the service values are still loading", async () => {
    vi.mocked(serviceStreams.getSemanticGroups).mockResolvedValue({
      data: [group("service"), group("host")],
    } as any);
    const wrapper = await mountPicker();
    expect(wrapper.get('[data-test="downtime-resource-picker-table"]').text()).toContain("node-1");
    let answerService: (value: unknown) => void = () => {};
    vi.mocked(downtimes.values).mockImplementation(
      () => new Promise((resolve) => (answerService = resolve)) as any,
    );
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", "service");
    await flushPromises();
    expect(wrapper.find('[data-test="downtime-resource-picker-table"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="downtime-resource-picker-apply"]').exists()).toBe(false);
    answerService({
      data: { values: [{ value: "payments-api", source: "inventory", items: 3 }], partial: false },
    });
    await flushPromises();
    const table = wrapper.get('[data-test="downtime-resource-picker-table"]');
    expect(table.text()).toContain("payments-api");
    expect(table.text()).not.toContain("node-1");
  });
});
