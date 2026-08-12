// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { LlmExperiment } from "@/services/llm-experiments.service";
import ExperimentBrowser from "./ExperimentBrowser.vue";

const replace = vi.fn();
const route = { query: {} as Record<string, string> };

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ replace }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const experiment = (id: string, datasetId: string, createdAt: number): LlmExperiment => ({
  id,
  orgId: "acme",
  name: id,
  datasetId,
  datasetVersion: 1,
  task: { type: "remote", config: {} },
  scorers: [],
  trialCount: 1,
  status: "completed",
  createdBy: "test",
  createdAt,
});

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
};

beforeEach(() => {
  route.query = {};
  replace.mockReset();
  localStorage.clear();
});

describe("ExperimentBrowser", () => {
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
    expect(wrapper.get('[data-test="ai-experiment-comparison-reason"]').text()).toContain(
      "Select two experiments",
    );
  });
});
