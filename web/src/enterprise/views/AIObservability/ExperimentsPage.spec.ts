// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import type { ExperimentDetail } from "@/services/llm-experiments.service";
import { makeExperiment, makeExperimentDetail } from "./experimentTestFixtures";

const push = vi.fn();
const replace = vi.fn();
const route = reactive({ query: { selected: "one" } as Record<string, string> });

const experiment = (id: string) => makeExperiment({ id, name: `Experiment ${id}` });

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

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

vi.mock("@/services/llm-experiments.service", () => ({
  default: {
    list: vi.fn(async () => [experiment("one"), experiment("two")]),
    get: vi.fn(async (_orgId: string, id: string) => details.get(id)),
    preview: vi.fn(),
    create: vi.fn(),
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
});

describe("ExperimentsPage navigation", () => {
  it("updates the selected detail when Back/Forward changes the deep link", async () => {
    const wrapper = mount(ExperimentsPage, {
      global: {
        stubs: {
          OPageLayout: { template: `<main><slot name="actions" /><slot /></main>` },
          ExperimentBrowser: true,
          OButton: true,
          OTag: true,
          OInput: true,
          OTextarea: true,
          OSelect: true,
        },
      },
    });
    await flushPromises();
    expect(wrapper.get('[data-test="ai-experiment-detail-preview"]').text()).toContain(
      "Experiment one",
    );

    route.query = { selected: "two" };
    await nextTick();
    await flushPromises();
    expect(wrapper.get('[data-test="ai-experiment-detail-preview"]').text()).toContain(
      "Experiment two",
    );

    route.query = {};
    await nextTick();
    expect(wrapper.find('[data-test="ai-experiment-detail-preview"]').exists()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
