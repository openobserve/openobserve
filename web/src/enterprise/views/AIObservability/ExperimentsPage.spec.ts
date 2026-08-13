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

const { cancelExperiment, retryExperiment } = vi.hoisted(() => ({
  cancelExperiment: vi.fn(),
  retryExperiment: vi.fn(),
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

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

vi.mock("@/services/llm-experiments.service", () => ({
  default: {
    list: vi.fn(async () => [experiment("one"), experiment("two")]),
    get: vi.fn(async (_orgId: string, id: string) => details.get(id)),
    preview: vi.fn(),
    create: vi.fn(),
    cancel: cancelExperiment,
    retry: retryExperiment,
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

  it("shows and invokes only the lifecycle action allowed by the current state", async () => {
    const running = makeExperiment({ id: "one", name: "Experiment one", status: "running" });
    details.set("one", makeExperimentDetail(running));
    cancelExperiment.mockResolvedValue({
      ...running,
      status: "cancelled",
      statusReason: "user_cancelled",
      lifecycleVersion: 1,
      completedAt: 1_800_000_000_100,
    });
    const wrapper = mount(ExperimentsPage, {
      global: {
        stubs: {
          OPageLayout: { template: `<main><slot name="actions" /><slot /></main>` },
          ExperimentBrowser: true,
          OButton: {
            template: `<button v-bind="$attrs"><slot /></button>`,
          },
          OTag: true,
          OInput: true,
          OTextarea: true,
          OSelect: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="ai-experiment-cancel"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-experiment-retry"]').exists()).toBe(false);
    await wrapper.get('[data-test="ai-experiment-cancel"]').trigger("click");
    await flushPromises();
    expect(cancelExperiment).toHaveBeenCalledWith("acme", "one");
    expect(cancelExperiment).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="ai-experiment-cancel"]').exists()).toBe(false);

    const failed = makeExperiment({
      ...running,
      status: "failed",
      statusReason: "deadline_exceeded",
      lifecycleVersion: 2,
    });
    details.set("one", makeExperimentDetail(failed));
    retryExperiment.mockResolvedValue({
      ...failed,
      status: "running",
      statusReason: null,
      lifecycleVersion: 3,
      retryCount: 1,
      completedAt: null,
    });
    wrapper.unmount();
    route.query = { selected: "one" };
    const retryWrapper = mount(ExperimentsPage, {
      global: {
        stubs: {
          OPageLayout: { template: `<main><slot name="actions" /><slot /></main>` },
          ExperimentBrowser: true,
          OButton: {
            template: `<button v-bind="$attrs"><slot /></button>`,
          },
          OTag: true,
          OInput: true,
          OTextarea: true,
          OSelect: true,
        },
      },
    });
    await flushPromises();

    expect(retryWrapper.find('[data-test="ai-experiment-retry"]').exists()).toBe(true);
    expect(retryWrapper.find('[data-test="ai-experiment-cancel"]').exists()).toBe(false);
    await retryWrapper.get('[data-test="ai-experiment-retry"]').trigger("click");
    await flushPromises();
    expect(retryExperiment).toHaveBeenCalledWith("acme", "one");
    expect(retryExperiment).toHaveBeenCalledTimes(1);
    expect(retryWrapper.find('[data-test="ai-experiment-retry"]').exists()).toBe(false);
  });
});
