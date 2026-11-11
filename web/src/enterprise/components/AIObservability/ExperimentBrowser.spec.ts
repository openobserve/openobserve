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
import { nextTick, reactive } from "vue";
import ExperimentBrowser from "./ExperimentBrowser.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { makeExperiment } from "@/enterprise/views/AIObservability/experimentTestFixtures";
import type { ExperimentScoreSummary } from "@/services/llm-experiments.service";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { createStore } from "vuex";
import { writeEditorDraft } from "@/utils/drafts/editorDraftStore";

const replace = vi.fn();
const push = vi.fn();
const route = reactive({ query: {} as Record<string, string> });

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ replace, push }),
}));

const cloneExperiment = vi.fn();
const setBaseline = vi.fn();
const clearBaseline = vi.fn();
const toast = vi.fn();
const compareExperiments = vi.fn();
vi.mock("@/services/llm-experiments.service", () => ({
  default: {
    clone: (...a: any[]) => cloneExperiment(...a),
    setBaseline: (...a: any[]) => setBaseline(...a),
    clearBaseline: (...a: any[]) => clearBaseline(...a),
    compare: (...a: any[]) => compareExperiments(...a),
  },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => toast(...a) }));
// No disclosure is the healthy answer, so a rising "% true" is a regression.
vi.mock("@/services/online-evals.service", () => ({
  default: {
    scoreConfigs: {
      list: async () => [
        { entityId: "cfg-leak", dataType: "boolean", healthyThreshold: { healthy_value: false } },
        { entityId: "cfg-latency", dataType: "numeric", healthyThreshold: { direction: "lte" } },
      ],
    },
  },
}));

vi.mock("vue-i18n", () => ({
  // Params are echoed, not dropped: a label is only correct if the right
  // numbers reach it, and a key-only mock hides that entirely.
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${Object.values(params).join(" ")}` : key,
    locale: { value: "en-US" },
  }),
}));

const store = createStore({
  state: { selectedOrganization: { identifier: "acme" }, userInfo: { email: "me@x.io" } },
});

const experiment = (id: string, datasetId: string, createdAt: number) =>
  makeExperiment({ id, name: id, datasetId, createdAt });

const makeScoreSummary = (
  overrides: Partial<ExperimentScoreSummary> = {},
): ExperimentScoreSummary => ({
  scorerId: "scorer-1",
  scorerVersion: 1,
  name: "score",
  scoreConfigId: null,
  scoreConfigName: null,
  scoreConfigVersion: null,
  sampleCount: 1,
  errorCount: 0,
  pendingCount: 0,
  noReferenceCount: 0,
  noTraceCount: 0,
  skippedCount: 0,
  value: null,
  ...overrides,
});

const stubs = {
  OSelect: {
    props: ["modelValue", "options", "label"],
    emits: ["update:modelValue"],
    template: `<select data-test="dataset-select" :value="modelValue" @change="$emit('update:modelValue', $event.target.value)"><option value="" /><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>`,
  },
  OInput: {
    props: ["modelValue", "label"],
    emits: ["update:modelValue"],
    template: `<input data-test="name-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  OButton: {
    template: `<button v-bind="$attrs"><slot /></button>`,
  },
  OTag: { template: `<span v-bind="$attrs"><slot /></span>` },
  OCheckbox: {
    props: ["modelValue", "disabled"],
    emits: ["update:modelValue"],
    template: `<input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.checked)" />`,
  },
  OTimeCell: {
    props: ["value"],
    template: `<time :datetime="String(value)">{{ value }}</time>`,
  },
  // Mirrors the real shape: an outer table of dataset rows whose #expansion
  // slot renders the nested experiments table (which owns the selection gutter).
  OTable: {
    props: [
      "data",
      "columns",
      "selection",
      "selectedIds",
      "isRowSelectable",
      "showHeader",
      "loading",
      "tree",
      "getChildren",
      "rowSection",
      "sectionOrder",
    ],
    emits: ["update:selectedIds", "row-click"],
    methods: {
      toggle(row, checked) {
        const next = checked
          ? [...(this.selectedIds ?? []), row.id]
          : (this.selectedIds ?? []).filter((id) => id !== row.id);
        this.$emit("update:selectedIds", next);
      },
    },
    template: `<table :data-loading="String(loading ?? false)"><tbody>
      <template v-if="rowSection">
        <tr v-for="key in sectionOrder" :key="key"><td><slot name="group-header" :section-key="key" /></td></tr>
      </template>
      <template v-for="row in data" :key="row.id">
        <tr @click="$emit('row-click', row, $event)">
          <td v-if="selection === 'multiple'">
            <input
              type="checkbox"
              :data-test="'ai-experiment-select-' + row.id"
              :checked="(selectedIds ?? []).includes(row.id)"
              :disabled="isRowSelectable ? !isRowSelectable(row) : false"
              @change="toggle(row, $event.target.checked)"
            />
          </td>
          <td v-for="col in columns" :key="col.id" :data-test="'cell-' + col.id + '-' + row.id">
            <slot :name="'cell-' + col.id" :row="row">{{ col.accessorFn ? col.accessorFn(row) : row[col.accessorKey] }}</slot>
          </td>
        </tr>
        <tr v-if="$slots.expansion"><td><slot name="expansion" :row="row" /></td></tr>
      </template>
    </tbody></table>`,
  },
};

beforeEach(() => {
  route.query = {};
  replace.mockReset();
  push.mockReset();
  setBaseline.mockReset();
  clearBaseline.mockReset();
  localStorage.clear();
});

describe("ExperimentBrowser", () => {
  // A running row is the bar plus its count: the bar already reads as "in
  // progress", so a Running chip beside it would say the same thing twice.
  it("shows a running row as a labelled progress bar with no status chip", () => {
    const running = makeExperiment({
      id: "run",
      name: "run",
      datasetId: "dataset-a",
      createdAt: 1,
      status: "running",
      executionProgress: { completed: 4, total: 10, skipped: 0 },
    });
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [running, experiment("done", "dataset-a", 2)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs, plugins: [store] },
    });

    const cell = wrapper.get('[data-test="ai-experiment-status-run"]');
    expect(cell.findComponent({ name: "OProgressBar" }).exists()).toBe(true);
    expect(cell.find('[data-test="ai-experiment-status-chip-run"]').exists()).toBe(false);
    // The count sits OUTSIDE the bar, the same shape the Nodes utilisation
    // columns use, and comes from taskProgress so it is there before the
    // executions have been counted.
    expect(cell.text()).toContain("4");
    expect(cell.text()).toContain("10");
    // The bar fills the cell rather than sitting at a fixed width, so the count
    // lands in the same place down the column.
    expect(cell.findComponent({ name: "OProgressBar" }).classes()).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1"]),
    );

    // A settled row is a chip, with no bar.
    const done = wrapper.get('[data-test="ai-experiment-status-done"]');
    expect(done.findComponent({ name: "OProgressBar" }).exists()).toBe(false);
    expect(done.find('[data-test="ai-experiment-status-chip-done"]').exists()).toBe(true);
  });

  it("shows scoring after execution has completed", () => {
    const scoring = makeExperiment({
      id: "scoring",
      status: "scoring",
      executionStatus: "completed",
      executionStatusReason: "task execution finished",
    });
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [scoring],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs, plugins: [store] },
    });

    const cell = wrapper.get('[data-test="cell-status-scoring"]');
    expect(cell.text()).toContain("Scoring");
    expect(cell.text()).not.toContain("Completed");
    expect(cell.text()).not.toContain("task execution finished");
  });

  // First load has no dataset groups yet, so one section stands up around an
  // OTable in its loading state — the shared skeleton, not a hand-rolled one.
  // The placeholders already name both controls, so the labels above them were
  // pure repetition — but the accessible name has to survive their removal.
  it("drops the visible filter labels while keeping the controls named", () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("one", "dataset-a", 1)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs, plugins: [store] },
    });

    for (const control of ["ai-experiment-dataset-filter", "ai-experiment-name-search"]) {
      const el = wrapper.getComponent(`[data-test="${control}"]`);
      expect(el.props("label")).toBeUndefined();
      expect(el.attributes("aria-label")).toBeTruthy();
    }
  });

  // A clone costs a full run, and it is normally made in order to change
  // something first — so the action opens the seeded form, it does not launch.
  it("opens the create form seeded from the row instead of running a copy", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("one", "dataset-a", 1)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs, plugins: [store] },
    });

    await wrapper.get('[data-test="ai-experiment-clone-one"]').trigger("click");
    await flushPromises();

    expect(cloneExperiment).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "aiExperimentCreate",
        query: expect.objectContaining({ clone_of: "one" }),
      }),
    );
    // The click must not ALSO open the row it sits in, which would race the
    // navigation to the form.
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("stands up one loading group before any data has arrived", () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [],
        datasets: [] as any,
        loading: true,
      },
      global: { stubs, plugins: [store] },
    });

    expect(wrapper.find('[data-test="ai-experiment-group-loading"]').exists()).toBe(true);
    // The toolbar must survive: hiding it would strand the user mid-refresh.
    for (const control of [
      "ai-experiment-dataset-filter",
      "ai-experiment-name-search",
      "ai-experiment-compare",
      "ai-experiment-refresh",
    ]) {
      expect(wrapper.find(`[data-test="${control}"]`).exists()).toBe(true);
    }
  });

  // On refresh the groups are already known, so each keeps its place and its
  // own OTable renders the skeleton — same as every other listing.
  it("hands loading to each group table on refresh, not a page-wide placeholder", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("one", "dataset-a", 1)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
        loading: true,
      },
      global: { stubs, plugins: [store] },
    });

    expect(wrapper.find('[data-test="ai-experiment-group-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ai-experiment-group-dataset-a"]').exists()).toBe(true);
    expect(wrapper.get("table").attributes("data-loading")).toBe("true");

    await wrapper.setProps({ loading: false });
    expect(wrapper.get("table").attributes("data-loading")).toBe("false");
  });

  it("asks the page to re-fetch from the refresh button", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("one", "dataset-a", 1)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs, plugins: [store] },
    });

    await wrapper.get('[data-test="ai-experiment-refresh"]').trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  it("preserves independent dataset and name filters in the URL", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("alpha", "dataset-a", 1), experiment("beta", "dataset-b", 2)],
        datasets: [
          { id: "dataset-a", name: "Dataset A" },
          { id: "dataset-b", name: "Dataset B" },
        ] as any,
        syncUrl: true,
      },
      global: { stubs, plugins: [store] },
    });

    await wrapper.get('[data-test="ai-experiment-dataset-filter"]').setValue("dataset-a");
    await wrapper.get('[data-test="ai-experiment-name-search"]').setValue("alp");
    await flushPromises();

    expect(replace).toHaveBeenLastCalledWith({
      query: { dataset: "dataset-a", experiment: "alp" },
    });
    expect(wrapper.find('[data-test="ai-experiment-row-alpha"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-experiment-row-beta"]').exists()).toBe(false);
    expect(wrapper.find("button input, button button").exists()).toBe(false);
  });

  it("calls clearBaseline when the pin is clicked on the current baseline", async () => {
    // The response carries no summary, so the emitted row must keep the listed scores.
    clearBaseline.mockResolvedValue(makeExperiment({ id: "old", isBaseline: false }));
    const scoreSummaries = [
      makeScoreSummary({
        name: "approved",
        value: { kind: "boolean", trueCount: 1, falseCount: 0 },
      }),
    ];
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [
          experiment("new", "dataset-a", 2),
          makeExperiment({
            id: "old",
            name: "old",
            datasetId: "dataset-a",
            createdAt: 1,
            isBaseline: true,
            scoreSummaries,
          }),
        ],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs, plugins: [store] },
    });

    await wrapper.get('[data-test="ai-experiment-baseline-old"]').trigger("click");
    await flushPromises();

    expect(clearBaseline).toHaveBeenCalledWith("acme", "old");
    expect(setBaseline).not.toHaveBeenCalled();
    expect(wrapper.emitted("baseline-changed")?.[0]).toEqual([
      expect.objectContaining({ id: "old", name: "old", isBaseline: false, scoreSummaries }),
      null,
    ]);
  });

  it("calls setBaseline when the pin is clicked on a non-baseline row", async () => {
    setBaseline.mockResolvedValue({
      experiment: makeExperiment({ id: "old", isBaseline: true }),
      previousBaselineId: null,
    });
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("old", "dataset-a", 1)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs, plugins: [store] },
    });

    await wrapper.get('[data-test="ai-experiment-baseline-old"]').trigger("click");
    await flushPromises();

    expect(setBaseline).toHaveBeenCalledWith("acme", "old");
    expect(clearBaseline).not.toHaveBeenCalled();
  });

  it("pins the baseline first regardless of creation order", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [
          experiment("new", "dataset-a", 2),
          makeExperiment({
            id: "old",
            name: "old",
            datasetId: "dataset-a",
            createdAt: 1,
            isBaseline: true,
          }),
        ],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs, plugins: [store] },
    });

    const rows = wrapper.findAll('[data-test^="ai-experiment-row-"]');
    expect(rows.map((row) => row.attributes("data-test"))).toEqual([
      "ai-experiment-row-old",
      "ai-experiment-row-new",
    ]);
  });

  it("uses the baseline as the default peer and opens the compare screen", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [
          experiment("new", "dataset-a", 2),
          makeExperiment({
            id: "old",
            name: "old",
            datasetId: "dataset-a",
            createdAt: 1,
            isBaseline: true,
          }),
        ],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
        syncUrl: true,
      },
      global: { stubs, plugins: [store] },
    });

    const candidateCheckbox = wrapper.get('[data-test="ai-experiment-select-new"]');
    await candidateCheckbox.setValue(true);

    expect(
      wrapper.get('[data-test="ai-experiment-compare"]').attributes("disabled"),
    ).toBeUndefined();
    await wrapper.get('[data-test="ai-experiment-compare"]').trigger("click");
    // Compare now opens its own screen, with the two ids as path params.
    expect(push).toHaveBeenCalledWith({
      name: "aiExperimentCompare",
      params: { baselineId: "old", candidateId: "new" },
      query: { org_identifier: "acme" },
    });
  });

  it("reacts to Back/Forward query changes without rewriting the same URL", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("alpha", "dataset-a", 1), experiment("beta", "dataset-b", 2)],
        datasets: [
          { id: "dataset-a", name: "Dataset A" },
          { id: "dataset-b", name: "Dataset B" },
        ] as any,
        syncUrl: true,
      },
      global: { stubs, plugins: [store] },
    });
    replace.mockReset();

    route.query = { dataset: "dataset-b", experiment: "bet" };
    await nextTick();

    expect(wrapper.find('[data-test="ai-experiment-row-alpha"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ai-experiment-row-beta"]').exists()).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it("gives each scorer its own column instead of one joined score label", () => {
    const row = experiment("scored", "dataset-a", 1);
    row.scoreSummaries = [
      makeScoreSummary({
        name: "approved",
        value: { kind: "boolean", trueCount: 1, falseCount: 0 },
      }),
      makeScoreSummary({
        name: "label",
        value: { kind: "categorical", counts: { good: 1 } },
      }),
    ];
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [row],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs, plugins: [store] },
    });

    expect(wrapper.get('[data-test="cell-score:approved-scored"]').text()).toBe("100% true");
    expect(wrapper.get('[data-test="cell-score:label-scored"]').text()).toBe("good × 1");
  });

  it("keeps score columns scoped to their dataset group", () => {
    const first = experiment("first", "dataset-a", 1);
    first.scoreSummaries = [
      makeScoreSummary({ name: "quality", value: { kind: "numeric", mean: 0.8 } }),
    ];
    const second = experiment("second", "dataset-b", 2);
    second.scoreSummaries = [
      makeScoreSummary({ name: "safety", value: { kind: "boolean", trueCount: 1, falseCount: 0 } }),
    ];
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [first, second],
        datasets: [
          { id: "dataset-a", name: "Dataset A" },
          { id: "dataset-b", name: "Dataset B" },
        ] as any,
      },
      global: { stubs, plugins: [store] },
    });

    expect(wrapper.find('[data-test="cell-score:safety-first"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="cell-score:quality-second"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="cell-score:quality-first"]').text()).toBe("0.800");
    expect(wrapper.get('[data-test="cell-score:safety-second"]').text()).toBe("100% true");
  });

  it("caps comparison at two rows", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [
          experiment("one", "dataset-a", 1),
          experiment("two", "dataset-a", 2),
          experiment("three", "dataset-a", 3),
        ],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs, plugins: [store] },
    });

    await wrapper.get('[data-test="ai-experiment-select-one"]').setValue(true);
    await wrapper.get('[data-test="ai-experiment-select-two"]').setValue(true);

    // Two picked: the third closes, and the two picked stay togglable so they
    // can be swapped out.
    expect(
      wrapper.get('[data-test="ai-experiment-select-three"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.get('[data-test="ai-experiment-select-one"]').attributes("disabled"),
    ).toBeUndefined();

    await wrapper.get('[data-test="ai-experiment-select-one"]').setValue(false);
    expect(
      wrapper.get('[data-test="ai-experiment-select-three"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("states the two-experiment rule before anything is selected, and counts up", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("one", "dataset-a", 1), experiment("two", "dataset-a", 2)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs, plugins: [store] },
    });

    const count = () => wrapper.get('[data-test="ai-experiment-selection-count"]').text();
    // Present with nothing selected — that is where the rule has to be learned.
    expect(count()).toBe("aiObservability.experiments.selectionCount 0");

    await wrapper.get('[data-test="ai-experiment-select-one"]').setValue(true);
    expect(wrapper.find('[data-test="ai-experiment-selection-count"]').exists()).toBe(true);
    await wrapper.get('[data-test="ai-experiment-select-two"]').setValue(true);
    expect(
      wrapper.get('[data-test="ai-experiment-compare"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("disables cross-dataset comparison after one selection", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("one", "dataset-a", 1), experiment("two", "dataset-b", 2)],
        datasets: [
          { id: "dataset-a", name: "Dataset A" },
          { id: "dataset-b", name: "Dataset B" },
        ] as any,
      },
      global: { stubs, plugins: [store] },
    });

    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    await checkboxes[0].setValue(true);

    expect(checkboxes[1].attributes("disabled")).toBeDefined();

    // No banner: it pushed the whole list down and back up as the selection
    // changed. The counter below carries the rule instead, always rendered.
    expect(wrapper.find('[data-test="ai-experiment-comparison-reason"]').exists()).toBe(false);
    const compare = wrapper.get('[data-test="ai-experiment-compare"]');
    expect(compare.attributes("disabled")).toBeDefined();
    expect(compare.attributes("aria-description")).toBe(
      "aiObservability.experiments.comparisonReasons.select_two",
    );
  });

  it("marks the Clone action of a run that has an unsaved clone draft", async () => {
    writeEditorDraft(
      { kind: "experiment", org: "acme", entityId: "two", userEmail: "me@x.io" },
      { data: { name: "two (Copy)" } },
    );
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("one", "dataset-a", 1), experiment("two", "dataset-a", 2)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as never,
      },
      global: { stubs, plugins: [store] },
    });
    await flushPromises();

    const clone = wrapper.get('[data-test="ai-experiment-clone-two"]');
    expect(clone.find('[data-test="ai-experiment-two-clone-draft-dot"]').exists()).toBe(true);
    expect(clone.attributes("aria-label")).toContain(
      "common.editorDraft.newDotDated aiObservability.experiments.clone",
    );
    expect(
      wrapper.get('[data-test="ai-experiment-row-two"]').find('[data-test$="-draft-dot"]').exists(),
    ).toBe(false);
    expect(wrapper.find('[data-test="ai-experiment-one-clone-draft-dot"]').exists()).toBe(false);
  });

  it("marks the phone row menu of a run that has an unsaved clone draft", async () => {
    writeEditorDraft(
      { kind: "experiment", org: "acme", entityId: "two", userEmail: "me@x.io" },
      { data: { name: "two (Copy)" } },
    );
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("one", "dataset-a", 1), experiment("two", "dataset-a", 2)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as never,
      },
      global: { stubs, plugins: [store] },
    });
    await flushPromises();

    const menus = wrapper.findAll('[data-test="ai-experiment-actions-menu-btn"]');
    const drafted = menus.filter((m) =>
      m.find('[data-test="ai-experiment-two-actions-menu-draft-dot"]').exists(),
    );
    expect(drafted).toHaveLength(1);
    expect(drafted[0].attributes("aria-label")).toContain(
      "common.editorDraft.newDotDated common.moreActions",
    );
    expect(wrapper.findAll('[data-test$="-actions-menu-draft-dot"]')).toHaveLength(1);
    const plain = menus.find((m) => m !== drafted[0]);
    expect(plain?.attributes("aria-label")).toBe("common.moreActions");
  });

  // The mode alone read "none × 39" and hid the 17 full leaks beside it.
  it("shows every category of a categorical score with its count", () => {
    const row = experiment("scored", "dataset-a", 1);
    row.scoreSummaries = [
      makeScoreSummary({
        name: "severity",
        value: { kind: "categorical", counts: { full: 17, none: 39 } },
      }),
    ];
    const wrapper = mount(ExperimentBrowser, {
      props: { orgId: "acme", experiments: [row], datasets: [] as any },
      global: { stubs, plugins: [store] },
    });

    expect(wrapper.get('[data-test="cell-score:severity-scored"]').text()).toBe(
      "none × 39 · full × 17",
    );
  });

  const leak = (trueCount: number) => [
    makeScoreSummary({
      name: "leak",
      scoreConfigId: "cfg-leak",
      sampleCount: 56,
      value: { kind: "boolean", trueCount, falseCount: 56 - trueCount },
    }),
  ];

  it("judges each run against the baseline on its scores, with the delta in each cell", async () => {
    const base = makeExperiment({
      id: "base",
      name: "base",
      createdAt: 1,
      isBaseline: true,
      scoreSummaries: leak(17),
    });
    const pr = makeExperiment({ id: "pr", name: "pr", createdAt: 2, scoreSummaries: leak(23) });
    const wrapper = mount(ExperimentBrowser, {
      props: { orgId: "acme", experiments: [base, pr], datasets: [] as any },
      global: { stubs, plugins: [store] },
    });
    await flushPromises();

    const outcome = wrapper.get('[data-test="ai-experiment-outcome-pr"]').text();
    expect(outcome).toContain("experimentsAtScale.outcome.regressed");
    expect(outcome).toContain("leak −10.7");
    expect(wrapper.get('[data-test="ai-experiment-delta-pr-leak"]').text()).toContain("−10.7");
    expect(wrapper.find('[data-test="ai-experiment-outcome-base"]').exists()).toBe(false);
    // The trend plots both runs and counts the one outside the band.
    expect(wrapper.get('[data-test="ai-experiment-trend-regressed"]').text()).toBe(
      "experimentsAtScale.regressedCount 1",
    );
  });

  it("still judges matching runs against a baseline the name search hides", async () => {
    const base = makeExperiment({
      id: "base",
      name: "base",
      createdAt: 1,
      isBaseline: true,
      scoreSummaries: leak(17),
    });
    const pr = makeExperiment({ id: "pr", name: "pr", createdAt: 2, scoreSummaries: leak(23) });
    const wrapper = mount(ExperimentBrowser, {
      props: { orgId: "acme", experiments: [base, pr], datasets: [] as any },
      global: { stubs, plugins: [store] },
    });
    await wrapper.get('[data-test="ai-experiment-name-search"]').setValue("pr");
    await flushPromises();

    expect(wrapper.find('[data-test="ai-experiment-row-base"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="ai-experiment-outcome-pr"]').text()).toContain(
      "experimentsAtScale.outcome.regressed",
    );
    expect(wrapper.find('[data-test="ai-experiment-trend-regressed"]').exists()).toBe(true);
  });

  it("folds re-runs of one name on one commit into the latest, with their spread", () => {
    const rerun = (id: string, createdAt: number, trueCount: number) =>
      makeExperiment({
        id,
        name: "gh-pr172-303cfc8",
        createdAt,
        metadata: { "git.commit": "303cfc8", "git.pr": 172 },
        scoreSummaries: leak(trueCount),
      });
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [rerun("r2", 2, 18), rerun("r1", 1, 15)],
        datasets: [] as any,
      },
      global: { stubs, plugins: [store] },
    });

    expect(wrapper.find('[data-test="ai-experiment-row-r1"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="ai-experiment-fold-r2"]').text()).toContain(
      "experimentsAtScale.foldCount 2",
    );
    expect(wrapper.get('[data-test="ai-experiment-spread-r2-leak"]').text()).toContain("27–32%");
  });

  it("judges a run on a newer dataset version over the cases it shares with the baseline", async () => {
    compareExperiments.mockResolvedValue({
      counts: { commonRows: 10, new: 1, missing: 0 },
      dimensions: [
        {
          kind: "score",
          name: "leak",
          gating: true,
          comparableRowCount: 10,
          orientedDelta: 0,
          delta: 0,
        },
      ],
    });
    const base = makeExperiment({
      id: "qa2-base",
      name: "qa2-base",
      createdAt: 1,
      isBaseline: true,
      datasetVersion: 10,
      scoreSummaries: leak(17),
    });
    // Its own means include the failing new case, so alone they read as a regression.
    const dsv11 = makeExperiment({
      id: "qa2-dsv11",
      name: "qa2-dsv11",
      createdAt: 2,
      datasetVersion: 11,
      scoreSummaries: leak(23),
    });
    const wrapper = mount(ExperimentBrowser, {
      props: { orgId: "acme", experiments: [base, dsv11], datasets: [] as any },
      global: { stubs, plugins: [store] },
    });
    await flushPromises();

    expect(compareExperiments).toHaveBeenCalledWith("acme", "qa2-base", "qa2-dsv11");
    expect(wrapper.get('[data-test="ai-experiment-outcome-qa2-dsv11"]').text()).toContain(
      "experimentsAtScale.outcome.unchanged",
    );
    expect(wrapper.get('[data-test="ai-experiment-cases-qa2-dsv11"]').text()).toContain(
      "experimentsAtScale.sharedCasesExcluded 10 1",
    );
    expect(wrapper.get('[data-test="ai-experiment-delta-qa2-dsv11-leak"]').text()).toContain("0.0");
    expect(wrapper.find('[data-test="ai-experiment-trend-point-qa2-dsv11"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="ai-experiment-trend-regressed"]').text()).toBe(
      "experimentsAtScale.regressedCount 0",
    );
  });

  // An SDK run with `scorers: []` whose code reports its own Scores.
  it("gives client-reported scores their own column and judges them against the baseline", async () => {
    const clientLeak = (trueCount: number) => [
      {
        scoreConfigId: "cfg-leak",
        scoreConfigName: "leak",
        clientScorerKey: "ci_leak",
        sampleCount: 56,
        value: { kind: "boolean", trueCount, falseCount: 56 - trueCount },
      },
    ];
    const base = makeExperiment({
      id: "sdk-base",
      name: "sdk-base",
      createdAt: 1,
      isBaseline: true,
      scoreSummaries: [],
      clientScoreSummaries: clientLeak(17),
    });
    const pr = makeExperiment({
      id: "sdk-pr",
      name: "sdk-pr",
      createdAt: 2,
      scoreSummaries: [],
      clientScoreSummaries: clientLeak(23),
    });
    const wrapper = mount(ExperimentBrowser, {
      props: { orgId: "acme", experiments: [base, pr], datasets: [] as any },
      global: { stubs, plugins: [store] },
    });
    await flushPromises();

    const column = "score:client:cfg-leak:ci_leak";
    const columns = wrapper.findComponent(stubs.OTable).props("columns") as OTableColumnDef[];
    const header = columns.find((entry) => entry.id === column);
    expect(header?.header).toBe("experimentsAtScale.clientScore leak");
    expect(header?.meta?.headerTooltip).toBe("experimentsAtScale.clientScoreTooltip ci_leak");
    expect(wrapper.get(`[data-test="cell-${column}-sdk-pr"]`).text()).toContain("41% true");

    const outcome = wrapper.get('[data-test="ai-experiment-outcome-sdk-pr"]').text();
    expect(outcome).toContain("experimentsAtScale.outcome.regressed");
    expect(outcome).toContain("experimentsAtScale.clientScore leak −10.7");
    expect(
      wrapper.get('[data-test="ai-experiment-delta-sdk-pr-client:cfg-leak:ci_leak"]').text(),
    ).toContain("−10.7");
    expect(wrapper.get('[data-test="ai-experiment-trend-regressed"]').text()).toBe(
      "experimentsAtScale.regressedCount 1",
    );
  });

  // Four completed re-runs of qa2-flaky on PR 108, then a cancelled fifth.
  it("keeps the newest completed re-run's verdict when a newer re-run was cancelled", async () => {
    route.query = { group: "pr", sort: "regressions" };
    const flaky = (
      id: string,
      createdAt: number,
      trueCount: number,
      status: "completed" | "cancelled" = "completed",
    ) =>
      makeExperiment({
        id,
        name: "qa2-flaky",
        createdAt,
        status,
        metadata: { "git.commit": "108aaaa", "git.pr": 108 },
        scoreSummaries: status === "completed" ? leak(trueCount) : [],
      });
    const base = makeExperiment({
      id: "flaky-base",
      name: "flaky-base",
      createdAt: 1,
      isBaseline: true,
      scoreSummaries: leak(17),
    });
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [
          base,
          flaky("f1", 2, 17),
          flaky("f2", 3, 18),
          flaky("f3", 4, 16),
          flaky("f4", 5, 23),
          flaky("f5", 6, 0, "cancelled"),
        ],
        datasets: [] as any,
        syncUrl: true,
      },
      global: { stubs, plugins: [store] },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="ai-experiment-row-f5"]').exists()).toBe(false);
    const outcome = wrapper.get('[data-test="ai-experiment-outcome-f4"]').text();
    expect(outcome).toContain("experimentsAtScale.outcome.regressed");
    expect(outcome).toContain("leak −10.7");
    expect(wrapper.get('[data-test="ai-experiment-newer-rerun-f4"]').text()).toContain(
      "experimentsAtScale.newerRerun Cancelled",
    );
    expect(wrapper.get('[data-test="ai-experiment-spread-f4-leak"]').text()).toContain(
      "experimentsAtScale.spread 4 ",
    );
    // One count everywhere: the four settled runs; the cancelled one is named beside them.
    const fold = wrapper.get('[data-test="ai-experiment-fold-f4"]');
    expect(fold.text()).toContain("experimentsAtScale.foldCount 4");
    expect(fold.findComponent(OTooltip).props("content")).toContain(
      "experimentsAtScale.incomplete.cancelled 1",
    );
    const section = wrapper.get('[data-test="ai-experiment-ci-group-pr:108"]').text();
    expect(section).toContain("experimentsAtScale.groupRuns 4");
    expect(section).toContain("experimentsAtScale.incomplete.cancelled 1");
    expect(wrapper.get('[data-test="ai-experiment-ci-group-pr:108"]').text()).toContain(
      "experimentsAtScale.regressedCount 1",
    );
    expect(wrapper.find('[data-test="ai-experiment-trend-point-f4"]').exists()).toBe(true);
  });

  it("groups by pull request from the URL and writes the sort back to it", async () => {
    route.query = { group: "pr" };
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [
          makeExperiment({ id: "pr", name: "pr", metadata: { "git.pr": "181" } }),
          makeExperiment({ id: "hand", name: "hand", createdAt: 2 }),
        ],
        datasets: [] as any,
        syncUrl: true,
      },
      global: { stubs, plugins: [store] },
    });

    expect(wrapper.get('[data-test="ai-experiment-ci-group-pr:181"]').text()).toContain(
      "experimentsAtScale.prGroup 181",
    );
    expect(wrapper.get('[data-test="ai-experiment-ci-group-none"]').text()).toContain(
      "experimentsAtScale.noGroup.pr",
    );

    await wrapper.get('[data-test="ai-experiment-sort"]').setValue("regressions");
    await flushPromises();
    expect(replace).toHaveBeenLastCalledWith({ query: { group: "pr", sort: "regressions" } });
  });

  // qa2-partial, whose tone Scorer errored on 5 of 10 rows.
  it("judges a run whose scorer failed on some rows by its other scores, and marks the failed one", async () => {
    const base = makeExperiment({
      id: "base",
      name: "base",
      createdAt: 1,
      isBaseline: true,
      scoreSummaries: leak(17),
    });
    const tone = makeScoreSummary({
      name: "tone",
      sampleCount: 5,
      errorCount: 5,
      value: { kind: "numeric", mean: 0.5 },
    });
    const partial = makeExperiment({
      id: "partial",
      name: "partial",
      createdAt: 2,
      status: "scoring_failed",
      scoreSummaries: [...leak(23), tone],
    });
    const wrapper = mount(ExperimentBrowser, {
      props: { orgId: "acme", experiments: [base, partial], datasets: [] as any },
      global: { stubs, plugins: [store] },
    });
    await flushPromises();

    expect(wrapper.get('[data-test="ai-experiment-outcome-partial"]').text()).toContain(
      "experimentsAtScale.outcome.regressed",
    );
    expect(wrapper.get('[data-test="ai-experiment-score-errors-partial-tone"]').text()).toContain(
      "experimentsAtScale.scoreErrors 5",
    );
    expect(wrapper.find('[data-test="ai-experiment-score-errors-partial-leak"]').exists()).toBe(
      false,
    );
  });

  // Unranged qa2-latency (lte), baseline 100, run 0.
  it("reads an unranged score's move as a percent of the baseline, not points", async () => {
    const latency = (mean: number) => [
      makeScoreSummary({
        name: "latency",
        scoreConfigId: "cfg-latency",
        value: { kind: "numeric", mean },
      }),
    ];
    const base = makeExperiment({
      id: "base",
      name: "base",
      createdAt: 1,
      isBaseline: true,
      scoreSummaries: latency(100),
    });
    const fast = makeExperiment({
      id: "fast",
      name: "fast",
      createdAt: 2,
      scoreSummaries: latency(0),
    });
    const wrapper = mount(ExperimentBrowser, {
      props: { orgId: "acme", experiments: [base, fast], datasets: [] as any },
      global: { stubs, plugins: [store] },
    });
    await flushPromises();

    expect(wrapper.get('[data-test="ai-experiment-outcome-fast"]').text()).toContain(
      "experimentsAtScale.headlineRelative latency +100.0",
    );
    expect(wrapper.get('[data-test="ai-experiment-delta-fast-latency"]').text()).toContain(
      "+100.0%",
    );
  });

  // qa2-allerr: every task errored, then finalized.
  it("says how many tasks failed on a completed run and refuses it as the baseline", async () => {
    const allErr = makeExperiment({
      id: "allerr",
      name: "allerr",
      createdAt: 1,
      status: "completed",
      taskOutcomes: { total: 10, succeeded: 0, failed: 10, pending: 0, skipped: 0 },
    });
    const wrapper = mount(ExperimentBrowser, {
      props: { orgId: "acme", experiments: [allErr], datasets: [] as any },
      global: { stubs, plugins: [store] },
    });
    await flushPromises();

    expect(wrapper.get('[data-test="ai-experiment-task-failures-allerr"]').text()).toContain(
      "experimentsAtScale.tasksFailed 10 10",
    );
    expect(
      wrapper.get('[data-test="ai-experiment-baseline-allerr"]').attributes("disabled"),
    ).toBeDefined();
  });

  // The row numbers follow the data, so the data must be in section order.
  it("hands the table its rows in the order the sections show them", async () => {
    route.query = { group: "pr" };
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [
          makeExperiment({ id: "pr1", name: "pr1", createdAt: 1, metadata: { "git.pr": "1" } }),
          makeExperiment({ id: "hand", name: "hand", createdAt: 3 }),
          makeExperiment({ id: "pr2", name: "pr2", createdAt: 2, metadata: { "git.pr": "2" } }),
        ],
        datasets: [] as any,
        syncUrl: true,
      },
      global: { stubs, plugins: [store] },
    });
    await flushPromises();

    const table = wrapper.findComponent(stubs.OTable);
    expect(table.props("sectionOrder")).toEqual(["pr:2", "pr:1", "none"]);
    expect((table.props("data") as { id: string }[]).map(({ id }) => id)).toEqual([
      "pr2",
      "pr1",
      "hand",
    ]);
  });

  // CI re-runs minutes apart read "Nov 6 … Nov 6" without the time.
  it("adds the time to the trend axis when its first and last runs share a day", async () => {
    const day = new Date(2026, 10, 6, 10, 0).getTime();
    const base = makeExperiment({
      id: "base",
      name: "base",
      createdAt: day,
      isBaseline: true,
      scoreSummaries: leak(17),
    });
    const pr = makeExperiment({
      id: "pr",
      name: "pr",
      createdAt: day + 30 * 60_000,
      scoreSummaries: leak(23),
    });
    const wrapper = mount(ExperimentBrowser, {
      props: { orgId: "acme", experiments: [base, pr], datasets: [] as any },
      global: { stubs, plugins: [store] },
    });
    await flushPromises();

    const axis = wrapper
      .findAll('[data-test="ai-experiment-trend"] text')
      .filter((text) => text.attributes("y") === "136")
      .map((text) => text.text());
    expect(axis).toHaveLength(2);
    expect(axis[0]).not.toBe(axis[1]);
  });
});
