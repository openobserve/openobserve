// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import {
  makeExperimentDetail,
  makeExperiment,
} from "@/enterprise/views/AIObservability/experimentTestFixtures";

const route = reactive({ params: { id: "exp-1" }, query: {} }) as any;
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme" } } }),
}));
const get = vi.fn();
vi.mock("@/services/llm-experiments.service", () => ({
  default: {
    get: (...a: any[]) => get(...a),
    getRow: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    clone: vi.fn(),
  },
}));
vi.mock("@/services/llm-datasets.service", () => ({
  default: {
    list: vi.fn().mockResolvedValue([{ id: "ds-1", name: "Test Dataset" }]),
    get: vi.fn().mockResolvedValue({ id: "ds-1", name: "Test Dataset" }),
  },
}));

import ExperimentDetailPage from "@/enterprise/views/AIObservability/ExperimentDetailPage.vue";

describe("ExperimentDetailPage", () => {
  it("renders the experiment without runtime errors", async () => {
    const experiment = makeExperiment({ id: "exp-1", name: "run one", datasetId: "ds-1" });
    get.mockResolvedValue(makeExperimentDetail(experiment, {}));
    const errors: unknown[] = [];
    const wrapper = mount(ExperimentDetailPage, {
      global: { config: { errorHandler: (e) => errors.push(e) } },
    });
    await flushPromises();
    expect(errors).toEqual([]);
    expect(get).toHaveBeenCalled();
    expect(wrapper.text()).toContain("run one");
  });

  // The meta line contains an "@", which vue-i18n parses as a linked message
  // unless escaped — an unescaped one throws at render and blanks the page.
  it("renders the dataset meta line without a message-compilation error", async () => {
    const experiment = makeExperiment({ id: "exp-1", name: "run one", datasetId: "ds-1" });
    get.mockResolvedValue(makeExperimentDetail(experiment, {}));
    const errors: unknown[] = [];
    const wrapper = mount(ExperimentDetailPage, {
      global: { config: { errorHandler: (e) => errors.push(e) } },
    });
    await flushPromises();
    expect(errors).toEqual([]);
    // The name ships on the experiment itself now, so the page makes no second
    // request to resolve it.
    expect(wrapper.get('[data-test="ai-experiment-detail-meta"]').text()).toContain("Dataset A");
  });

  // pinnedScorers / score_summaries are id-only; the display name exists only on
  // the score records, so the column header has to come from there.
  it("labels the score column with the scorer name, not its id", async () => {
    const experiment = makeExperiment({ id: "exp-1", name: "run one", datasetId: "ds-1" });
    const detail = makeExperimentDetail(experiment, {
      results: {
        executions: [],
        scores: [{ name: "test-scorer", scorer_id: "scorer-9", value_numeric: 0.237 }],
      },
    });
    detail.preview.pinnedScorers = [{ id: "scorer-9", version: 1 }];
    get.mockResolvedValue(detail);

    const wrapper = mount(ExperimentDetailPage);
    await flushPromises();

    expect(wrapper.text()).toContain("test-scorer");
    expect(wrapper.text()).not.toContain("scorer-9");
  });

  it("reads as prose: humanized task type and singular counts", async () => {
    const experiment = makeExperiment({ id: "exp-1", name: "run one", datasetId: "ds-1" });
    experiment.task = {
      type: "inline_prompt",
      messages: [],
      providerId: "prov-1",
      model: "gpt-4o",
    };
    experiment.scorers = [{ id: "scorer-9", version: 1 }];
    get.mockResolvedValue(makeExperimentDetail(experiment, {}));

    const wrapper = mount(ExperimentDetailPage);
    await flushPromises();

    const meta = wrapper.get('[data-test="ai-experiment-detail-meta"]').text();
    expect(meta).toContain("Inline Prompt");
    expect(meta).toContain("gpt-4o");
    expect(meta).toContain("1 scorer");
    expect(meta).not.toContain("inline_prompt");
    expect(meta).toContain("1 trial");
    expect(meta).not.toContain("1 trials");
    expect(meta).not.toContain("1 scorers");
  });
});
