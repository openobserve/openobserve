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

const route = reactive({
  params: { baselineId: "one", candidateId: "two" } as Record<string, string>,
  query: {} as Record<string, string>,
});
const replace = vi.fn();
const push = vi.fn();
const back = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({
    push: (...a: any[]) => push(...a),
    replace: (...a: any[]) => replace(...a),
    back: (...a: any[]) => back(...a),
    resolve: vi.fn(),
  }),
}));
vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme" } } }),
}));

const compare = vi.fn();
const getRow = vi.fn();
const list = vi.fn();
vi.mock("@/services/llm-experiments.service", () => ({
  default: {
    compare: (...a: any[]) => compare(...a),
    getRow: (...a: any[]) => getRow(...a),
    list: (...a: any[]) => list(...a),
  },
}));

import ExperimentComparePage from "./ExperimentComparePage.vue";

const comparisonRow = {
  logicalId: "case-1",
  input: { question: "When?" },
  baselineRowId: "old-row",
  candidateRowId: "new-row",
  bucket: "regressed" as const,
  dimensions: [],
};

function mountPage() {
  return mount(ExperimentComparePage, {
    global: {
      stubs: {
        OPageLayout: {
          template: `<main><slot name="title-trail" /><slot name="actions" /><slot name="subnav" /><slot /></main>`,
        },
        OSeparator: true,
        OIcon: true,
        OTooltip: { template: `<div><slot /></div>` },
        OTag: { props: ["label"], template: `<span v-bind="$attrs">{{ label }}</span>` },
        OButton: { template: `<button v-bind="$attrs"><slot /></button>` },
        OSelect: {
          props: ["modelValue", "options"],
          template: `<button :data-options="options.map((o) => o.value).join(',')"></button>`,
        },
        ExperimentComparisonPanel: {
          props: ["comparison"],
          template: `<div>
            <button data-test="inspect-comparison" @click="$emit('inspect', comparison.rows[0])">Inspect</button>
            <button data-test="pick-threshold" @click="$emit('apply-threshold', 0.15)">Threshold</button>
          </div>`,
        },
        ExperimentComparisonRowDrawer: true,
      },
    },
  });
}

beforeEach(() => {
  compare.mockReset();
  getRow.mockReset();
  list.mockReset();
  replace.mockReset();
  route.params = { baselineId: "one", candidateId: "two" };
  list.mockResolvedValue([
    { id: "one", name: "baseline run", datasetId: "dataset-1", datasetName: "RAG set" },
    { id: "two", name: "candidate run", datasetId: "dataset-1", datasetName: "RAG set" },
    { id: "four", name: "third run", datasetId: "dataset-1", datasetName: "RAG set" },
    { id: "three", name: "other dataset run", datasetId: "dataset-2", datasetName: "Other set" },
  ]);
  compare.mockResolvedValue({
    baselineId: "one",
    candidateId: "two",
    datasetId: "dataset-1",
    threshold: 0,
    assignmentRule: "Any regression wins",
    counts: {
      baselineRows: 1,
      candidateRows: 1,
      commonRows: 1,
      regressed: 1,
      improved: 0,
      unchanged: 0,
      new: 0,
      missing: 0,
    },
    dimensions: [],
    rows: [comparisonRow],
  });
  getRow.mockImplementation(async (_org: string, experimentId: string, rowId: string) => ({
    experimentId,
    snapshot: { datasetId: "dataset-1", datasetVersion: 1 },
    navigation: { rowIndex: 0, totalRows: 1, previousRowId: null, nextRowId: null },
    rowId,
    logicalId: "case-1",
    input: null,
    expectedOutput: null,
    trials: [],
    scoreSummaries: [],
  }));
});

describe("ExperimentComparePage", () => {
  it("compares the two experiments named in the route params", async () => {
    mountPage();
    await flushPromises();

    // Undefined threshold on first load: the SERVER's neutral default governs.
    // Sending a client-side 0 would make every movement a regression.
    expect(compare).toHaveBeenCalledWith("acme", "one", "two", undefined);
  });

  it("offers each side only the other dataset-matched runs it isn't already showing", async () => {
    const wrapper = mountPage();
    await flushPromises();

    // "three" lives in another dataset — the server refuses a cross-dataset
    // compare — and each side hides the run the other already holds.
    expect(
      wrapper.get('[data-test="ai-experiment-compare-baseline-select"]').attributes("data-options"),
    ).toBe("one,four");
    expect(
      wrapper
        .get('[data-test="ai-experiment-compare-candidate-select"]')
        .attributes("data-options"),
    ).toBe("two,four");
  });

  it("renders the dataset badge through the real page header", async () => {
    const wrapper = mount(ExperimentComparePage, {
      global: {
        stubs: { ExperimentComparisonPanel: true, ExperimentComparisonRowDrawer: true },
      },
    });
    await flushPromises();

    // The badge fills in only after the experiments load, so this guards the
    // OPageHeader slot-presence latch that made it invisible.
    expect(wrapper.get('[data-test="ai-experiment-compare-dataset"]').text()).toBe("RAG set");
  });

  it("uses real browser back when there's history to pop, instead of the bare Experiments list", async () => {
    window.history.pushState({ back: "/previous" }, "", "/previous-fake-url");
    const wrapper = mount(ExperimentComparePage, {
      global: {
        stubs: { ExperimentComparisonPanel: true, ExperimentComparisonRowDrawer: true },
      },
    });
    await flushPromises();
    push.mockClear();

    await wrapper.get('[data-test="app-page-header-back"]').trigger("click");

    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    window.history.replaceState(null, "");
  });

  it("clips a long dataset name in the header badge", async () => {
    list.mockResolvedValue([
      {
        id: "one",
        name: "baseline run",
        datasetId: "dataset-1",
        datasetName: "a-really-long-dataset-name-that-overflows-the-header",
      },
      { id: "two", name: "candidate run", datasetId: "dataset-1", datasetName: "same" },
    ]);
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-test="ai-experiment-compare-dataset"]').text()).toBe(
      "a-really-long-dataset-name-tha…",
    );
  });

  it("shows a short dataset name whole", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-test="ai-experiment-compare-dataset"]').text()).toBe("RAG set");
  });

  it("reverses the pair from the swap button", async () => {
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="ai-experiment-compare-swap"]').trigger("click");
    await flushPromises();

    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({ params: { baselineId: "two", candidateId: "one" } }),
    );
  });

  it("navigates to the newly picked candidate", async () => {
    const wrapper = mountPage();
    await flushPromises();

    wrapper
      .getComponent('[data-test="ai-experiment-compare-candidate-select"]')
      .vm.$emit("update:modelValue", "four");
    await flushPromises();

    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({ params: { baselineId: "one", candidateId: "four" } }),
    );
  });

  it("re-runs the comparison at a threshold the panel picks", async () => {
    const wrapper = mountPage();
    await flushPromises();
    compare.mockClear();

    await wrapper.get('[data-test="pick-threshold"]').trigger("click");
    await flushPromises();

    expect(compare).toHaveBeenCalledWith("acme", "one", "two", 0.15);
  });

  it("fetches each side of an inspected row with its retained row ID", async () => {
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="inspect-comparison"]').trigger("click");
    await flushPromises();

    expect(getRow).toHaveBeenNthCalledWith(1, "acme", "one", "old-row");
    expect(getRow).toHaveBeenNthCalledWith(2, "acme", "two", "new-row");
  });
});
