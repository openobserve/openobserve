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
        OPageHeader: true,
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

  it("saves a draft (create only) with the EXACT payload when the schema passes", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "  my-job  "); // padded → must be trimmed at save
    setField(wrapper, "stream", "default");
    setField(wrapper, "scorerIds", ["s1"]);
    // samplingValue defaults to "0.1" → conditional passes.
    await submit(wrapper);

    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.jobs.create).toHaveBeenCalledTimes(1);
    const [org, payload] = (onlineEvalsService.jobs.create as any).mock.calls[0];
    expect(org).toBe("test-org");
    // EXACT key set — catches any added / dropped / renamed / leaked key.
    expect(Object.keys(payload).sort()).toEqual([
      "description",
      "filterCondition",
      "inputMapping",
      "name",
      "samplingMode",
      "samplingValue",
      "scorers",
      "stream",
      "streamType",
    ]);
    expect(payload.name).toBe("my-job"); // trimmed at save
    expect(payload.description).toBeNull(); // blank → null
    expect(payload.stream).toBe("default");
    expect(payload.streamType).toBe("traces");
    expect(payload.scorers).toEqual([{ id: "s1", version: null }]);
    expect(payload.samplingMode).toBe("rate");
    // The sampling value leaves the text input as a STRING but must reach the
    // API as a NUMBER (JSON-parsed) — a type-drift regression guard.
    expect(payload.samplingValue).toBe(0.1);
    expect(typeof payload.samplingValue).toBe("number");
    expect(payload.filterCondition).toEqual({ type: "all" }); // empty filter
    expect(payload.inputMapping).toBeNull(); // no template vars → no mapping
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

  describe("edit mode", () => {
    const editRow: any = {
      id: "job-9",
      name: "existing-job",
      description: "watch prod",
      stream: "default",
    };

    it("prefills the form from the record", () => {
      wrapper = createWrapper({ mode: "edit", row: editRow });
      expect(oform(wrapper).form.state.values.name).toBe("existing-job");
      expect(oform(wrapper).form.state.values.stream).toBe("default");
      expect(oform(wrapper).form.state.values.description).toBe("watch prod");
    });

    it("routes edit through jobs.update (NOT create) with the record id and never activates", async () => {
      wrapper = createWrapper({ mode: "edit", row: editRow });
      // Guarantee a valid, submittable state independent of row-parsing details:
      // a scorer selection (guard) and a sampling mode that needs no value.
      setField(wrapper, "scorerIds", ["s1"]);
      setField(wrapper, "samplingMode", "all");
      await submit(wrapper);

      expect(oform(wrapper).form.state.isValid).toBe(true);
      // The edit path must NOT create and must NOT activate.
      expect(onlineEvalsService.jobs.create).not.toHaveBeenCalled();
      expect(onlineEvalsService.jobs.activate).not.toHaveBeenCalled();
      expect(onlineEvalsService.jobs.update).toHaveBeenCalledTimes(1);
      const [org, id, payload] = (onlineEvalsService.jobs.update as any).mock.calls[0];
      expect(org).toBe("test-org");
      expect(id).toBe("job-9");
      expect(payload.name).toBe("existing-job"); // name preserved (locked on edit)
      expect(payload.stream).toBe("default");
      expect(payload.samplingMode).toBe("all");
      expect(payload.samplingValue).toBeNull(); // mode 'all' → no sampling value
      expect(payload.scorers).toEqual([{ id: "s1", version: null }]);
      expect(wrapper.emitted("saved")).toBeTruthy();
    });
  });
});
