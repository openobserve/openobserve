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

// Behavior tests for the experiment create form. At least one test drives the
// REAL <OForm> so an unwired `:schema` (which would let an empty form "save")
// is caught rather than assumed.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import ExperimentForm from "./ExperimentForm.vue";
import llmExperimentsService from "@/services/llm-experiments.service";
import llmDatasetsService from "@/services/llm-datasets.service";
import onlineEvalsService from "@/services/online-evals.service";
import i18n from "@/locales";

const push = vi.fn();

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push }),
  onBeforeRouteLeave: vi.fn(),
}));

vi.mock("@/services/llm-experiments.service", () => ({
  default: { create: vi.fn(), preview: vi.fn() },
}));
vi.mock("@/services/llm-datasets.service", () => ({ default: { list: vi.fn() } }));
vi.mock("@/services/online-evals.service", () => ({
  default: { scorers: { list: vi.fn() }, providers: { list: vi.fn() } },
}));

const store = createStore({
  state: { theme: "light", selectedOrganization: { identifier: "test-org" } },
});

const dataset = {
  id: "ds-1",
  name: "RAG regression set",
  description: null,
  globalVersion: 12,
  itemCount: 128,
  tags: [],
  sources: { trace: 0, annotation: 0, manual: 0 },
};

const scorer = {
  id: "sc-1",
  entityId: "sc-1",
  name: "answer_correctness_judge",
  version: 2,
  scorerType: "llm_judge",
  template: "",
  referenceBased: true,
};

const provider = {
  id: "pr-1",
  name: "Production OpenAI",
  providerType: "openai",
  availableModels: ["gpt-4o"],
};

const previewResult = {
  datasetId: "ds-1",
  datasetVersion: 12,
  rowCount: 128,
  trialCount: 1,
  slotCount: 128,
  pinnedScorers: [{ id: "sc-1", version: 2 }],
  applicability: {
    fullySkippedRowCount: 10,
    partiallySkippedRowCount: 0,
    fullySkippedSlotCount: 10,
    partiallySkippedSlotCount: 0,
    eligibleTaskSlotCount: 118,
    scorerApplicability: [],
  },
  sampleSlots: [],
};

function oform(w: any) {
  return w.findComponent({ name: "OForm" }).vm as any;
}
function setField(w: any, name: string, value: unknown) {
  oform(w).form.setFieldValue(name, value);
}
async function submit(w: any) {
  await oform(w).form.handleSubmit();
  await flushPromises();
}

async function createWrapper() {
  const w = mount(ExperimentForm, { global: { plugins: [store, i18n] } });
  await flushPromises();
  return w;
}

/** A form filled just enough to be valid. */
function fillValid(w: any) {
  setField(w, "name", "prompt v4 probe");
  setField(w, "datasetId", "ds-1");
  setField(w, "providerId", "pr-1");
  setField(w, "userPrompt", "{{ input }}");
  setField(w, "scorerIds", ["sc-1"]);
}

describe("ExperimentForm", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (llmDatasetsService.list as any).mockResolvedValue([dataset]);
    (onlineEvalsService.scorers.list as any).mockResolvedValue([scorer]);
    (onlineEvalsService.providers.list as any).mockResolvedValue([provider]);
    (llmExperimentsService.preview as any).mockResolvedValue(previewResult);
    (llmExperimentsService.create as any).mockResolvedValue({
      experiment: { id: "exp-1" },
      preview: previewResult,
      created: true,
    });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("does not create an experiment when the form is empty", async () => {
    wrapper = await createWrapper();
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(llmExperimentsService.create).not.toHaveBeenCalled();
  });

  it("requires a dataset", async () => {
    wrapper = await createWrapper();
    fillValid(wrapper);
    setField(wrapper, "datasetId", "");
    await submit(wrapper);
    expect(llmExperimentsService.create).not.toHaveBeenCalled();
  });

  it("requires at least one scorer", async () => {
    wrapper = await createWrapper();
    fillValid(wrapper);
    setField(wrapper, "scorerIds", []);
    await submit(wrapper);
    expect(llmExperimentsService.create).not.toHaveBeenCalled();
  });

  it("requires a provider and a user prompt", async () => {
    wrapper = await createWrapper();
    fillValid(wrapper);
    setField(wrapper, "providerId", "");
    await submit(wrapper);
    expect(llmExperimentsService.create).not.toHaveBeenCalled();

    setField(wrapper, "providerId", "pr-1");
    setField(wrapper, "userPrompt", "   ");
    await submit(wrapper);
    expect(llmExperimentsService.create).not.toHaveBeenCalled();
  });

  it("sends the payload with explicit keys, a numeric trial count and the pinned dataset version", async () => {
    wrapper = await createWrapper();
    fillValid(wrapper);
    setField(wrapper, "trialCount", 3);
    setField(wrapper, "systemPrompt", "Answer from context only.");
    await submit(wrapper);

    expect(llmExperimentsService.create).toHaveBeenCalledTimes(1);
    const [org, payload] = (llmExperimentsService.create as any).mock.calls[0];
    expect(org).toBe("test-org");
    expect(payload.name).toBe("prompt v4 probe");
    expect(payload.datasetId).toBe("ds-1");
    expect(payload.datasetVersion).toBe(12);
    expect(typeof payload.trialCount).toBe("number");
    expect(payload.trialCount).toBe(3);
    expect(payload.task.type).toBe("inline_prompt");
    expect(payload.task.params).toEqual({ temperature: 0 });
    expect(payload.task.messages).toEqual([
      { role: "system", content: "Answer from context only." },
      { role: "user", content: "{{ input }}" },
    ]);
    // No schema-only keys leak into the request body.
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("sources");
    expect(payload).not.toHaveProperty("userPrompt");
  });

  it("omits the system message when it is blank", async () => {
    wrapper = await createWrapper();
    fillValid(wrapper);
    await submit(wrapper);
    const [, payload] = (llmExperimentsService.create as any).mock.calls[0];
    expect(payload.task.params).toEqual({ temperature: 0 });
    expect(payload.task.messages).toEqual([{ role: "user", content: "{{ input }}" }]);
  });

  it("sends a source filter only when sources are chosen", async () => {
    wrapper = await createWrapper();
    fillValid(wrapper);
    await submit(wrapper);
    expect((llmExperimentsService.create as any).mock.calls[0][1].datasetFilter).toBeNull();

    setField(wrapper, "sources", ["annotation"]);
    await submit(wrapper);
    expect((llmExperimentsService.create as any).mock.calls[1][1].datasetFilter).toEqual({
      sources: ["annotation"],
    });
  });

  it("routes to the new experiment after creating it", async () => {
    wrapper = await createWrapper();
    fillValid(wrapper);
    await submit(wrapper);
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "aiExperiments",
        query: expect.objectContaining({ selected: "exp-1" }),
      }),
    );
  });

  // The actions live outside the scrolling columns (as in ScorerFormPage and
  // JobFormPage), so they stay on screen however long the form gets.
  it("keeps the actions outside the scrolling columns", async () => {
    wrapper = await createWrapper();
    const save = wrapper.find('[data-test="ai-experiment-form-submit-btn"]');
    const scrollingColumn = wrapper.find(".overflow-auto");
    expect(save.exists()).toBe(true);
    expect(scrollingColumn.element.contains(save.element)).toBe(false);
  });

  it("keeps Save enabled on an invalid form", async () => {
    wrapper = await createWrapper();
    await submit(wrapper);
    const save = wrapper.find('[data-test="ai-experiment-form-submit-btn"]');
    expect(save.exists()).toBe(true);
    expect(save.attributes("disabled")).toBeUndefined();
  });

  // Name and description are labelled fields inside Identity, not inline-edits
  // in the page header — same shape as the New LLM Judge Scorer form.
  it("puts name, description and the dataset in one Identity section", async () => {
    wrapper = await createWrapper();
    const identity = wrapper.find('[data-test="ai-experiment-form-identity-section"]');
    expect(identity.exists()).toBe(true);

    for (const field of ["name-input", "description-input", "dataset-select"]) {
      const el = wrapper.find(`[data-test="ai-experiment-form-${field}"]`);
      expect(el.exists()).toBe(true);
      expect(identity.element.contains(el.element)).toBe(true);
    }

    // The heading is static text; the name is not the page title.
    const title = wrapper.find('[data-test="ai-experiment-form-title"]');
    expect(title.exists()).toBe(true);
    expect(
      title.element.contains(wrapper.find('[data-test="ai-experiment-form-name-input"]').element),
    ).toBe(false);
  });

  // Task and Scorers are both required, so neither may sit behind a tab where
  // an untouched required field only surfaces as a validation error.
  it("shows the task and scorer sections at the same time", async () => {
    wrapper = await createWrapper();
    expect(wrapper.find('[data-test="ai-experiment-form-task-section"]').isVisible()).toBe(true);
    expect(wrapper.find('[data-test="ai-experiment-form-scorers-section"]').isVisible()).toBe(true);
  });

  // Inline prompt is the only task the backend accepts (validate_task_config
  // rejects remote and sdk), so the form must not offer a choice.
  it("offers no task-type picker", async () => {
    wrapper = await createWrapper();
    const section = wrapper.find('[data-test="ai-experiment-form-task-section"]');
    expect(section.findAll("[role='radio']").length).toBe(0);
    expect(section.text()).not.toContain("SDK");
    expect(wrapper.find('[data-test="ai-experiment-form-sdk-snippet"]').exists()).toBe(false);
  });

  // The backend accepts 1..100 (MAX_TRIAL_COUNT), so the field must not be
  // restricted to a fixed list.
  it("accepts any trial count the backend allows", async () => {
    wrapper = await createWrapper();
    fillValid(wrapper);
    setField(wrapper, "trialCount", 40);
    await submit(wrapper);
    expect((llmExperimentsService.create as any).mock.calls[0][1].trialCount).toBe(40);
  });

  it("rejects a trial count outside 1..100", async () => {
    wrapper = await createWrapper();
    fillValid(wrapper);
    setField(wrapper, "trialCount", 101);
    await submit(wrapper);
    expect(llmExperimentsService.create).not.toHaveBeenCalled();

    setField(wrapper, "trialCount", 0);
    await submit(wrapper);
    expect(llmExperimentsService.create).not.toHaveBeenCalled();
  });

  it("sends the chosen temperature in task.params", async () => {
    wrapper = await createWrapper();
    fillValid(wrapper);
    setField(wrapper, "temperature", 0.7);
    await submit(wrapper);
    const [, payload] = (llmExperimentsService.create as any).mock.calls[0];
    expect(payload.task.params).toEqual({ temperature: 0.7 });
    expect(typeof payload.task.params.temperature).toBe("number");
  });

  it("warns that trials are identical at temperature 0", async () => {
    wrapper = await createWrapper();
    setField(wrapper, "trialCount", 3);
    await flushPromises();
    expect(wrapper.find('[data-test="ai-experiment-form-task-section"]').text()).toContain(
      "At temperature 0 every trial returns the same answer",
    );
  });

  it("shows the resolved provider endpoint once a provider is chosen", async () => {
    wrapper = await createWrapper();
    expect(wrapper.find('[data-test="ai-experiment-form-provider-summary"]').exists()).toBe(false);
    setField(wrapper, "providerId", "pr-1");
    await flushPromises();
    const summary = wrapper.find('[data-test="ai-experiment-form-provider-summary"]');
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toContain("api.openai.com");
  });

  it("re-fetches the provider list from the refresh button", async () => {
    wrapper = await createWrapper();
    (onlineEvalsService.providers.list as any).mockClear();
    await wrapper.find('[data-test="ai-experiment-form-provider-refresh-btn"]').trigger("click");
    await flushPromises();
    expect(onlineEvalsService.providers.list).toHaveBeenCalledWith("test-org");
  });

  it("waits for a complete task before previewing, instead of reporting a failure", async () => {
    wrapper = await createWrapper();
    setField(wrapper, "datasetId", "ds-1");
    await flushPromises();
    expect(llmExperimentsService.preview).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="ai-experiment-form-preview"]').text()).toContain(
      "Finish the task section",
    );
  });
});
