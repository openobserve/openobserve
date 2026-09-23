// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { ref } from "vue";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStreams: vi.fn().mockResolvedValue(undefined),
  traces: { name: "traces", list: [{ name: "default" }], schema: false },
}));

vi.mock("vuex", () => ({
  useStore: () => ({ state: { streams: { traces: mocks.traces }, timezone: "UTC" } }),
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: mocks.getStreams }),
}));
vi.mock("@/types/i18n", () => ({
  useI18nTyped: () => ({ t: (key: string) => key }),
  raw: (value: string) => value,
}));
vi.mock("@/utils/timezone", () => ({
  timestampToTimezoneDate: (ms: number, zone: string) => `formatted:${ms}:${zone}`,
}));
vi.mock("./usePromptAnalytics", () => ({
  usePromptAnalytics: () => ({
    kpis: ref({ calls: 0, errorRate: null, p50LatencyMs: null, p95LatencyMs: null, cost: null }),
    breakdown: ref([]),
    recent: ref([]),
    evidence: ref([]),
    loading: ref(false),
    error: ref(null),
    loadTraffic: vi.fn().mockResolvedValue(undefined),
    loadExperimentEvidence: vi.fn().mockResolvedValue(undefined),
  }),
}));

import PromptTrafficPanel from "./PromptTrafficPanel.vue";

describe("PromptTrafficPanel", () => {
  it("offers and selects trace streams from the Vuex stream-list payload", async () => {
    const wrapper = shallowMount(PromptTrafficPanel, {
      props: {
        orgId: "team1",
        prompt: { name: "o2-ai-prompt-e2e" } as any,
        version: { version: 3 } as any,
      },
      global: {
        stubs: {
          OSelect: {
            props: ["options", "modelValue"],
            template:
              '<div :data-options="options.map((option) => option.value).join(\',\')" :data-model="modelValue" />',
          },
          OTable: {
            name: "OTable",
            props: ["columns"],
            template: '<div class="table" />',
          },
        },
      },
    });
    await flushPromises();

    expect(mocks.getStreams).toHaveBeenCalledWith("traces", false, false);
    const selector = wrapper.find('[data-test="prompt-traffic-stream"]');
    expect(selector.attributes("data-options")).toContain("default");
    expect(selector.attributes("data-model")).toBe("default");

    const tables = wrapper.findAllComponents({ name: "OTable" });
    const breakdownColumns = tables[0].props("columns") as any[];
    expect(
      breakdownColumns
        .find((column) => column.id === "p50_latency_ms")
        .accessorFn({ p50_latency_ms: 2725.659 }),
    ).toBe("2726");
    expect(
      breakdownColumns
        .find((column) => column.id === "cost")
        .accessorFn({ cost: 0.0062300920000000004 }),
    ).toBe("$0.006230");
    const recentColumns = tables[1].props("columns") as any[];
    const timeColumn = recentColumns.find((column) => column.id === "timestamp");
    expect(timeColumn.accessorFn({ timestamp: 1790160215949866 })).toBe(
      "formatted:1790160215949.866:UTC",
    );
    expect(
      recentColumns.find((column) => column.id === "latencyMs").accessorFn({ latencyMs: 2725.659 }),
    ).toBe("2726");
    expect(
      recentColumns
        .find((column) => column.id === "cost")
        .accessorFn({ cost: 0.0062300920000000004 }),
    ).toBe("$0.006230");
  });
});
