// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import { clearValueCounts } from "@/composables/alerts/useStreamDiscovery";
import AlertMetricLabels from "./AlertMetricLabels.vue";

type Handlers = { data: (p: unknown, r: unknown) => void; error: () => void; complete: () => void };
const stream = vi.fn();
const getStream = vi.fn();

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...args: unknown[]) => stream(...args),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStream }) }));

const VALUES: Record<string, [string, number][]> = {
  k8s_node_name: [
    ["node-b", 40],
    ["node-a", 120],
  ],
  mode: [["idle", 300]],
};

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
});

describe("AlertMetricLabels", () => {
  const quiet = Array.from({ length: 10 }, (_, i) => `label_${String.fromCharCode(97 + i)}`);

  beforeEach(() => {
    clearValueCounts();
    getStream.mockResolvedValue({
      name: "node_cpu_seconds_total",
      schema: [
        { name: "_timestamp", type: "Int64" },
        { name: "value", type: "Float64" },
        ...quiet.map((name) => ({ name, type: "Utf8" })),
        { name: "mode", type: "Utf8" },
        { name: "k8s_node_name", type: "Utf8" },
      ],
    });
    stream.mockImplementation(
      (req: { type: string; queryReq: { fields: string[] } }, handlers: Handlers) => {
        const content =
          req.type === "search"
            ? { results: { hits: [{ k8s_node_name: 2, mode: 1 }] } }
            : {
                results: {
                  hits: [
                    {
                      values: VALUES[req.queryReq.fields[0]].map(([key, n]) => ({
                        zo_sql_key: key,
                        zo_sql_num: n,
                      })),
                    },
                  ],
                },
              };
        handlers.data({}, { type: "search_response_hits", content });
        handlers.complete();
      },
    );
  });

  it("ranks the metric's labels by how many values they hold, folds the rest, and inserts a grouping or a matcher", async () => {
    wrapper = mount(AlertMetricLabels, {
      attachTo: document.body,
      props: { streamName: "node_cpu_seconds_total" },
      global: {
        plugins: [i18n, createStore({ state: { selectedOrganization: { identifier: "o" } } })],
      },
    });
    await flushPromises();
    const chips = () =>
      wrapper!
        .findAll('[data-test^="add-alert-metric-label-"]')
        .map((chip) => chip.text())
        .filter(Boolean);
    expect(chips().slice(0, 3)).toEqual(["k8s_node_name · 2 values", "mode · 1 value", "label_a"]);
    expect(chips()).toHaveLength(10);
    await wrapper.get('[data-test="add-alert-metric-labels-more"]').trigger("click");
    expect(chips()).toHaveLength(12);

    const chip = wrapper.get('[data-test="add-alert-metric-label-k8s_node_name"]');
    const pick = async (selector: string) => {
      await chip.trigger("click");
      await flushPromises();
      const items = Array.from(document.body.querySelectorAll<HTMLElement>(selector));
      items[0]?.click();
      await flushPromises();
      return items.map((item) => item.textContent?.trim());
    };
    expect(await pick('[data-test="add-alert-metric-label-k8s_node_name-value"]')).toEqual([
      "node-a (120)",
      "node-b (40)",
    ]);
    await pick('[data-test="add-alert-metric-label-k8s_node_name-group"]');
    expect(wrapper.emitted("insert")).toEqual([
      [{ label: "k8s_node_name", value: "node-a" }],
      [{ label: "k8s_node_name" }],
    ]);
  });
});
