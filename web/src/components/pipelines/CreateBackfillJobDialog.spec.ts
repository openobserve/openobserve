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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

installQuasar({ plugins: [Dialog, Notify] });

vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("quasar")>();
  return {
    ...actual,
    useQuasar: vi.fn(() => ({
      notify: vi.fn(),
      dialog: vi.fn(() => ({ onOk: vi.fn(), onCancel: vi.fn() })),
      dark: { isActive: false },
    })),
  };
});

vi.mock("@/services/backfill", () => ({
  default: {
    createBackfillJob: vi.fn().mockResolvedValue({ job_id: "new-job-id", message: "created" }),
  },
}));

vi.mock("@/components/DateTime.vue", () => ({
  default: {
    name: "DateTime",
    template: '<div data-test="time-range-picker" />',
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
// formData initial values
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – formData defaults", () => {
  beforeEach(() => vi.clearAllMocks());

  it("chunkPeriodMinutes defaults to 60 when scheduleFrequency is not provided", () => {
    const wrapper = createWrapper();
    expect((wrapper.vm as any).formData.chunkPeriodMinutes).toBe(60);
  });

  it("chunkPeriodMinutes defaults to scheduleFrequency when provided", () => {
    const wrapper = createWrapper({ scheduleFrequency: 30 });
    expect((wrapper.vm as any).formData.chunkPeriodMinutes).toBe(30);
  });

  it("startTimeMicros initializes to 0", () => {
    const wrapper = createWrapper();
    expect((wrapper.vm as any).formData.startTimeMicros).toBe(0);
  });

  it("endTimeMicros initializes to 0", () => {
    const wrapper = createWrapper();
    expect((wrapper.vm as any).formData.endTimeMicros).toBe(0);
  });

  it("deleteBeforeBackfill initializes to false", () => {
    const wrapper = createWrapper();
    expect((wrapper.vm as any).formData.deleteBeforeBackfill).toBe(false);
  });

  it("delayBetweenChunks initializes to null", () => {
    const wrapper = createWrapper();
    expect((wrapper.vm as any).formData.delayBetweenChunks).toBeNull();
  });
});

// --------------------------------------------------------------------------
// updateDateTime
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – updateDateTime", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets startTimeMicros and endTimeMicros from the value object", async () => {
    const wrapper = createWrapper();
    (wrapper.vm as any).updateDateTime({
      startTime: 1_700_000_000_000_000,
      endTime: 1_700_003_600_000_000,
    });
    await nextTick();
    expect((wrapper.vm as any).formData.startTimeMicros).toBe(
      1_700_000_000_000_000
    );
    expect((wrapper.vm as any).formData.endTimeMicros).toBe(
      1_700_003_600_000_000
    );
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
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_000_000_000_000;
    await nextTick();
    expect((wrapper.vm as any).estimatedInfo).toBeNull();
  });

  it("returns an object with time and chunks for a valid time range", async () => {
    const wrapper = createWrapper();
    // 60-minute range, 60-minute chunk period → 1 chunk
    const start = 1_700_000_000_000_000;
    const end = start + 60 * 60 * 1_000_000; // +60 minutes in microseconds
    (wrapper.vm as any).formData.startTimeMicros = start;
    (wrapper.vm as any).formData.endTimeMicros = end;
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
    const start = 1_700_000_000_000_000;
    const end = start + 90 * 60 * 1_000_000;
    (wrapper.vm as any).formData.startTimeMicros = start;
    (wrapper.vm as any).formData.endTimeMicros = end;
    await nextTick();
    expect((wrapper.vm as any).estimatedInfo.chunks).toBe(3);
  });
});

// --------------------------------------------------------------------------
// onSubmit validation – driven through ODrawer @click:primary emit
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – onSubmit validation", () => {
  let notifyMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    notifyMock = vi.fn();
    const quasar = await import("quasar");
    vi.mocked(quasar.useQuasar).mockReturnValue({
      notify: notifyMock,
      dialog: vi.fn(() => ({ onOk: vi.fn(), onCancel: vi.fn() })),
      dark: { isActive: false },
    } as any);
  });

  it("calls notify with 'negative' when startTimeMicros <= 0", async () => {
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 0;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    await wrapper.findComponent(ODrawerStub).vm.$emit("click:primary");
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "negative" })
    );
  });

  it("calls notify with 'negative' when endTimeMicros <= 0", async () => {
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 0;
    await wrapper.findComponent(ODrawerStub).vm.$emit("click:primary");
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "negative" })
    );
  });

  it("calls notify with 'negative' when startTime >= endTime", async () => {
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 1_700_003_600_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_000_000_000_000;
    await wrapper.findComponent(ODrawerStub).vm.$emit("click:primary");
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "negative" })
    );
  });

  it("opens the delete confirmation ODialog when deleteBeforeBackfill is true and time range is valid", async () => {
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    (wrapper.vm as any).formData.deleteBeforeBackfill = true;
    await wrapper.findComponent(ODrawerStub).vm.$emit("click:primary");
    await flushPromises();
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
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    (wrapper.vm as any).formData.deleteBeforeBackfill = false;
    await wrapper.findComponent(ODrawerStub).vm.$emit("click:primary");
    await flushPromises();
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
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    (wrapper.vm as any).showDeleteConfirmation = true;
    await nextTick();
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
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    (wrapper.vm as any).showDeleteConfirmation = true;
    await (wrapper.vm as any).confirmDelete();
    await flushPromises();
    expect((wrapper.vm as any).showDeleteConfirmation).toBe(false);
    expect(backfillService.createBackfillJob).toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// createBackfillJobRequest
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – createBackfillJobRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls backfillService.createBackfillJob with correct payload", async () => {
    vi.mocked(backfillService.createBackfillJob).mockResolvedValue({
      job_id: "new-job-id",
      message: "created",
    });
    const wrapper = createWrapper({ pipelineId: "pipe-99" });
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    (wrapper.vm as any).formData.deleteBeforeBackfill = false;
    await (wrapper.vm as any).createBackfillJobRequest();
    await flushPromises();
    expect(backfillService.createBackfillJob).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "default",
        pipeline_id: "pipe-99",
        data: expect.objectContaining({
          start_time: 1_700_000_000_000_000,
          end_time: 1_700_003_600_000_000,
          delete_before_backfill: false,
        }),
      })
    );
  });

  it("emits 'success' with job_id on successful creation", async () => {
    vi.mocked(backfillService.createBackfillJob).mockResolvedValue({
      job_id: "new-job-id",
      message: "created",
    });
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    await (wrapper.vm as any).createBackfillJobRequest();
    await flushPromises();
    expect(wrapper.emitted("success")).toBeTruthy();
    expect(wrapper.emitted("success")![0]).toEqual(["new-job-id"]);
  });

  it("sets errorMessage when createBackfillJob rejects", async () => {
    vi.mocked(backfillService.createBackfillJob).mockRejectedValue({
      response: { data: { message: "Something went wrong" } },
    });
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    await (wrapper.vm as any).createBackfillJobRequest();
    await flushPromises();
    expect((wrapper.vm as any).errorMessage).toBe("Something went wrong");
  });

  it("sets loading to false after request completes (success)", async () => {
    vi.mocked(backfillService.createBackfillJob).mockResolvedValue({
      job_id: "new-job-id",
      message: "created",
    });
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    await (wrapper.vm as any).createBackfillJobRequest();
    await flushPromises();
    expect((wrapper.vm as any).loading).toBe(false);
  });

  it("sets loading to false after request completes (failure)", async () => {
    vi.mocked(backfillService.createBackfillJob).mockRejectedValue(
      new Error("network error")
    );
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    await (wrapper.vm as any).createBackfillJobRequest();
    await flushPromises();
    expect((wrapper.vm as any).loading).toBe(false);
  });

  it("forwards primaryButtonLoading=true to ODrawer while a request is in flight", async () => {
    let resolveFn: (val: any) => void = () => {};
    vi.mocked(backfillService.createBackfillJob).mockImplementation(
      () => new Promise((res) => { resolveFn = res; })
    );
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    const pending = (wrapper.vm as any).createBackfillJobRequest();
    await nextTick();
    expect(wrapper.findComponent(ODrawerStub).props("primaryButtonLoading")).toBe(
      true
    );
    resolveFn({ job_id: "new-job-id", message: "created" });
    await pending;
    await flushPromises();
    expect(wrapper.findComponent(ODrawerStub).props("primaryButtonLoading")).toBe(
      false
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
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    (wrapper.vm as any).showAdvanced = true;
    (wrapper.vm as any).errorMessage = "some error";
    await wrapper.findComponent(ODrawerStub).vm.$emit("click:secondary");
    await nextTick();
    expect((wrapper.vm as any).formData.startTimeMicros).toBe(0);
    expect((wrapper.vm as any).formData.endTimeMicros).toBe(0);
    expect((wrapper.vm as any).showAdvanced).toBe(false);
    expect((wrapper.vm as any).errorMessage).toBe("");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual([false]);
  });

  it("resetForm resets formData to initial values", async () => {
    const wrapper = createWrapper({ scheduleFrequency: 45 });
    (wrapper.vm as any).formData.startTimeMicros = 9_999_999;
    (wrapper.vm as any).formData.endTimeMicros = 9_999_999;
    (wrapper.vm as any).formData.chunkPeriodMinutes = 10;
    (wrapper.vm as any).formData.deleteBeforeBackfill = true;
    (wrapper.vm as any).showAdvanced = true;
    (wrapper.vm as any).errorMessage = "err";
    (wrapper.vm as any).resetForm();
    await nextTick();
    expect((wrapper.vm as any).formData.startTimeMicros).toBe(0);
    expect((wrapper.vm as any).formData.endTimeMicros).toBe(0);
    expect((wrapper.vm as any).formData.chunkPeriodMinutes).toBe(45);
    expect((wrapper.vm as any).formData.deleteBeforeBackfill).toBe(false);
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
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    (wrapper.vm as any).showAdvanced = true;
    await wrapper.setProps({ pipelineId: "pipe-2" });
    await nextTick();
    expect((wrapper.vm as any).formData.startTimeMicros).toBe(0);
    expect((wrapper.vm as any).formData.endTimeMicros).toBe(0);
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
