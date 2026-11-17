// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import downtimes from "@/services/downtimes";
import type { DimensionCondition } from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";
import { useDowntimeValueLabels } from "./useDowntimeValueLabels";
import stage8 from "@/test/unit/fixtures/serviceVersions/stage8.json";

vi.mock("@/services/downtimes", () => ({ default: { values: vi.fn() } }));

const eq = (key: string, value: string): DimensionCondition => ({
  type: "pair",
  key,
  operator: "=",
  value,
});

const mountLabels = (condition: DimensionCondition | null) => {
  const Host = defineComponent({
    setup() {
      return { label: useDowntimeValueLabels(ref("acme"), ref("planned"), () => condition) };
    },
    template: "<div />",
  });
  return mount(Host).vm as unknown as {
    label: (key: string, value: string) => string | undefined;
  };
};

describe("useDowntimeValueLabels", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(downtimes.values).mockReset();
    vi.mocked(downtimes.values).mockResolvedValue({ data: stage8.downtime_values } as never);
  });

  it("reads each service pair's display name from the values endpoint, in the downtime's folder", async () => {
    const vm = mountLabels({
      type: "group",
      op: "and",
      items: [eq("service", "checkoutservice"), eq("env", "prod")],
    });
    await flushPromises();
    expect(downtimes.values).toHaveBeenCalledTimes(1);
    expect(downtimes.values).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ key: "service", prefix: "checkoutservice" }),
      "planned",
    );
    expect(vm.label("service", "checkoutservice")).toBe("CheckoutService");
    expect(vm.label("env", "prod")).toBeUndefined();
  });

  it("drops a label that only repeats the value, so the pair keeps its key=value wording", async () => {
    vi.mocked(downtimes.values).mockResolvedValue({
      data: { values: [{ value: "svc-a-1", label: "svc-a-1" }] },
    } as never);
    const vm = mountLabels(eq("service", "svc-a-1"));
    await flushPromises();
    expect(vm.label("service", "svc-a-1")).toBeUndefined();
  });

  it("asks nothing for a condition without a service pair", async () => {
    const vm = mountLabels(eq("env", "prod"));
    await flushPromises();
    expect(downtimes.values).not.toHaveBeenCalled();
    expect(vm.label("service", "checkoutservice")).toBeUndefined();
  });
});
