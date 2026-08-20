// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import type { ExperimentDetail } from "@/services/llm-experiments.service";
import { makeExperiment, makeExperimentDetail } from "./experimentTestFixtures";

const push = vi.fn();
const replace = vi.fn();
const route = reactive({ query: { selected: "one" } as Record<string, string> });

const experiment = (id: string) => makeExperiment({ id, name: `Experiment ${id}` });

const { cancelExperiment, retryExperiment, cloneExperiment, compareExperiments, getExperimentRow } =
  vi.hoisted(() => ({
    cancelExperiment: vi.fn(),
    retryExperiment: vi.fn(),
    cloneExperiment: vi.fn(),
    compareExperiments: vi.fn(),
    getExperimentRow: vi.fn(),
  }));

const details = new Map<string, ExperimentDetail>(
  ["one", "two"].map((id) => {
    const row = experiment(id);
    return [id, makeExperimentDetail(row)];
  }),
);

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ push, replace }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme" } } }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const template =
        key === "aiObservability.experiments.scoreEvidence"
          ? "{scorer} · v{version}: {samples} samples, {noReference} no reference, {noTrace} no trace"
          : key;

      return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
        params?.[name] === undefined ? placeholder : String(params[name]),
      );
    },
  }),
}));

vi.mock("@/services/llm-experiments.service", () => ({
  default: {
    list: vi.fn(async () => [experiment("one"), experiment("two")]),
    get: vi.fn(async (_orgId: string, id: string) => details.get(id)),
    preview: vi.fn(),
    create: vi.fn(),
    cancel: cancelExperiment,
    retry: retryExperiment,
    clone: cloneExperiment,
    compare: compareExperiments,
    getRow: getExperimentRow,
  },
}));

vi.mock("@/services/llm-datasets.service", () => ({ default: { list: vi.fn(async () => []) } }));
vi.mock("@/services/online-evals.service", () => ({
  default: { scorers: { list: vi.fn(async () => []) } },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import ExperimentsPage from "./ExperimentsPage.vue";

beforeEach(() => {
  route.query = { selected: "one" };
  push.mockReset();
  replace.mockReset();
  cancelExperiment.mockReset();
  retryExperiment.mockReset();
  cloneExperiment.mockReset();
  compareExperiments.mockReset();
  getExperimentRow.mockReset();
});

describe("ExperimentsPage empty state", () => {
  it("renders the no-experiments preset and creates from it", async () => {
    const service = (await import("@/services/llm-experiments.service")).default;
    (service.list as any).mockResolvedValueOnce([]);
    route.query = {};

    const wrapper = mount(ExperimentsPage, {
      global: {
        stubs: {
          OPageLayout: { template: `<main><slot name="actions" /><slot /></main>` },
          ExperimentBrowser: true,
          OEmptyState: {
            props: ["preset"],
            template: `<div data-test="ai-experiments-empty" :data-preset="preset"
              @click="$emit('action')"></div>`,
          },
        },
      },
    });
    await flushPromises();

    const empty = wrapper.find('[data-test="ai-experiments-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.attributes("data-preset")).toBe("no-experiments");

    await empty.trigger("click");
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "aiExperimentCreate" }));
  });
});
