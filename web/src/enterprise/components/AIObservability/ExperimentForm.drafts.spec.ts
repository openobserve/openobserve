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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { createStore } from "vuex";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import OForm from "@/lib/forms/Form/OForm.vue";
import llmExperimentsService from "@/services/llm-experiments.service";
import llmDatasetsService from "@/services/llm-datasets.service";
import llmPromptsService from "@/services/llm-prompts.service";
import remoteTasksService from "@/services/remote-tasks.service";
import onlineEvalsService from "@/services/online-evals.service";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { fillField } from "@/test/unit/helpers/fillField";
import ExperimentForm from "./ExperimentForm.vue";
import {
  experimentFormDefaults,
  type ExperimentForm as ExperimentFormValues,
} from "./ExperimentForm.schema";

vi.mock("@/services/llm-experiments.service", () => ({
  default: { create: vi.fn(), preview: vi.fn(), get: vi.fn(), clone: vi.fn() },
}));
vi.mock("@/services/llm-datasets.service", async () => ({
  ...(await vi.importActual<typeof import("@/services/llm-datasets.service")>(
    "@/services/llm-datasets.service",
  )),
  default: { list: vi.fn(), listItems: vi.fn() },
}));
vi.mock("@/services/online-evals.service", () => ({
  default: { scorers: { list: vi.fn() }, providers: { list: vi.fn() } },
}));
vi.mock("@/services/llm-prompts.service", () => ({
  default: { list: vi.fn(), resolve: vi.fn() },
}));
vi.mock("@/services/remote-tasks.service", () => ({ default: { list: vi.fn() } }));

interface FormApi {
  setFieldValue: (field: string, value: unknown) => void;
  handleSubmit: () => Promise<void>;
  state: { values: ExperimentFormValues };
}

const newScope: EditorDraftScope = {
  kind: "experiment",
  org: "test-org",
  entityId: null,
  userEmail: "me@x.io",
};
const cloneScope: EditorDraftScope = { ...newScope, entityId: "exp-source" };

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
};
const provider = { id: "pe-1", name: "Production OpenAI", availableModels: ["gpt-4o"] };
const previewResult = {
  datasetId: "ds-1",
  datasetVersion: 12,
  rowCount: 128,
  trialCount: 1,
  slotCount: 128,
  pinnedScorers: [{ id: "sc-1", version: 2 }],
  sampleSlots: [],
};
const source = {
  id: "exp-source",
  name: "prompt v3 probe",
  description: "the run we are iterating on",
  datasetId: "ds-1",
  datasetVersion: 9,
  datasetFilter: null,
  task: {
    type: "inline_prompt",
    messages: [{ role: "user", content: "Summarise {{ input }}" }],
    providerId: "pe-1",
    model: "gpt-4o",
    params: { temperature: 0.7 },
  },
  scorers: [{ id: "sc-1", version: 2 }],
  trialCount: 3,
  status: "running",
};

const store = createStore({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "test-org" },
    userInfo: { email: "me@x.io" },
    timezone: "UTC",
  },
});

let router: Router;
let wrapper: VueWrapper | null = null;

const mountForm = async (query = "") => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/ai/experiments/new", name: "aiExperimentCreate", component: ExperimentForm },
      { path: "/ai/experiments", name: "aiExperiments", component: { render: () => h("div") } },
      { path: "/settings/llm", name: "llmProviders", component: { render: () => h("div") } },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push(`/ai/experiments/new${query}`);
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins: [router, store, i18n] } },
  );
  await flushPromises();
};

const form = () => (wrapper!.findComponent(OForm).vm as unknown as { form: FormApi }).form;

const edit = async (field: string, value: unknown) => {
  window.dispatchEvent(new Event("pointerdown"));
  form().setFieldValue(field, value);
  await nextTick();
};

const fillValid = async () => {
  await edit("name", "prompt v4 probe");
  await edit("datasetId", "ds-1");
  await edit("providerId", "pe-1");
  await edit("scorerIds", ["sc-1"]);
  await flushPromises();
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );

describe("ExperimentForm drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(llmDatasetsService.list).mockResolvedValue([dataset] as never);
    vi.mocked(llmDatasetsService.listItems).mockResolvedValue({
      items: [],
      total: 0,
      from: 0,
      size: 0,
      hasMore: false,
    } as never);
    vi.mocked(onlineEvalsService.scorers.list).mockResolvedValue([scorer] as never);
    vi.mocked(onlineEvalsService.providers.list).mockResolvedValue([provider] as never);
    vi.mocked(llmExperimentsService.preview).mockResolvedValue(previewResult as never);
    vi.mocked(llmExperimentsService.create).mockResolvedValue({
      experiment: { id: "exp-1" },
      preview: previewResult,
      created: true,
    } as never);
    vi.mocked(llmExperimentsService.get).mockResolvedValue({ experiment: source } as never);
    vi.mocked(llmExperimentsService.clone).mockResolvedValue({ id: "exp-copy" } as never);
    vi.mocked(llmPromptsService.list).mockResolvedValue([]);
    vi.mocked(remoteTasksService.list).mockResolvedValue([]);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("writes a new experiment's draft when the page hides", async () => {
    await mountForm();
    await edit("name", "draft run");
    window.dispatchEvent(new Event("pagehide"));

    expect(readEditorDraft<ExperimentFormValues>(newScope)?.data).toMatchObject({
      name: "draft run",
      taskType: "inline_prompt",
    });
  });

  it("drafts and guards a new experiment filled with no key or pointer event (autofill, fill())", async () => {
    await mountForm();
    await fillField("ai-experiment-form-name-input", "filled run");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<ExperimentFormValues>(newScope)?.data.name).toBe("filled run");

    const navigation = router.push("/logs");
    await flushPromises();
    expect(document.body.querySelector('[data-test="editor-draft-leave-dialog"]')).not.toBeNull();
    document.body
      .querySelector<HTMLElement>(
        '[data-test="editor-draft-leave-dialog"] [data-test="o-dialog-close-btn"]',
      )
      ?.click();
    await navigation;
    expect(router.currentRoute.value.name).toBe("aiExperimentCreate");
  });

  it("offers a saved draft on open and continues it", async () => {
    writeEditorDraft(newScope, {
      data: { ...experimentFormDefaults("ds-1"), name: "restored run", trialCount: 4 },
    });
    await mountForm();

    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain(
      "unsaved changes to this experiment",
    );
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    expect(form().state.values).toMatchObject({
      name: "restored run",
      datasetId: "ds-1",
      trialCount: 4,
    });
  });

  it("a continued managed-prompt draft keeps its own model and temperature", async () => {
    vi.mocked(llmPromptsService.list).mockResolvedValue([
      { entityId: "prompt-a", name: "triage", status: "active", latestVersion: 3 },
    ] as never);
    vi.mocked(llmPromptsService.resolve).mockResolvedValue({
      prompt: { entityId: "prompt-a", name: "triage" },
      version: { version: 3, config: { model: "gpt-4o", params: { temperature: 0.2 } } },
    } as never);
    writeEditorDraft(newScope, {
      data: {
        ...experimentFormDefaults("ds-1"),
        taskType: "prompt_ref",
        promptId: "prompt-a",
        providerId: "pe-1",
        model: "gpt-4o-mini",
        temperature: 0.9,
      },
    });
    await mountForm();
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    expect(llmPromptsService.resolve).toHaveBeenCalled();
    expect(form().state.values).toMatchObject({
      promptId: "prompt-a",
      promptVersion: "3",
      model: "gpt-4o-mini",
      temperature: 0.9,
    });
  });

  it("keys a clone's draft by its source run and hashes only the source definition", async () => {
    await mountForm("?clone_of=exp-source");
    await edit("trialCount", 5);
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<ExperimentFormValues>(cloneScope);
    expect(draft?.data).toMatchObject({ name: "prompt v3 probe (Copy)", trialCount: 5 });
    const { status: _status, ...definition } = source;
    expect(draft?.baseHash).toBe(hashDraftValue(definition));
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("back with unsaved changes asks, and discard leaves and drops the draft", async () => {
    await mountForm();
    await edit("name", "to discard");
    window.dispatchEvent(new Event("pagehide"));

    byTest("ai-experiment-form-back-btn")?.click();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();

    leaveButton("o-dialog-neutral-btn")?.click();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("aiExperiments");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("save from the leave dialog creates without opening the list, then goes on", async () => {
    await mountForm();
    await fillValid();

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;
    await flushPromises();

    expect(llmExperimentsService.create).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("save from the leave dialog stays when the form is invalid", async () => {
    await mountForm();
    await edit("name", "no dataset yet");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;
    await flushPromises();

    expect(llmExperimentsService.create).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("aiExperimentCreate");
  });

  it("keep draft lets the route leave and keeps the work", async () => {
    await mountForm();
    await edit("name", "kept run");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("o-dialog-secondary-btn")?.click();
    await navigation;

    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft<ExperimentFormValues>(newScope)?.data.name).toBe("kept run");
  });

  it("a normal create drops the draft and opens the list without asking", async () => {
    await mountForm();
    await fillValid();
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).not.toBeNull();

    await form().handleSubmit();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("aiExperiments");
    expect(router.currentRoute.value.query.selected).toBe("exp-1");
    expect(readEditorDraft(newScope)).toBeNull();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });
});
