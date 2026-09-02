// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import {
  makeExperimentDetail,
  makeExperiment,
} from "@/enterprise/views/AIObservability/experimentTestFixtures";

const route = reactive({ params: { id: "exp-1" }, query: {} }) as any;
const push = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
}));
vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme" } } }),
}));
const get = vi.fn();
const getRow = vi.fn();
const listRows = vi.fn();
const clone = vi.fn();
const toast = vi.fn();
vi.mock("@/services/llm-experiments.service", () => ({
  default: {
    get: (...a: any[]) => get(...a),
    getRow: (...a: any[]) => getRow(...a),
    listRows: (...a: any[]) => listRows(...a),
    cancel: vi.fn(),
    retry: vi.fn(),
    clone: (...a: any[]) => clone(...a),
  },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => toast(...a) }));
vi.mock("@/services/llm-datasets.service", () => ({
  default: {
    list: vi.fn().mockResolvedValue([{ id: "ds-1", name: "Test Dataset" }]),
    get: vi.fn().mockResolvedValue({ id: "ds-1", name: "Test Dataset" }),
  },
}));

import ExperimentDetailPage from "@/enterprise/views/AIObservability/ExperimentDetailPage.vue";

beforeEach(() => {
  getRow.mockReset();
  getRow.mockResolvedValue(undefined);
  listRows.mockReset();
  listRows.mockResolvedValue({
    rows: [],
    pagination: { page: 1, pageSize: 100, totalRows: 0, hasMore: false },
  });
});

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

  // A raw "10449" costs the reader the magnitude and overflows the tile, so the
  // p50 card switches unit once the value passes a second.
  it("renders a p50 latency over a second in seconds", async () => {
    const detail = makeExperimentDetail(makeExperiment({ id: "exp-1" }), {
      results: {
        executions: [],
        scores: [],
        aggregateSummary: {
          p50LatencyMs: 10_449,
          totalCost: 0,
          incomplete: false,
          incompleteTaskSlots: 0,
          incompleteScoreDimensions: 0,
          errorTaskSlots: 0,
        },
      },
    });
    get.mockResolvedValue(detail);

    const wrapper = mount(ExperimentDetailPage);
    await flushPromises();

    const card = wrapper.get('[data-test="ai-experiment-detail-p50"]');
    expect(card.text()).toContain("10.4");
    expect(card.text()).toContain("s");
    expect(card.text()).not.toContain("10449");
  });

  it("keeps a sub-second p50 latency in milliseconds", async () => {
    const detail = makeExperimentDetail(makeExperiment({ id: "exp-1" }), {
      results: {
        executions: [],
        scores: [],
        aggregateSummary: {
          p50LatencyMs: 840,
          totalCost: 0,
          incomplete: false,
          incompleteTaskSlots: 0,
          incompleteScoreDimensions: 0,
          errorTaskSlots: 0,
        },
      },
    });
    get.mockResolvedValue(detail);

    const wrapper = mount(ExperimentDetailPage);
    await flushPromises();

    const card = wrapper.get('[data-test="ai-experiment-detail-p50"]');
    expect(card.text()).toContain("840");
    expect(card.text()).toContain("ms");
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

  it("shows the scoring status distribution in the run summary", async () => {
    const experiment = makeExperiment({
      id: "exp-1",
      name: "run one",
      datasetId: "ds-1",
      scorers: [{ id: "scorer-9", version: 1 }],
    });
    const detail = makeExperimentDetail(experiment, {
      results: {
        executions: [],
        scores: [],
        scoringProgress: { completed: 8, total: 29, skipped: 0 },
        scoreSummaries: [
          {
            scorerId: "scorer-9",
            scorerVersion: 1,
            name: "answer_relevance",
            scoreConfigId: "config-9",
            scoreConfigName: "answer_relevance",
            scoreConfigVersion: 3,
            sampleCount: 0,
            errorCount: 8,
            pendingCount: 21,
            noReferenceCount: 0,
            noTraceCount: 0,
            skippedCount: 0,
            value: null,
          },
        ],
      },
    });
    get.mockResolvedValue(detail);

    const wrapper = mount(ExperimentDetailPage);
    await flushPromises();

    const scoring = wrapper.get('[data-test="ai-experiment-detail-scoring"]');
    expect(scoring.text()).toContain("8/29");
    expect(scoring.text()).toContain("0 successful · 8 failed · 21 pending · 0 skipped");
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

  it("shows typed score values and a labelled status chip for every slot state", async () => {
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
    const slotStatuses = ["pending", "running", "completed", "skipped", "task_failed"] as const;
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
          status: slotStatuses[index],
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
    listRows.mockResolvedValue({
      rows: taskStatuses.map((_, index) => ({
        rowIndex: index,
        rowId: `row-${index}`,
        logicalId: `case-${index}`,
        input: `input-${index}`,
        expectedOutput: null,
        trialCount: 1,
        status: slotStatuses[index],
        output: null,
        p50LatencyMs: null,
        dispersion: null,
        scoreSummaries:
          index === 2
            ? [
                {
                  scorerId: "numeric",
                  scorerVersion: 1,
                  value: { kind: "numeric", mean: 0.718418 },
                },
                {
                  scorerId: "boolean",
                  scorerVersion: 1,
                  value: { kind: "boolean", trueCount: 0, falseCount: 1 },
                },
                {
                  scorerId: "category",
                  scorerVersion: 1,
                  value: { kind: "categorical", counts: { safe: 1 } },
                },
              ]
            : [],
      })),
      pagination: { page: 1, pageSize: 100, totalRows: 5, hasMore: false },
    });

    const wrapper = mount(ExperimentDetailPage, {
      global: {
        stubs: {
          OTable: {
            props: ["data", "columns", "getRowStyle", "rowClass"],
            template: `<table><slot name="toolbar-trailing" /><tbody><tr v-for="row in data" :key="row.rowKey"
                :data-rail="getRowStyle ? 'yes' : ''">
              <td v-for="column in columns" :key="column.id">
                <slot :name="'cell-' + column.id" :row="row">{{ row[column.accessorKey] }}</slot>
              </td>
            </tr></tbody></table>`,
          },
          OTag: {
            props: ["label", "variant"],
            template: '<span v-bind="$attrs" :data-variant="variant">{{ label }}</span>',
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("0.718");
    expect(wrapper.text()).toContain("false");
    expect(wrapper.text()).toContain("safe");
    // Text labels keep row status accessible without relying on color.
    const chipText = taskStatuses.map((_, index) =>
      wrapper.get(`[data-test="ai-experiment-row-status-row-${index}"]`).text(),
    );
    expect(chipText.every((label) => label.length > 0)).toBe(true);
    expect(new Set(chipText).size).toBe(taskStatuses.length);
    expect(chipText).toContain("Task Failed");

    // No row rail: the chip is the only status device on the row.
    expect(wrapper.findAll("tbody tr").every((row) => !row.attributes("data-rail"))).toBe(true);
  });

  it("asks for the largest row page and paginates on the client", async () => {
    get.mockResolvedValue(makeExperimentDetail(makeExperiment({ id: "exp-1" })));
    const seen: any[] = [];
    const wrapper = mount(ExperimentDetailPage, {
      global: {
        stubs: {
          OTable: {
            props: ["pagination", "data"],
            mounted() {
              seen.push({ pagination: this.pagination, rows: this.data.length });
            },
            template: `<table />`,
          },
        },
      },
    });
    await flushPromises();

    expect(get).toHaveBeenCalledWith(
      "acme",
      "exp-1",
      expect.objectContaining({ resultPage: 1, resultPageSize: 1 }),
    );
    expect(listRows).toHaveBeenCalledWith(
      "acme",
      "exp-1",
      expect.objectContaining({ page: 1, pageSize: 100, sort: "dataset" }),
    );
    expect(seen[0].pagination).toBe("client");
    wrapper.unmount();
  });

  it("walks every result-row page so late dataset cases are visible", async () => {
    const experiment = makeExperiment({ id: "exp-1" });
    const row = (index: number, status: string) => ({
      rowIndex: index,
      rowId: `row-${index}`,
      logicalId: `case-${index}`,
      input: `q${index}`,
      expectedOutput: null,
      trialCount: 1,
      status,
      output: null,
      scoreSummaries: [],
      p50LatencyMs: null,
      dispersion: null,
    });
    get.mockResolvedValue(makeExperimentDetail(experiment));
    listRows.mockImplementation((_org: string, _id: string, options: any) =>
      Promise.resolve(
        options.page === 1
          ? {
              rows: Array.from({ length: 100 }, (_, index) => row(index, "completed")),
              pagination: { page: 1, pageSize: 100, totalRows: 101, hasMore: true },
            }
          : {
              rows: [row(100, "task_failed")],
              pagination: { page: 2, pageSize: 100, totalRows: 101, hasMore: false },
            },
      ),
    );
    const wrapper = mount(ExperimentDetailPage, {
      global: {
        stubs: {
          OTable: {
            props: ["data"],
            template: `<table :data-rows="data.length" />`,
          },
        },
      },
    });
    await flushPromises();

    expect(listRows).toHaveBeenCalledWith(
      "acme",
      "exp-1",
      expect.objectContaining({ page: 2, pageSize: 100 }),
    );
    expect(wrapper.get('[data-test="ai-experiment-detail-table"]').attributes("data-rows")).toBe(
      "101",
    );
    wrapper.unmount();
  });

  // "Incomplete" can be zero on a failed run — errors are terminal — so the
  // retry affordance keys off the error count instead.
  it("offers retry when the run holds errored slots", async () => {
    const experiment = makeExperiment({ id: "exp-1", status: "failed" });
    const detail = makeExperimentDetail(experiment, {
      results: {
        executions: [],
        scores: [],
        aggregateSummary: {
          p50LatencyMs: null,
          totalCost: 0,
          incomplete: false,
          incompleteTaskSlots: 0,
          incompleteScoreDimensions: 0,
          errorTaskSlots: 4,
        },
      },
    });
    get.mockResolvedValue(detail);

    const wrapper = mount(ExperimentDetailPage);
    await flushPromises();

    expect(wrapper.find('[data-test="ai-experiment-detail-retry"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("filters the loaded dataset rows by search text and aggregate status", async () => {
    const experiment = makeExperiment({ id: "exp-1" });
    get.mockResolvedValue(makeExperimentDetail(experiment));
    listRows.mockResolvedValue({
      rows: [
        {
          rowIndex: 0,
          rowId: "r0",
          logicalId: "c0",
          input: "alpha question",
          expectedOutput: null,
          trialCount: 2,
          status: "completed",
          output: null,
          scoreSummaries: [],
          p50LatencyMs: 10,
          dispersion: null,
        },
        {
          rowIndex: 1,
          rowId: "r1",
          logicalId: "c1",
          input: "beta question",
          expectedOutput: null,
          trialCount: 2,
          status: "task_failed",
          output: null,
          scoreSummaries: [],
          p50LatencyMs: 20,
          dispersion: null,
        },
      ],
      pagination: { page: 1, pageSize: 100, totalRows: 2, hasMore: false },
    });

    let rows: any[] = [];
    const wrapper = mount(ExperimentDetailPage, {
      global: {
        stubs: {
          OTable: {
            props: ["data"],
            watch: {
              data: {
                handler(v: any[]) {
                  rows = v;
                },
                immediate: true,
              },
            },
            template: `<table />`,
          },
        },
      },
    });
    await flushPromises();
    expect(rows).toHaveLength(2);

    (wrapper.vm as any).rowSearch = "alpha";
    await flushPromises();
    expect(rows.map((r) => r.input)).toEqual(["alpha question"]);

    (wrapper.vm as any).rowSearch = "";
    (wrapper.vm as any).statusFilter = "task_failed";
    await flushPromises();
    expect(rows.map((r) => r.status)).toEqual(["task_failed"]);
  });

  it("renders one dataset row with aggregate scores and opens all of its trials", async () => {
    const experiment = makeExperiment({
      id: "exp-1",
      trialCount: 3,
      scorers: [{ id: "judge", version: 1 }],
    });
    get.mockResolvedValue(
      makeExperimentDetail(experiment, {
        results: {
          executions: [],
          scores: [],
          scoreSummaries: [
            {
              scorerId: "judge",
              scorerVersion: 1,
              name: "answer_quality",
              scoreConfigId: "quality",
              scoreConfigName: "answer_quality",
              scoreConfigVersion: 2,
              sampleCount: 3,
              errorCount: 0,
              pendingCount: 0,
              noReferenceCount: 0,
              noTraceCount: 0,
              skippedCount: 0,
              value: { kind: "numeric", mean: 0.75 },
            },
          ],
        },
      }),
    );
    listRows.mockResolvedValue({
      rows: [
        {
          rowIndex: 0,
          rowId: "row-1",
          logicalId: "case-1",
          input: "question",
          expectedOutput: null,
          trialCount: 3,
          status: "completed",
          output: null,
          scoreSummaries: [
            {
              scorerId: "judge",
              scorerVersion: 1,
              value: { kind: "numeric", mean: 0.75 },
            },
          ],
          p50LatencyMs: 840,
          dispersion: {
            rowId: "row-1",
            logicalId: "case-1",
            maxNormalized: 0.42,
            high: true,
            outlierTrialIndex: 2,
          },
        },
      ],
      pagination: { page: 1, pageSize: 100, totalRows: 1, hasMore: false },
    });
    const wrapper = mount(ExperimentDetailPage, {
      global: {
        stubs: {
          OTable: {
            props: ["data", "columns"],
            emits: ["row-click"],
            template: `<table><tbody><tr v-for="row in data" :key="row.rowKey"
              @click="$emit('row-click', row)"><td v-for="column in columns" :key="column.id">
                <slot :name="'cell-' + column.id" :row="row">{{ row[column.accessorKey] }}</slot>
              </td></tr></tbody></table>`,
          },
          OTag: {
            props: ["label"],
            template: `<span>{{ label }}<slot /></span>`,
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.text()).toContain("3 trials");
    expect(wrapper.text()).toContain("0.75");
    expect(wrapper.text()).toContain("High");
    expect(wrapper.text()).toContain("42%");

    await wrapper.get("tbody tr").trigger("click");
    await flushPromises();
    expect(getRow).toHaveBeenCalledWith("acme", "exp-1", "row-1");

    listRows.mockClear();
    (wrapper.vm as any).dispersionView = "high_only";
    await flushPromises();
    expect(listRows).toHaveBeenCalledWith(
      "acme",
      "exp-1",
      expect.objectContaining({ sort: "dispersion_desc", highDispersionOnly: true }),
    );
  });

  // A clone costs a full run, and it is normally made in order to change
  // something first — so the action opens the seeded form, it does not launch.
  it("opens the create form seeded from this run instead of cloning outright", async () => {
    get.mockResolvedValue(makeExperimentDetail(makeExperiment({ id: "exp-1" })));
    const wrapper = mount(ExperimentDetailPage, {
      global: {
        stubs: {
          OTable: { template: `<table />` },
          OButton: {
            emits: ["click"],
            template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
          },
        },
      },
    });
    await flushPromises();

    await wrapper.get('[data-test="ai-experiment-detail-clone"]').trigger("click");
    await flushPromises();

    expect(clone).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "aiExperimentCreate",
        query: expect.objectContaining({ clone_of: "exp-1" }),
      }),
    );
  });

  it("re-fetches the results from the table toolbar", async () => {
    get.mockResolvedValue(makeExperimentDetail(makeExperiment({ id: "exp-1" })));
    const wrapper = mount(ExperimentDetailPage, {
      global: {
        stubs: {
          OTable: { template: `<table><slot name="toolbar-trailing" /></table>` },
          OButton: {
            emits: ["click"],
            template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
          },
        },
      },
    });
    await flushPromises();
    const calls = get.mock.calls.length;

    await wrapper.get('[data-test="ai-experiment-detail-refresh"]').trigger("click");
    await flushPromises();

    expect(get.mock.calls.length).toBe(calls + 1);
  });
});
