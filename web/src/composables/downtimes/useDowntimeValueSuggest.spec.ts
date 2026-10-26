// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import downtimes from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";
import type { ConditionValuePair } from "@/components/alerts/conditionOperators";
import { VALUE_SUGGEST_DEBOUNCE_MS, useDowntimeValueSuggest } from "./useDowntimeValueSuggest";

vi.mock("@/services/downtimes", () => ({ default: { values: vi.fn() } }));

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, VALUE_SUGGEST_DEBOUNCE_MS + 50));
  await flushPromises();
};

const mountBox = (typed: string, pairs: ConditionValuePair[] = []) => {
  const value = ref(typed);
  const Box = defineComponent({
    setup() {
      const suggest = useDowntimeValueSuggest(ref("acme"), ref("planned"));
      return suggest(
        () => "host",
        () => value.value,
        () => pairs,
      );
    },
    template: "<div />",
  });
  const wrapper = mount(Box);
  return { wrapper, value, vm: wrapper.vm as unknown as { options: any[]; hint?: string } };
};

const answer = (values: string[], partial = false) =>
  ({
    data: {
      values: values.map((v) => ({ value: v, source: "registry", items: 0 })),
      partial,
    },
  }) as any;

describe("useDowntimeValueSuggest", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(downtimes.values).mockReset();
  });

  it("asks for the typed prefix narrowed by the sibling pairs, in the downtime's folder", async () => {
    vi.mocked(downtimes.values).mockResolvedValue(answer(["node-1", "node-2"]));
    const { vm } = mountBox("NODE", [{ key: "service", value: "payments-api" }]);
    await settle();
    expect(downtimes.values).toHaveBeenCalledWith(
      "acme",
      {
        key: "host",
        prefix: "node",
        condition: {
          type: "group",
          op: "and",
          items: [{ type: "pair", key: "service", operator: "=", value: "payments-api" }],
        },
      },
      "planned",
    );
    expect(vm.options.map((o) => o.value)).toEqual(["node-1", "node-2"]);
  });

  it("waits 250 ms after the last keystroke before asking again", async () => {
    vi.mocked(downtimes.values).mockResolvedValue(answer([]));
    const { value } = mountBox("");
    await settle();
    vi.mocked(downtimes.values).mockClear();
    value.value = "n";
    await new Promise((resolve) => setTimeout(resolve, 100));
    value.value = "no";
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(downtimes.values).not.toHaveBeenCalled();
    await settle();
    expect(downtimes.values).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downtimes.values).mock.calls[0][1].prefix).toBe("no");
  });

  it("says a typed value is not seen only once the answer for it has settled", async () => {
    vi.mocked(downtimes.values).mockResolvedValue(answer([]));
    const { vm, value } = mountBox("node-7");
    expect(vm.hint).toBeUndefined();
    await settle();
    expect(vm.hint).toBe("Not seen in the last hour.");
    vi.mocked(downtimes.values).mockResolvedValue(answer(["node-1"]));
    value.value = "node-1";
    await settle();
    expect(vm.hint).toBeUndefined();
  });

  it("notes a partial answer", async () => {
    vi.mocked(downtimes.values).mockResolvedValue(answer(["node-1"], true));
    const { vm } = mountBox("");
    await settle();
    expect(vm.hint).toBe("Some sources did not answer.");
  });
});
