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

  it("labels a pending score column from its pinned score-config summary", async () => {
    const experiment = makeExperiment({ id: "exp-1", name: "run one", datasetId: "ds-1" });
    const detail = makeExperimentDetail(experiment, {
      results: {
        executions: [],
        scores: [],
        scoreSummaries: [
          {
            scorerId: "scorer-9",
            scorerVersion: 1,
            name: "Internal scorer name",
            scoreConfigId: "config-9",
            scoreConfigName: "answer_relevance",
            scoreConfigVersion: 3,
            sampleCount: 0,
            errorCount: 0,
            pendingCount: 1,
            noReferenceCount: 0,
            noTraceCount: 0,
            skippedCount: 0,
            value: null,
          },
        ],
      },
    });
    detail.preview.pinnedScorers = [{ id: "scorer-9", version: 1 }];
    get.mockResolvedValue(detail);

    const wrapper = mount(ExperimentDetailPage);
    await flushPromises();

    expect(wrapper.text()).toContain("answer_relevance");
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

  it("shows typed score values and a semantic status dot for every slot state", async () => {
    const experiment = makeExperiment({
      id: "exp-1",
      name: "typed scores",
      datasetId: "ds-1",
      scorers: [
        { id: "numeric", version: 1 },
        { id: "boolean", version: 1 },
        { id: "category", version: 1 },
      ],
    });
    const taskStatuses = ["pending", "in_progress", "ok", "skipped", "error"] as const;
    const detail = makeExperimentDetail(experiment, {
      results: {
        executions: [],
        scores: [
          { name: "accuracy", scorer_id: "numeric" },
          { name: "safe", scorer_id: "boolean" },
          { name: "quality", scorer_id: "category" },
        ],
        slots: taskStatuses.map((taskStatus, index) => ({
          rowId: `row-${index}`,
          logicalId: `case-${index}`,
          trialIndex: 0,
          input: `input-${index}`,
          expectedOutput: null,
          taskStatus,
          execution: null,
          scores:
            taskStatus === "ok"
              ? [
                  {
                    scorerId: "numeric",
                    scorerVersion: 1,
                    status: "success" as const,
                    score: { value_numeric: 0.718418 },
                  },
                  {
                    scorerId: "boolean",
                    scorerVersion: 1,
                    status: "success" as const,
                    score: { value_boolean: false },
                  },
                  {
                    scorerId: "category",
                    scorerVersion: 1,
                    status: "success" as const,
                    score: { value_categorical: "safe" },
                  },
                ]
              : [],
        })),
        pagination: { page: 1, pageSize: 50, totalSlots: 5, hasMore: false },
      },
    });
    get.mockResolvedValue(detail);

    const wrapper = mount(ExperimentDetailPage, {
      global: {
        stubs: {
          OTable: {
            props: ["data", "columns"],
            template: `<table><tbody><tr v-for="row in data" :key="row.slotKey">
              <td v-for="column in columns" :key="column.id">
                <slot :name="'cell-' + column.id" :row="row">{{ row[column.accessorKey] }}</slot>
              </td>
            </tr></tbody></table>`,
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("0.718");
    expect(wrapper.text()).toContain("false");
    expect(wrapper.text()).toContain("safe");
    expect(
      taskStatuses.map((_, index) =>
        wrapper.get(`[data-test="ai-experiment-slot-status-row-${index}:0"]`).classes(),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["bg-status-neutral-text"]),
        expect.arrayContaining(["bg-status-info-text", "motion-safe:animate-pulse"]),
        expect.arrayContaining(["bg-status-success-text"]),
        expect.arrayContaining(["bg-status-warning-text"]),
        expect.arrayContaining(["bg-status-error-text"]),
      ]),
    );
  });
});
