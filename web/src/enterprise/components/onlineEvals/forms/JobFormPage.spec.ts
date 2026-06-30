// @vitest-environment jsdom
// Copyright 2026 OpenObserve Inc.
//
// Behavior tests for JobFormPage after the OForm + Zod migration
// (online-evals-migration.md row 66). At least one test mounts the REAL <OForm>
// and proves the schema gates an empty submit (name/stream required +
// sampling-value conditional), and that the onSubmit guard blocks an empty
// scorer selection with a toast (the composite picker has no inline error slot),
// so an unwired `:schema` would be caught. Also covers the two create-mode
// submit paths (draft / activate).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import JobFormPage from "./JobFormPage.vue";
import onlineEvalsService from "@/services/online-evals.service";
import { toast } from "@/lib/feedback/Toast/useToast";
import i18n from "@/locales";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

vi.mock("@/services/online-evals.service", () => ({
  default: {
    jobs: {
      create: vi.fn(),
      update: vi.fn(),
      activate: vi.fn(),
    },
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({ list: [{ name: "default" }] }),
  }),
}));

const store = createStore({
  state: { theme: "light", selectedOrganization: { identifier: "test-org" } },
});

const scorers = [{ id: "s1", entityId: "s1", name: "Scorer 1" }];

function createWrapper(props: Record<string, any> = {}) {
  return mount(JobFormPage, {
    props: {
      orgId: "test-org",
      mode: "create",
      row: null,
      scorers,
      ...props,
    },
    global: {
      plugins: [store, i18n],
      stubs: {
        AppPageHeader: true,
        JobScorerPicker: true,
        JobFilterBuilder: true,
        JobInputMapping: true,
        JobPreviewPanel: true,
      },
    },
  });
}

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

describe("JobFormPage", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (onlineEvalsService.jobs.create as any).mockResolvedValue({ id: "job-1" });
    (onlineEvalsService.jobs.update as any).mockResolvedValue({});
    (onlineEvalsService.jobs.activate as any).mockResolvedValue({});
  });
  afterEach(() => wrapper?.unmount());

  it("renders the real OForm with the name + stream fields", () => {
    wrapper = createWrapper();
    expect(wrapper.findComponent({ name: "OForm" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="job-form-name-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="job-form-stream-select"]').exists()).toBe(true);
  });

  it("keeps the create buttons enabled before first submit (R3)", () => {
    wrapper = createWrapper();
    const draft = wrapper.find('[data-test="job-form-save-draft-btn"]');
    expect(draft.attributes("disabled")).toBeUndefined();
    expect(oform(wrapper).form.state.isValid).toBe(true);
  });

  it("blocks submit and does NOT call the service when required fields are empty", async () => {
    wrapper = createWrapper();
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.jobs.create).not.toHaveBeenCalled();
  });

  it("blocks an empty scorer selection with a toast (manual guard, no save)", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "my-job");
    setField(wrapper, "stream", "default");
    // scorerIds left empty → schema PASSES, but the onSubmit guard toasts + blocks.
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.jobs.create).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "Select at least one scorer" }),
    );
  });

  it("requires a sampling value unless mode is 'all'", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "my-job");
    setField(wrapper, "stream", "default");
    setField(wrapper, "scorerIds", ["s1"]);
    setField(wrapper, "samplingMode", "rate");
    setField(wrapper, "samplingValue", "");
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.jobs.create).not.toHaveBeenCalled();
  });

  it("saves a draft (create only) when the schema passes", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "my-job");
    setField(wrapper, "stream", "default");
    setField(wrapper, "scorerIds", ["s1"]);
    // samplingValue defaults to "0.1" → conditional passes.
    await submit(wrapper);

    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.jobs.create).toHaveBeenCalledTimes(1);
    const [org, payload] = (onlineEvalsService.jobs.create as any).mock.calls[0];
    expect(org).toBe("test-org");
    expect(payload.name).toBe("my-job");
    expect(payload.stream).toBe("default");
    expect(payload.scorers).toEqual([{ id: "s1", version: null }]);
    // draft path → no activation
    expect(onlineEvalsService.jobs.activate).not.toHaveBeenCalled();
    expect(wrapper.emitted("saved")).toBeTruthy();
  });

  it("creates AND activates via the 'Create & activate' submit button", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "my-job");
    setField(wrapper, "stream", "default");
    setField(wrapper, "scorerIds", ["s1"]);
    // The activate button's @click sets the activate flag; drive the form's own
    // submit deterministically (jsdom doesn't auto-submit on button click).
    await wrapper.find('[data-test="job-form-save-activate-btn"]').trigger("click");
    await submit(wrapper);

    expect(onlineEvalsService.jobs.create).toHaveBeenCalledTimes(1);
    expect(onlineEvalsService.jobs.activate).toHaveBeenCalledWith("test-org", "job-1");
  });
});
