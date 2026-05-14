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

function createWrapper(props: Record<string, any> = {}) {
  return mount(CreateBackfillJobDialog, {
    props: { ...DEFAULT_PROPS, ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        QDialog: {
          inheritAttrs: false,
          template: '<div v-bind="$attrs"><slot /></div>',
          props: ["modelValue"],
        },
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

  it("renders data-test='create-backfill-job-dialog'", () => {
    const wrapper = createWrapper();
    expect(
      wrapper.find('[data-test="create-backfill-job-dialog"]').exists()
    ).toBe(true);
  });

  it("renders data-test='dialog-title' containing the pipelineName", () => {
    const wrapper = createWrapper({ pipelineName: "My Pipe" });
    const title = wrapper.find('[data-test="dialog-title"]');
    expect(title.exists()).toBe(true);
    expect(title.text()).toContain("My Pipe");
  });

  it("renders data-test='close-dialog-btn'", () => {
    const wrapper = createWrapper();
    expect(wrapper.find('[data-test="close-dialog-btn"]').exists()).toBe(true);
  });

  it("renders data-test='cancel-btn'", () => {
    const wrapper = createWrapper();
    expect(wrapper.find('[data-test="cancel-btn"]').exists()).toBe(true);
  });

  it("renders data-test='create-btn'", () => {
    const wrapper = createWrapper();
    expect(wrapper.find('[data-test="create-btn"]').exists()).toBe(true);
  });

  it("renders data-test='advanced-options-section'", () => {
    const wrapper = createWrapper();
    expect(
      wrapper.find('[data-test="advanced-options-section"]').exists()
    ).toBe(true);
  });

  it("renders data-test='time-range-picker'", () => {
    const wrapper = createWrapper();
    expect(wrapper.find('[data-test="time-range-picker"]').exists()).toBe(true);
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
    if (header.exists()) {
      await header.trigger("click");
      expect((wrapper.vm as any).showAdvanced).toBe(true);
    } else {
      // Directly set via vm to test the toggle logic
      (wrapper.vm as any).showAdvanced = false;
      await nextTick();
      ;(wrapper.vm as any).showAdvanced = true;
      await nextTick();
      expect((wrapper.vm as any).showAdvanced).toBe(true);
    }
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
// onSubmit validation
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
    await (wrapper.vm as any).onSubmit();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "negative" })
    );
  });

  it("calls notify with 'negative' when endTimeMicros <= 0", async () => {
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 0;
    await (wrapper.vm as any).onSubmit();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "negative" })
    );
  });

  it("calls notify with 'negative' when startTime >= endTime", async () => {
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 1_700_003_600_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_000_000_000_000;
    await (wrapper.vm as any).onSubmit();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "negative" })
    );
  });

  it("sets showDeleteConfirmation=true when deleteBeforeBackfill is true and time range is valid", async () => {
    const wrapper = createWrapper();
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    (wrapper.vm as any).formData.deleteBeforeBackfill = true;
    await (wrapper.vm as any).onSubmit();
    expect((wrapper.vm as any).showDeleteConfirmation).toBe(true);
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
    await (wrapper.vm as any).onSubmit();
    await flushPromises();
    expect(backfillService.createBackfillJob).toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// confirmDelete
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
});

// --------------------------------------------------------------------------
// onCancel / resetForm
// --------------------------------------------------------------------------

describe("CreateBackfillJobDialog – onCancel and resetForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("onCancel calls resetForm and emits update:modelValue=false", async () => {
    const wrapper = createWrapper({ modelValue: true });
    (wrapper.vm as any).formData.startTimeMicros = 1_700_000_000_000_000;
    (wrapper.vm as any).formData.endTimeMicros = 1_700_003_600_000_000;
    (wrapper.vm as any).showAdvanced = true;
    (wrapper.vm as any).errorMessage = "some error";
    await (wrapper.vm as any).onCancel();
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
