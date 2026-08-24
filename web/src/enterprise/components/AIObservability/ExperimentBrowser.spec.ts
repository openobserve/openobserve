// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import ExperimentBrowser from "./ExperimentBrowser.vue";
import {
  makeExperiment,
  makeExperimentDetail,
} from "@/enterprise/views/AIObservability/experimentTestFixtures";

const replace = vi.fn();
const push = vi.fn();
const route = reactive({ query: {} as Record<string, string> });

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ replace, push }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const experiment = (id: string, datasetId: string, createdAt: number) =>
  makeExperiment({ id, name: id, datasetId, createdAt });

const stubs = {
  OSelect: {
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    template: `<select data-test="dataset-select" :value="modelValue" @change="$emit('update:modelValue', $event.target.value)"><option value="" /><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>`,
  },
  OInput: {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<input data-test="name-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  OButton: {
    template: `<button v-bind="$attrs"><slot /></button>`,
  },
  OTag: { template: `<span><slot /></span>` },
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
    props: ["data", "columns", "selection", "selectedIds", "isRowSelectable", "showHeader"],
    emits: ["update:selectedIds"],
    methods: {
      toggle(row, checked) {
        const next = checked
          ? [...(this.selectedIds ?? []), row.id]
          : (this.selectedIds ?? []).filter((id) => id !== row.id);
        this.$emit("update:selectedIds", next);
      },
    },
    template: `<table><tbody>
      <template v-for="row in data" :key="row.id">
        <tr>
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
  localStorage.clear();
});

describe("ExperimentBrowser", () => {
  // First load has no dataset groups yet, so one section stands up around an
  // OTable in its loading state — the shared skeleton, not a hand-rolled one.
  it("stands up one loading group before any data has arrived", () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [],
        datasets: [] as any,
        loading: true,
      },
      global: { stubs },
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
      global: { stubs },
    });

    expect(wrapper.find('[data-test="ai-experiment-group-loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ai-experiment-group-dataset-a"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "OTable" }).props("loading")).toBe(true);

    await wrapper.setProps({ loading: false });
    expect(wrapper.findComponent({ name: "OTable" }).props("loading")).toBe(false);
  });

  it("asks the page to re-fetch from the refresh button", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("one", "dataset-a", 1)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs },
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
      global: { stubs },
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

  it("persists the selected baseline and orders it first", async () => {
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("new", "dataset-a", 2), experiment("old", "dataset-a", 1)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
      },
      global: { stubs },
    });

    await wrapper.get('[data-test="ai-experiment-baseline-old"]').trigger("click");

    expect(JSON.parse(localStorage.getItem("o2_experiment_baselines_acme") ?? "{}")).toEqual({
      "dataset-a": "old",
    });
    const rows = wrapper.findAll('[data-test^="ai-experiment-row-"]');
    expect(rows.map((row) => row.attributes("data-test"))).toEqual([
      "ai-experiment-row-old",
      "ai-experiment-row-new",
    ]);
  });

  it("uses the baseline as the default peer and opens the compare screen", async () => {
    localStorage.setItem("o2_experiment_baselines_acme", JSON.stringify({ "dataset-a": "old" }));
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [experiment("new", "dataset-a", 2), experiment("old", "dataset-a", 1)],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
        syncUrl: true,
      },
      global: { stubs },
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
      global: { stubs },
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
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [row],
        datasets: [{ id: "dataset-a", name: "Dataset A" }] as any,
        details: {
          scored: makeExperimentDetail(row, {
            results: {
              executions: [],
              scores: [
                { name: "approved", value_boolean: true },
                { name: "label", value_categorical: "good" },
              ],
            },
          }),
        },
      },
      global: { stubs },
    });

    expect(wrapper.get('[data-test="cell-score:approved-scored"]').text()).toBe("100% true");
    expect(wrapper.get('[data-test="cell-score:label-scored"]').text()).toBe("good × 1");
  });

  it("keeps score columns scoped to their dataset group", () => {
    const first = experiment("first", "dataset-a", 1);
    const second = experiment("second", "dataset-b", 2);
    const wrapper = mount(ExperimentBrowser, {
      props: {
        orgId: "acme",
        experiments: [first, second],
        datasets: [
          { id: "dataset-a", name: "Dataset A" },
          { id: "dataset-b", name: "Dataset B" },
        ] as any,
        details: {
          first: makeExperimentDetail(first, {
            results: { executions: [], scores: [{ name: "quality", value_numeric: 0.8 }] },
          }),
          second: makeExperimentDetail(second, {
            results: { executions: [], scores: [{ name: "safety", value_boolean: true }] },
          }),
        },
      },
      global: { stubs },
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
      global: { stubs },
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
      global: { stubs },
    });

    const count = () => wrapper.get('[data-test="ai-experiment-selection-count"]').text();
    // Present with nothing selected — that is where the rule has to be learned.
    expect(count()).toBe("aiObservability.experiments.selectionCount");

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
      global: { stubs },
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
});
