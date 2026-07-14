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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";


vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/services/backfill", () => ({
  default: {
    createBackfillJob: vi.fn().mockResolvedValue({ job_id: "new-job-id", message: "created" }),
  },
}));

vi.mock("@/components/DateTime.vue", () => ({
  default: {
    name: "DateTime",
    template: '<div data-test="time-range-picker" />',
    props: ["defaultType", "defaultAbsoluteTime", "defaultRelativeTime"],
    emits: ["on:date-change"],
    methods: {
      resetTime: vi.fn(),
    },
  },
}));

import CreateBackfillJobDialog from "./CreateBackfillJobDialog.vue";
import backfillService from "@/services/backfill";

const DEFAULT_PROPS = {
  modelValue: false,
  pipelineId: "pipe-1",
  pipelineName: "Test Pipeline",
};

// A valid absolute time range (from < to, both > 0) in microseconds.
const VALID_FROM = 1_700_000_000_000_000;
const VALID_TO = 1_700_003_600_000_000;
const validRange = () => ({ type: "absolute", from: VALID_FROM, to: VALID_TO });

// Stub for ODrawer/ODialog: forwards props, exposes all named slots so the
// inner template renders, and emits the same click:primary / click:secondary
// / click:neutral / update:open events as the real components.
const ODrawerStub = {
  name: "ODrawer",
  template: `
    <div class="o-drawer-stub" :data-open="open" data-test="create-backfill-job-dialog">
      <div class="o-drawer-stub__header">
        <slot name="header" />
        <slot name="header-left" />
        <slot name="header-right" />
      </div>
      <div class="o-drawer-stub__body"><slot /></div>
      <div class="o-drawer-stub__footer"><slot name="footer" /></div>
      <button
        type="button"
        data-test="stub-secondary-btn"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
      <button
        type="button"
        data-test="stub-primary-btn"
        :disabled="primaryButtonDisabled || primaryButtonLoading"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
    </div>
  `,
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "formId",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
};

const ODialogStub = {
  name: "ODialog",
  template: `
    <div class="o-dialog-stub" :data-open="open" data-test="delete-confirmation-dialog">
      <div class="o-dialog-stub__header"><slot name="header" /></div>
      <div class="o-dialog-stub__body"><slot /></div>
      <div class="o-dialog-stub__footer"><slot name="footer" /></div>
      <button
        type="button"
        data-test="stub-dialog-secondary-btn"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
      <button
        type="button"
        data-test="stub-dialog-primary-btn"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
    </div>
  `,
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
};

function createWrapper(props: Record<string, any> = {}) {
  return mount(CreateBackfillJobDialog, {
    props: { ...DEFAULT_PROPS, ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: ODrawerStub,
        ODialog: ODialogStub,
      },
    },
  });
}

// Form helpers — everything (timerange/chunk/delay/deleteBeforeBackfill) is
// form-owned now. The footer Save submits via form-id; tests drive the form's
// own handleSubmit() so the validate → @submit → save chain is awaited.
const setField = (w: any, name: string, val: unknown) =>
  (w.vm as any).form.setFieldValue(name, val);
const formVals = (w: any) => (w.vm as any).form.state.values;
const setRange = (w: any, range: unknown) => setField(w, "timerange", range);
const submitForm = async (w: any) => {
  await (w.vm as any).form.handleSubmit();
  await flushPromises();
};

// --------------------------------------------------------------------------
// Mount & basic structure
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – mount and structure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mounts without errors", () => {
    const wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
  });

  it("renders data-test='create-backfill-job-dialog' (ODrawer root)", () => {
    const wrapper = createWrapper();
    expect(
      wrapper.find('[data-test="create-backfill-job-dialog"]').exists()
    ).toBe(true);
  });

  it("passes the pipeline name to the ODrawer header-right slot", () => {
    const wrapper = createWrapper({ pipelineName: "My Pipe" });
    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.exists()).toBe(true);
    // pipelineName is rendered in the header-right slot
    expect(drawer.text()).toContain("My Pipe");
  });

  it("forwards the static title 'Create Backfill Job for' to ODrawer", () => {
    const wrapper = createWrapper();
    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props("title")).toBe("Create Backfill Job for");
  });

  it("forwards 'Cancel' as the secondary button label", () => {
    const wrapper = createWrapper();
    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props("secondaryButtonLabel")).toBe("Cancel");
  });

  it("forwards 'Create Backfill Job' as the primary button label", () => {
    const wrapper = createWrapper();
    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props("primaryButtonLabel")).toBe("Create Backfill Job");
  });

  it("forwards width=47 to ODrawer", () => {
    const wrapper = createWrapper();
    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props("width")).toBe(47);
  });

  it("renders data-test='advanced-options-section' inside the default slot", () => {
    const wrapper = createWrapper();
    expect(
      wrapper.find('[data-test="advanced-options-section"]').exists()
    ).toBe(true);
  });

  it("renders data-test='time-range-picker' (DateTime) inside the default slot", () => {
    const wrapper = createWrapper();
    expect(wrapper.find('[data-test="time-range-picker"]').exists()).toBe(true);
  });

  it("binds the open prop on ODrawer from props.modelValue", async () => {
    const wrapper = createWrapper({ modelValue: true });
    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props("open")).toBe(true);

    await wrapper.setProps({ modelValue: false });
    expect(drawer.props("open")).toBe(false);
  });
});

// --------------------------------------------------------------------------
// showAdvanced initial state
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – showAdvanced", () => {
  beforeEach(() => vi.clearAllMocks());

  it("showAdvanced is false by default", () => {
    const wrapper = createWrapper();
    expect((wrapper.vm as any).showAdvanced).toBe(false);
  });

  it("clicking the advanced section header toggles showAdvanced to true", async () => {
    const wrapper = createWrapper();
    const header = wrapper.find(
      '[data-test="advanced-options-section"] .section-header'
    );
    expect(header.exists()).toBe(true);
    await header.trigger("click");
    expect((wrapper.vm as any).showAdvanced).toBe(true);
  });
});

// --------------------------------------------------------------------------
// form defaults
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – form defaults", () => {
  beforeEach(() => vi.clearAllMocks());

  it("form chunkPeriodMinutes defaults to 60 when scheduleFrequency is not provided", () => {
    const wrapper = createWrapper();
    expect(formVals(wrapper).chunkPeriodMinutes).toBe(60);
  });

  it("form chunkPeriodMinutes defaults to scheduleFrequency when provided", () => {
    const wrapper = createWrapper({ scheduleFrequency: 30 });
    expect(formVals(wrapper).chunkPeriodMinutes).toBe(30);
  });

  it("timerange initializes to an empty absolute range", () => {
    const wrapper = createWrapper();
    expect(formVals(wrapper).timerange).toEqual({
      type: "absolute",
      from: undefined,
      to: undefined,
    });
  });

  it("form deleteBeforeBackfill initializes to false", () => {
    const wrapper = createWrapper();
    expect(formVals(wrapper).deleteBeforeBackfill).toBe(false);
  });

  it("form delayBetweenChunks initializes to null", () => {
    const wrapper = createWrapper();
    expect(formVals(wrapper).delayBetweenChunks).toBeNull();
  });
});

// --------------------------------------------------------------------------
// timerange field
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – timerange field", () => {
  beforeEach(() => vi.clearAllMocks());

  it("setFieldValue('timerange', ...) updates the form value", async () => {
    const wrapper = createWrapper();
    setRange(wrapper, validRange());
    await nextTick();
    expect(formVals(wrapper).timerange.from).toBe(VALID_FROM);
    expect(formVals(wrapper).timerange.to).toBe(VALID_TO);
  });
});

// --------------------------------------------------------------------------
// estimatedInfo computed
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – estimatedInfo computed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no time range is set", () => {
    const wrapper = createWrapper();
    expect((wrapper.vm as any).estimatedInfo).toBeNull();
  });

  it("returns null when start equals end", async () => {
    const wrapper = createWrapper();
    setRange(wrapper, { type: "absolute", from: VALID_FROM, to: VALID_FROM });
    await nextTick();
    expect((wrapper.vm as any).estimatedInfo).toBeNull();
  });

  it("returns an object with time and chunks for a valid time range", async () => {
    const wrapper = createWrapper();
    // 60-minute range, 60-minute chunk period → 1 chunk
    const start = VALID_FROM;
    const end = start + 60 * 60 * 1_000_000; // +60 minutes in microseconds
    setRange(wrapper, { type: "absolute", from: start, to: end });
    await nextTick();
    const info = (wrapper.vm as any).estimatedInfo;
    expect(info).not.toBeNull();
    expect(typeof info.time).toBe("string");
    expect(typeof info.chunks).toBe("number");
    expect(info.chunks).toBeGreaterThan(0);
  });

  it("estimated chunks equals ceiling of diffMinutes / chunkPeriod", async () => {
    const wrapper = createWrapper({ scheduleFrequency: 30 });
    // 90-minute range, 30-minute chunk → 3 chunks
    const start = VALID_FROM;
    const end = start + 90 * 60 * 1_000_000;
    setRange(wrapper, { type: "absolute", from: start, to: end });
    await nextTick();
    expect((wrapper.vm as any).estimatedInfo.chunks).toBe(3);
  });
});

// --------------------------------------------------------------------------
// onSubmit validation – driven via the real OForm submit (schema-gated)
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – onSubmit validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks submit + renders 'Please select a valid time range' when from <= 0", async () => {
    const wrapper = createWrapper();
    setRange(wrapper, { type: "absolute", from: 0, to: VALID_TO });
    await submitForm(wrapper);
    expect((wrapper.vm as any).form.state.isValid).toBe(false);
    expect((wrapper.vm as any).timerangeError).toBe(
      "Please select a valid time range"
    );
    expect(wrapper.text()).toContain("Please select a valid time range");
    expect(backfillService.createBackfillJob).not.toHaveBeenCalled();
  });

  it("blocks submit + renders 'Please select a valid time range' when to <= 0", async () => {
    const wrapper = createWrapper();
    setRange(wrapper, { type: "absolute", from: VALID_FROM, to: 0 });
    await submitForm(wrapper);
    expect((wrapper.vm as any).form.state.isValid).toBe(false);
    expect((wrapper.vm as any).timerangeError).toBe(
      "Please select a valid time range"
    );
    expect(backfillService.createBackfillJob).not.toHaveBeenCalled();
  });

  it("blocks submit + renders 'Start time must be before end time' when from >= to", async () => {
    const wrapper = createWrapper();
    setRange(wrapper, { type: "absolute", from: VALID_TO, to: VALID_FROM });
    await submitForm(wrapper);
    expect((wrapper.vm as any).form.state.isValid).toBe(false);
    expect((wrapper.vm as any).timerangeError).toBe(
      "Start time must be before end time"
    );
    expect(wrapper.text()).toContain("Start time must be before end time");
    expect(backfillService.createBackfillJob).not.toHaveBeenCalled();
  });

  it("opens the delete confirmation ODialog when deleteBeforeBackfill is true and time range is valid", async () => {
    const wrapper = createWrapper();
    setRange(wrapper, validRange());
    setField(wrapper, "deleteBeforeBackfill", true);
    await submitForm(wrapper);
    expect((wrapper.vm as any).showDeleteConfirmation).toBe(true);
    // ODialog stub receives open=true
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(true);
  });

  it("calls createBackfillJob directly when deleteBeforeBackfill is false and time range is valid", async () => {
    vi.mocked(backfillService.createBackfillJob).mockResolvedValue({
      job_id: "new-job-id",
      message: "created",
    });
    const wrapper = createWrapper();
    setRange(wrapper, validRange());
    setField(wrapper, "deleteBeforeBackfill", false);
    await submitForm(wrapper);
    expect(backfillService.createBackfillJob).toHaveBeenCalled();
  });

  it("blocks submit (no save) when chunkPeriodMinutes is out of range", async () => {
    const wrapper = createWrapper();
    setRange(wrapper, validRange());
    setField(wrapper, "chunkPeriodMinutes", 5000);
    await submitForm(wrapper);
    expect((wrapper.vm as any).form.state.isValid).toBe(false);
    expect(backfillService.createBackfillJob).not.toHaveBeenCalled();
  });

  it("blocks submit when delayBetweenChunks is out of range", async () => {
    const wrapper = createWrapper();
    setRange(wrapper, validRange());
    setField(wrapper, "delayBetweenChunks", 99999);
    await submitForm(wrapper);
    expect((wrapper.vm as any).form.state.isValid).toBe(false);
    expect(backfillService.createBackfillJob).not.toHaveBeenCalled();
  });

  // Numeric semantics match main: only null/undefined skip the range check. 0
  // coerces into the [min,max] check and FAILS (main did `Number(v) < min`, and
  // `0 < 1` is true), so submit is blocked. Asserted through the REAL schema.
  it("blocks submit when chunkPeriodMinutes and delayBetweenChunks are 0", async () => {
    const wrapper = createWrapper();
    setRange(wrapper, validRange());
    setField(wrapper, "chunkPeriodMinutes", 0);
    setField(wrapper, "delayBetweenChunks", 0);
    setField(wrapper, "deleteBeforeBackfill", false);
    await submitForm(wrapper);
    expect((wrapper.vm as any).form.state.isValid).toBe(false);
    expect(backfillService.createBackfillJob).not.toHaveBeenCalled();
  });

  it("saves at the inclusive numeric bounds (chunk=1440, delay=3600)", async () => {
    const wrapper = createWrapper();
    setRange(wrapper, validRange());
    setField(wrapper, "chunkPeriodMinutes", 1440);
    setField(wrapper, "delayBetweenChunks", 3600);
    setField(wrapper, "deleteBeforeBackfill", false);
    await submitForm(wrapper);
    expect((wrapper.vm as any).form.state.isValid).toBe(true);
    expect(backfillService.createBackfillJob).toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// Confirmation dialog (ODialog) interactions
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – delete-confirmation ODialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards 'Confirm Data Deletion' as the ODialog title", () => {
    const wrapper = createWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("title")).toBe("Confirm Data Deletion");
  });

  it("uses size='sm' and persistent on the confirmation ODialog", () => {
    const wrapper = createWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("size")).toBe("sm");
    // persistent is passed as an attribute without an explicit value, which
    // Vue coerces to "" — treat any non-falsy value as enabled.
    expect(dialog.props("persistent")).toBeDefined();
    expect(dialog.props("persistent")).not.toBeNull();
  });

  it("uses 'destructive' variant for the confirmation primary button", () => {
    const wrapper = createWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("primaryButtonVariant")).toBe("destructive");
  });

  it("closes the confirmation ODialog when click:secondary is emitted", async () => {
    const wrapper = createWrapper();
    (wrapper.vm as any).showDeleteConfirmation = true;
    await nextTick();
    await wrapper.findComponent(ODialogStub).vm.$emit("click:secondary");
    expect((wrapper.vm as any).showDeleteConfirmation).toBe(false);
  });

  it("calls confirmDelete (createBackfillJob + closes dialog) on click:primary", async () => {
    vi.mocked(backfillService.createBackfillJob).mockResolvedValue({
      job_id: "new-job-id",
      message: "created",
    });
    const wrapper = createWrapper();
    // Submit with delete enabled → stashes the validated value + opens dialog.
    setRange(wrapper, validRange());
    setField(wrapper, "deleteBeforeBackfill", true);
    await submitForm(wrapper);
    expect((wrapper.vm as any).showDeleteConfirmation).toBe(true);
    await wrapper.findComponent(ODialogStub).vm.$emit("click:primary");
    await flushPromises();
    expect((wrapper.vm as any).showDeleteConfirmation).toBe(false);
    expect(backfillService.createBackfillJob).toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// confirmDelete (direct VM call)
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – confirmDelete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls createBackfillJob and closes showDeleteConfirmation", async () => {
    vi.mocked(backfillService.createBackfillJob).mockResolvedValue({
      job_id: "new-job-id",
      message: "created",
    });
    const wrapper = createWrapper();
    // Submit with delete enabled to stash the pending validated value.
    setRange(wrapper, validRange());
    setField(wrapper, "deleteBeforeBackfill", true);
    await submitForm(wrapper);
    await (wrapper.vm as any).confirmDelete();
    await flushPromises();
    expect((wrapper.vm as any).showDeleteConfirmation).toBe(false);
    expect(backfillService.createBackfillJob).toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// createBackfillJobRequest (via real submit)
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – createBackfillJobRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls backfillService.createBackfillJob with correct payload", async () => {
    vi.mocked(backfillService.createBackfillJob).mockResolvedValue({
      job_id: "new-job-id",
      message: "created",
    });
    const wrapper = createWrapper({ pipelineId: "pipe-99" });
    setRange(wrapper, validRange());
    setField(wrapper, "deleteBeforeBackfill", false);
    await submitForm(wrapper);
    expect(backfillService.createBackfillJob).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "default",
        pipeline_id: "pipe-99",
        data: expect.objectContaining({
          start_time: VALID_FROM,
          end_time: VALID_TO,
          delete_before_backfill: false,
        }),
      })
    );
  });

  it("sends chunk_period_minutes / delay as numbers (not strings) when typed via OInput", async () => {
    vi.mocked(backfillService.createBackfillJob).mockResolvedValue({
      job_id: "new-job-id",
      message: "created",
    });
    const wrapper = createWrapper();
    // OForm-owned state (no more `formData`): seed the range via the form and
    // keep delete_before_backfill off so submit goes straight to createBackfillJobRequest.
    setRange(wrapper, validRange());
    setField(wrapper, "deleteBeforeBackfill", false);

    // Drive the real OInput. OFormInput binds OInput without a `.number` modifier,
    // so a type="number" field stores the RAW STRING; the number coercion happens
    // in createBackfillJobRequest (Number(...)) when building the payload.
    await wrapper
      .find('[data-test="chunk-period-input-field"]')
      .setValue("120");
    await wrapper
      .find('[data-test="delay-between-chunks-input-field"]')
      .setValue("15");
    await nextTick();

    // Form state holds the emitted strings (documents the coercion boundary).
    expect(formVals(wrapper).chunkPeriodMinutes).toBe("120");
    expect(formVals(wrapper).delayBetweenChunks).toBe("15");

    // Submit through the real form so onSubmit -> createBackfillJobRequest(value) runs.
    await submitForm(wrapper);
    await flushPromises();

    const payload = vi.mocked(backfillService.createBackfillJob).mock.calls[0][0]
      .data as Record<string, unknown>;
    expect(payload.chunk_period_minutes).toBe(120);
    expect(payload.delay_between_chunks_secs).toBe(15);
    expect(typeof payload.chunk_period_minutes).toBe("number");
    expect(typeof payload.delay_between_chunks_secs).toBe("number");
  });

  it("emits 'success' with job_id on successful creation", async () => {
    vi.mocked(backfillService.createBackfillJob).mockResolvedValue({
      job_id: "new-job-id",
      message: "created",
    });
    const wrapper = createWrapper();
    setRange(wrapper, validRange());
    await submitForm(wrapper);
    expect(wrapper.emitted("success")).toBeTruthy();
    expect(wrapper.emitted("success")![0]).toEqual(["new-job-id"]);
  });

  it("sets errorMessage when createBackfillJob rejects", async () => {
    vi.mocked(backfillService.createBackfillJob).mockRejectedValue({
      response: { data: { message: "Something went wrong" } },
    });
    const wrapper = createWrapper();
    setRange(wrapper, validRange());
    await submitForm(wrapper);
    expect((wrapper.vm as any).errorMessage).toBe("Something went wrong");
  });

  it("keeps the form submitting (form-driven spinner) while a request is in flight", async () => {
    let resolveFn: (val: any) => void = () => {};
    vi.mocked(backfillService.createBackfillJob).mockImplementation(
      () => new Promise((res) => { resolveFn = res; })
    );
    const wrapper = createWrapper();
    setRange(wrapper, validRange());
    // The awaited onSubmit keeps the form's isSubmitting (which the form-id
    // bridge mirrors onto the ODrawer footer spinner) true for the whole save.
    (wrapper.vm as any).form.handleSubmit();
    // The schema validates asynchronously — wait for the save to actually fire.
    await vi.waitFor(() =>
      expect(backfillService.createBackfillJob).toHaveBeenCalled()
    );
    expect((wrapper.vm as any).form.state.isSubmitting).toBe(true);
    resolveFn({ job_id: "new-job-id", message: "created" });
    await vi.waitFor(() =>
      expect((wrapper.vm as any).form.state.isSubmitting).toBe(false)
    );
  });
});

// --------------------------------------------------------------------------
// onCancel / resetForm – driven through ODrawer @click:secondary emit
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – onCancel and resetForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ODrawer click:secondary triggers reset + emits update:modelValue=false", async () => {
    const wrapper = createWrapper({ modelValue: true });
    setRange(wrapper, validRange());
    (wrapper.vm as any).showAdvanced = true;
    (wrapper.vm as any).errorMessage = "some error";
    await wrapper.findComponent(ODrawerStub).vm.$emit("click:secondary");
    await nextTick();
    expect(formVals(wrapper).timerange.from).toBeUndefined();
    expect(formVals(wrapper).timerange.to).toBeUndefined();
    expect((wrapper.vm as any).showAdvanced).toBe(false);
    expect((wrapper.vm as any).errorMessage).toBe("");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual([false]);
  });

  it("resetForm resets timerange + form values to initial values", async () => {
    const wrapper = createWrapper({ scheduleFrequency: 45 });
    setRange(wrapper, validRange());
    setField(wrapper, "chunkPeriodMinutes", 10);
    setField(wrapper, "deleteBeforeBackfill", true);
    (wrapper.vm as any).showAdvanced = true;
    (wrapper.vm as any).errorMessage = "err";
    (wrapper.vm as any).resetForm();
    await nextTick();
    expect(formVals(wrapper).timerange.from).toBeUndefined();
    expect(formVals(wrapper).timerange.to).toBeUndefined();
    expect(formVals(wrapper).chunkPeriodMinutes).toBe(45);
    expect(formVals(wrapper).deleteBeforeBackfill).toBe(false);
    expect((wrapper.vm as any).showAdvanced).toBe(false);
    expect((wrapper.vm as any).errorMessage).toBe("");
  });
});

// --------------------------------------------------------------------------
// pipelineId watcher
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – pipelineId watcher", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls resetForm when pipelineId prop changes", async () => {
    const wrapper = createWrapper({ pipelineId: "pipe-1" });
    setRange(wrapper, validRange());
    (wrapper.vm as any).showAdvanced = true;
    await wrapper.setProps({ pipelineId: "pipe-2" });
    await nextTick();
    expect(formVals(wrapper).timerange.from).toBeUndefined();
    expect(formVals(wrapper).timerange.to).toBeUndefined();
    expect((wrapper.vm as any).showAdvanced).toBe(false);
  });
});

// --------------------------------------------------------------------------
// v-model:open – update:modelValue propagation
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – v-model bridging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits update:modelValue when the ODrawer emits update:open=false", async () => {
    const wrapper = createWrapper({ modelValue: true });
    await wrapper.findComponent(ODrawerStub).vm.$emit("update:open", false);
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual([false]);
  });
});
