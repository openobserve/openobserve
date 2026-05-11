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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

vi.mock("../../services/backfill", () => ({
  default: {
    getBackfillJob: vi.fn(),
    cancelBackfillJob: vi.fn(),
  },
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: vi.fn(() => "2 hours ago"),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/zincutils")>();
  return {
    ...actual,
    timestampToTimezoneDate: vi.fn(() => "Jan 01, 2024 12:00"),
  };
});

import BackfillJobDetails from "./BackfillJobDetails.vue";
import backfillService from "../../services/backfill";
import type { BackfillJob } from "../../services/backfill";

const makeJob = (overrides: Partial<BackfillJob> = {}): BackfillJob => ({
  job_id: "job-abc",
  pipeline_id: "pipe-1",
  pipeline_name: "My Pipeline",
  start_time: 1_700_000_000_000_000,
  end_time: 1_700_003_600_000_000,
  current_position: 1_700_001_800_000_000,
  progress_percent: 50,
  status: "running",
  enabled: true,
  ...overrides,
});

// ODrawer stub: forwards data-test attr, exposes `open`/`title` via data
// attributes, and renders the default slot inline so children remain queryable.
// Emits update:open / click:primary|secondary|neutral to mirror real component.
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "width",
    "title",
    "subTitle",
    "primaryButtonLabel",
    "primaryButtonLoading",
    "primaryButtonDisabled",
    "secondaryButtonLabel",
    "secondaryButtonDisabled",
    "neutralButtonLabel",
    "showClose",
    "persistent",
    "size",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test-stub="o-drawer"
      :data-test="$attrs['data-test']"
      :data-open="open"
      :data-title="title"
      :data-width="width"
    >
      <div data-test-stub="o-drawer-header"><slot name="header" /></div>
      <div data-test-stub="o-drawer-body"><slot /></div>
      <div data-test-stub="o-drawer-footer"><slot name="footer" /></div>
    </div>
  `,
  inheritAttrs: false,
};

function createWrapper(props: Record<string, any> = {}) {
  return mount(BackfillJobDetails, {
    props: {
      modelValue: false,
      jobId: "job1",
      pipelineId: "pipe1",
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: ODrawerStub,
        QTimeline: { template: "<div><slot /></div>" },
        QTimelineEntry: { template: "<div />" },
      },
    },
  });
}

describe("BackfillJobDetails – mount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(makeJob());
  });

  it("mounts without errors", () => {
    const wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the ODrawer with data-test='backfill-job-details-dialog'", () => {
    const wrapper = createWrapper();
    expect(
      wrapper.find('[data-test="backfill-job-details-dialog"]').exists()
    ).toBe(true);
  });

  it("passes title 'Backfill Job Details' to ODrawer", () => {
    const wrapper = createWrapper();
    const drawer = wrapper.find('[data-test-stub="o-drawer"]');
    expect(drawer.attributes("data-title")).toBe("Backfill Job Details");
  });

  it("passes width=55 to ODrawer", () => {
    const wrapper = createWrapper();
    const drawer = wrapper.find('[data-test-stub="o-drawer"]');
    expect(drawer.attributes("data-width")).toBe("55");
  });

  it("renders ODrawer with open=true when modelValue is true", async () => {
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    const drawer = wrapper.find('[data-test-stub="o-drawer"]');
    expect(drawer.attributes("data-open")).toBe("true");
  });

  it("renders ODrawer with open=false when modelValue is false", () => {
    const wrapper = createWrapper({ modelValue: false });
    const drawer = wrapper.find('[data-test-stub="o-drawer"]');
    expect(drawer.attributes("data-open")).toBe("false");
  });

  it("emits update:modelValue when ODrawer emits update:open", async () => {
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    const drawer = wrapper.findComponent(ODrawerStub);
    await drawer.vm.$emit("update:open", false);
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
  });
});

describe("BackfillJobDetails – loadJobDetails watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(makeJob());
  });

  it("calls getBackfillJob when modelValue becomes true with a jobId", async () => {
    const wrapper = createWrapper({ modelValue: false, jobId: "job1" });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
    expect(backfillService.getBackfillJob).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: "job1", pipeline_id: "pipe1" })
    );
  });

  it("calls getBackfillJob when jobId changes while modelValue is true", async () => {
    const wrapper = createWrapper({ modelValue: true, jobId: "job1" });
    await flushPromises();
    vi.clearAllMocks();
    await wrapper.setProps({ jobId: "job2" });
    await flushPromises();
    expect(backfillService.getBackfillJob).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: "job2" })
    );
  });

  it("does NOT call getBackfillJob when modelValue is false and jobId changes", async () => {
    const wrapper = createWrapper({ modelValue: false, jobId: "job1" });
    await flushPromises();
    vi.clearAllMocks();
    await wrapper.setProps({ jobId: "job2" });
    await flushPromises();
    expect(backfillService.getBackfillJob).not.toHaveBeenCalled();
  });
});

describe("BackfillJobDetails – loading state", () => {
  it("sets loading to false after job loads successfully", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(makeJob());
    const wrapper = createWrapper({ modelValue: true, jobId: "job1" });
    await flushPromises();
    expect((wrapper.vm as any).loading).toBe(false);
  });

  it("sets job to null when getBackfillJob rejects", async () => {
    vi.mocked(backfillService.getBackfillJob).mockRejectedValue(
      new Error("network error")
    );
    const wrapper = createWrapper({ modelValue: true, jobId: "job1" });
    await flushPromises();
    expect((wrapper.vm as any).job).toBeNull();
  });
});

describe("BackfillJobDetails – canCancelJob computed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("canCancelJob is true when job status is 'running'", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ status: "running" })
    );
    const wrapper = createWrapper({ modelValue: true, jobId: "job1" });
    await flushPromises();
    expect((wrapper.vm as any).canCancelJob).toBe(true);
  });

  it("canCancelJob is true when job status is 'pending'", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ status: "pending" })
    );
    const wrapper = createWrapper({ modelValue: true, jobId: "job1" });
    await flushPromises();
    expect((wrapper.vm as any).canCancelJob).toBe(true);
  });

  it("canCancelJob is false when job status is 'completed'", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ status: "completed" })
    );
    const wrapper = createWrapper({ modelValue: true, jobId: "job1" });
    await flushPromises();
    expect((wrapper.vm as any).canCancelJob).toBeFalsy();
  });

  it("canCancelJob is false when job status is 'failed'", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ status: "failed" })
    );
    const wrapper = createWrapper({ modelValue: true, jobId: "job1" });
    await flushPromises();
    expect((wrapper.vm as any).canCancelJob).toBeFalsy();
  });

  it("cancel-job-btn is rendered when canCancelJob is true", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ status: "running" })
    );
    const wrapper = createWrapper({ modelValue: true, jobId: "job1" });
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-test="cancel-job-btn"]').exists()).toBe(true);
  });

  it("cancel-job-btn is NOT rendered when canCancelJob is false", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ status: "completed" })
    );
    const wrapper = createWrapper({ modelValue: true, jobId: "job1" });
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-test="cancel-job-btn"]').exists()).toBe(false);
  });
});

describe("BackfillJobDetails – getStatusColor", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(makeJob());
    wrapper = createWrapper({ modelValue: true });
    await flushPromises();
  });

  it("returns 'positive' for status 'running'", () => {
    expect((wrapper.vm as any).getStatusColor("running")).toBe("positive");
  });

  it("returns 'positive' for status 'completed'", () => {
    expect((wrapper.vm as any).getStatusColor("completed")).toBe("positive");
  });

  it("returns 'negative' for status 'failed'", () => {
    expect((wrapper.vm as any).getStatusColor("failed")).toBe("negative");
  });

  it("returns 'warning' for status 'pending'", () => {
    expect((wrapper.vm as any).getStatusColor("pending")).toBe("warning");
  });

  it("returns 'grey' for status 'canceled'", () => {
    expect((wrapper.vm as any).getStatusColor("canceled")).toBe("grey");
  });

  it("returns 'negative' when deletionStatus is an object with 'failed' key", () => {
    const result = (wrapper.vm as any).getStatusColor("running", {
      failed: "some error",
    });
    expect(result).toBe("negative");
  });
});

describe("BackfillJobDetails – getStatusLabel", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(makeJob());
    wrapper = createWrapper({ modelValue: true });
    await flushPromises();
  });

  it("capitalizes the status string for normal statuses", () => {
    expect((wrapper.vm as any).getStatusLabel("running")).toBe("Running");
    expect((wrapper.vm as any).getStatusLabel("completed")).toBe("Completed");
  });

  it("returns 'Deletion Failed' when deletionStatus has failed key", () => {
    const result = (wrapper.vm as any).getStatusLabel("running", {
      failed: "error details",
    });
    expect(result).toBe("Deletion Failed");
  });
});

describe("BackfillJobDetails – getProgressColor", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(makeJob());
    wrapper = createWrapper({ modelValue: true });
    await flushPromises();
  });

  it("returns 'blue' when deletionStatus is 'pending'", () => {
    expect((wrapper.vm as any).getProgressColor("pending")).toBe("blue");
  });

  it("returns 'blue' when deletionStatus is 'in_progress'", () => {
    expect((wrapper.vm as any).getProgressColor("in_progress")).toBe("blue");
  });

  it("returns 'positive' when deletionStatus is undefined", () => {
    expect((wrapper.vm as any).getProgressColor(undefined)).toBe("positive");
  });

  it("returns 'positive' when deletionStatus is 'completed'", () => {
    expect((wrapper.vm as any).getProgressColor("completed")).toBe("positive");
  });
});

describe("BackfillJobDetails – getDeletionStatusLabel", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(makeJob());
    wrapper = createWrapper({ modelValue: true });
    await flushPromises();
  });

  it("returns 'Not Required' for undefined status", () => {
    expect((wrapper.vm as any).getDeletionStatusLabel(undefined)).toBe(
      "Not Required"
    );
  });

  it("returns 'Not Required' for null status", () => {
    expect((wrapper.vm as any).getDeletionStatusLabel(null)).toBe(
      "Not Required"
    );
  });

  it("returns 'Not Required' for 'not_required' status", () => {
    expect((wrapper.vm as any).getDeletionStatusLabel("not_required")).toBe(
      "Not Required"
    );
  });

  it("returns 'Completed' for 'completed' status", () => {
    expect((wrapper.vm as any).getDeletionStatusLabel("completed")).toBe(
      "Completed"
    );
  });

  it("returns 'In Progress' for 'in_progress' status", () => {
    expect((wrapper.vm as any).getDeletionStatusLabel("in_progress")).toBe(
      "In Progress"
    );
  });

  it("returns 'Pending' for 'pending' status", () => {
    expect((wrapper.vm as any).getDeletionStatusLabel("pending")).toBe(
      "Pending"
    );
  });

  it("returns 'Failed' for object status with failed key", () => {
    expect(
      (wrapper.vm as any).getDeletionStatusLabel({ failed: "some error" })
    ).toBe("Failed");
  });
});

describe("BackfillJobDetails – formatTimestamp / formatTimestampFull", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(makeJob());
    wrapper = createWrapper({ modelValue: true });
    await flushPromises();
  });

  it("formatTimestamp returns 'N/A' for undefined", () => {
    expect((wrapper.vm as any).formatTimestamp(undefined)).toBe("N/A");
  });

  it("formatTimestamp returns 'N/A' for 0", () => {
    expect((wrapper.vm as any).formatTimestamp(0)).toBe("N/A");
  });

  it("formatTimestamp returns formatted string for a valid timestamp", () => {
    const result = (wrapper.vm as any).formatTimestamp(1_700_000_000_000_000);
    expect(typeof result).toBe("string");
    expect(result).not.toBe("N/A");
  });

  it("formatTimestampFull returns 'N/A' for undefined", () => {
    expect((wrapper.vm as any).formatTimestampFull(undefined)).toBe("N/A");
  });

  it("formatTimestampFull returns 'N/A' for 0", () => {
    expect((wrapper.vm as any).formatTimestampFull(0)).toBe("N/A");
  });

  it("formatTimestampFull returns a string containing '2 hours ago' for valid timestamp", () => {
    const result = (wrapper.vm as any).formatTimestampFull(
      1_700_000_000_000_000
    );
    expect(result).toContain("2 hours ago");
  });
});

describe("BackfillJobDetails – getCurrentPhase computed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 'Deleting Data' when deletion_status is 'in_progress'", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ deletion_status: "in_progress" })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    expect((wrapper.vm as any).getCurrentPhase).toBe("Deleting Data");
  });

  it("returns 'Deleting Data' when deletion_status is 'pending'", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ deletion_status: "pending" })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    expect((wrapper.vm as any).getCurrentPhase).toBe("Deleting Data");
  });

  it("returns 'Backfilling Data' when deletion_status is 'completed'", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ deletion_status: "completed" })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    expect((wrapper.vm as any).getCurrentPhase).toBe("Backfilling Data");
  });

  it("returns 'Deletion Failed' when deletion_status is an object with failed key", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ deletion_status: { failed: "some error" } })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    expect((wrapper.vm as any).getCurrentPhase).toBe("Deletion Failed");
  });

  it("returns 'Backfilling Data' when no deletion_status but progress > 20", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ progress_percent: 50, deletion_status: undefined })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    expect((wrapper.vm as any).getCurrentPhase).toBe("Backfilling Data");
  });

  it("returns 'Initializing' when progress <= 20 and no deletion_status", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ progress_percent: 10, deletion_status: undefined })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    expect((wrapper.vm as any).getCurrentPhase).toBe("Initializing");
  });
});

describe("BackfillJobDetails – estimatedCompletion computed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when job status is not 'running'", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ status: "completed" })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    expect((wrapper.vm as any).estimatedCompletion).toBeNull();
  });

  it("returns null when chunks_total is missing", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ status: "running", chunks_total: undefined })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    expect((wrapper.vm as any).estimatedCompletion).toBeNull();
  });

  it("returns null when chunks_completed is missing", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ status: "running", chunks_total: 10, chunks_completed: undefined })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    expect((wrapper.vm as any).estimatedCompletion).toBeNull();
  });

  it("returns formatted string in minutes when remaining < 60 chunks", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({
        status: "running",
        chunks_total: 10,
        chunks_completed: 5,
      })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    // 5 remaining * 1 min = 5m
    expect((wrapper.vm as any).estimatedCompletion).toBe("~5m");
  });

  it("returns formatted string in hours and minutes when remaining >= 60 chunks", async () => {
    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({
        status: "running",
        chunks_total: 100,
        chunks_completed: 10,
      })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    // 90 remaining * 1 min = 90m = 1h 30m
    expect((wrapper.vm as any).estimatedCompletion).toBe("~1h 30m");
  });
});

describe("BackfillJobDetails – confirmCancelJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls $q.dialog when confirmCancelJob is invoked", async () => {
    const mockDialog = vi.fn(() => ({ onOk: vi.fn(), onCancel: vi.fn() }));
    vi.mocked(
      (await import("quasar")).useQuasar
    ).mockReturnValue({
      notify: vi.fn(),
      dialog: mockDialog,
      dark: { isActive: false },
    } as any);

    vi.mocked(backfillService.getBackfillJob).mockResolvedValue(
      makeJob({ status: "running" })
    );
    const wrapper = createWrapper({ modelValue: true });
    await flushPromises();
    await (wrapper.vm as any).confirmCancelJob();
    expect(mockDialog).toHaveBeenCalled();
  });
});
