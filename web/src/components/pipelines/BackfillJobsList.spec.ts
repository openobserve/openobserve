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
    useQuasar: () => ({
      notify: vi.fn(),
      dialog: vi.fn(() => ({ onOk: vi.fn(), onCancel: vi.fn() })),
      dark: { isActive: false },
    }),
  };
});

const mockRouterBack = vi.fn();
const mockRouterPush = vi.fn();

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRouter: () => ({ back: mockRouterBack, push: mockRouterPush }),
    useRoute: () => ({ params: {}, query: {} }),
  };
});

vi.mock("@/services/backfill", () => ({
  default: {
    listBackfillJobs: vi.fn().mockResolvedValue([]),
    enableBackfillJob: vi.fn().mockResolvedValue({ message: "ok" }),
    deleteBackfillJob: vi.fn().mockResolvedValue({ message: "ok" }),
    cancelBackfillJob: vi.fn().mockResolvedValue({ message: "ok" }),
  },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/zincutils")>();
  return {
    ...actual,
    timestampToTimezoneDate: vi.fn(() => "Jan 01, 2024"),
  };
});

import BackfillJobsList from "./BackfillJobsList.vue";
import backfillService from "@/services/backfill";
import type { BackfillJob } from "@/services/backfill";

const makeJob = (overrides: Partial<BackfillJob> = {}): BackfillJob => ({
  job_id: "job-1",
  pipeline_id: "pipe-1",
  pipeline_name: "Pipeline One",
  start_time: 1_700_000_000_000_000,
  end_time: 1_700_003_600_000_000,
  current_position: 1_700_001_800_000_000,
  progress_percent: 50,
  status: "running",
  enabled: true,
  ...overrides,
});

// Stub ODialog so tests are deterministic (no Portal/Reka teleport)
// and so we can assert on the props the component forwards + emit
// the click events the component listens to.
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
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
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
    >
      <slot name="header-left" />
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-close"
        @click="$emit('update:open', false)"
      >x</button>
    </div>
  `,
};

function createWrapper() {
  return mount(BackfillJobsList, {
    global: {
      plugins: [i18n, store],
      stubs: {
        BackfillJobDetails: { template: "<div />" },
        EditBackfillJobDialog: { template: "<div />" },
        NoData: { template: "<div />" },
        QTablePagination: { template: "<div />" },
        ConfirmDialog: { template: "<div />" },
        ODialog: ODialogStub,
      },
    },
  });
}

describe("BackfillJobsList – mount and structure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([]);
  });

  it("mounts without errors", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.exists()).toBe(true);
  });

  it("renders data-test='backfill-jobs-list-page'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(
      wrapper.find('[data-test="backfill-jobs-list-page"]').exists()
    ).toBe(true);
  });

  it("renders data-test='backfill-jobs-back-btn'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(
      wrapper.find('[data-test="backfill-jobs-back-btn"]').exists()
    ).toBe(true);
  });

  it("renders data-test='status-filter'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="status-filter"]').exists()).toBe(true);
  });

  it("renders data-test='pipeline-filter'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="pipeline-filter"]').exists()).toBe(true);
  });

  it("renders data-test='clear-filters-btn'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="clear-filters-btn"]').exists()).toBe(true);
  });

  it("renders data-test='refresh-btn'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="refresh-btn"]').exists()).toBe(true);
  });

  it("renders data-test='backfill-jobs-table'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(
      wrapper.find('[data-test="backfill-jobs-table"]').exists()
    ).toBe(true);
  });
});

describe("BackfillJobsList – loadJobs on mount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([]);
  });

  it("calls listBackfillJobs on mount", async () => {
    createWrapper();
    await flushPromises();
    expect(backfillService.listBackfillJobs).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: "default" })
    );
  });

  it("populates jobs after a successful load", async () => {
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([
      makeJob({ job_id: "j1" }),
      makeJob({ job_id: "j2" }),
    ]);
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).jobs).toHaveLength(2);
  });
});

describe("BackfillJobsList – filteredJobs computed", () => {
  const jobs: BackfillJob[] = [
    makeJob({ job_id: "j1", status: "running", pipeline_id: "pipe-1" }),
    makeJob({
      job_id: "j2",
      status: "waiting",
      pipeline_id: "pipe-1",
      enabled: true,
    }),
    makeJob({
      job_id: "j3",
      status: "pending",
      pipeline_id: "pipe-2",
      enabled: true,
    }),
    makeJob({
      job_id: "j4",
      status: "completed",
      pipeline_id: "pipe-2",
      enabled: true,
    }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue(jobs);
  });

  it("returns all jobs when no filters are set", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).filteredJobs).toHaveLength(4);
  });

  it("filters by status 'running', including 'waiting' and 'pending' jobs", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    (wrapper.vm as any).filters.status = "running";
    await nextTick();
    const filtered = (wrapper.vm as any).filteredJobs as BackfillJob[];
    // j1 (running), j2 (waiting→running), j3 (pending→running) should match
    expect(filtered.length).toBe(3);
    expect(filtered.map((j) => j.job_id)).toEqual(
      expect.arrayContaining(["j1", "j2", "j3"])
    );
  });

  it("filters by pipelineId", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    (wrapper.vm as any).filters.pipelineId = "pipe-2";
    await nextTick();
    const filtered = (wrapper.vm as any).filteredJobs as BackfillJob[];
    expect(filtered.length).toBe(2);
    expect(filtered.every((j) => j.pipeline_id === "pipe-2")).toBe(true);
  });

  it("filters by both status and pipelineId", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    (wrapper.vm as any).filters.status = "running";
    (wrapper.vm as any).filters.pipelineId = "pipe-2";
    await nextTick();
    const filtered = (wrapper.vm as any).filteredJobs as BackfillJob[];
    // only j3 (pending in pipe-2, maps to running)
    expect(filtered.length).toBe(1);
    expect(filtered[0].job_id).toBe("j3");
  });

  it("returns no jobs when status filter matches nothing", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    (wrapper.vm as any).filters.status = "paused";
    await nextTick();
    expect((wrapper.vm as any).filteredJobs).toHaveLength(0);
  });
});

describe("BackfillJobsList – clearFilters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([]);
  });

  it("resets both status and pipelineId to null", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    (wrapper.vm as any).filters.status = "running";
    (wrapper.vm as any).filters.pipelineId = "pipe-1";
    await nextTick();
    (wrapper.vm as any).clearFilters();
    await nextTick();
    expect((wrapper.vm as any).filters.status).toBeNull();
    expect((wrapper.vm as any).filters.pipelineId).toBeNull();
  });
});

describe("BackfillJobsList – goBack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([]);
  });

  it("calls router.back() when goBack is invoked", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    (wrapper.vm as any).goBack();
    expect(mockRouterBack).toHaveBeenCalled();
  });

  it("clicking backfill-jobs-back-btn calls router.back()", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    await wrapper.find('[data-test="backfill-jobs-back-btn"]').trigger("click");
    expect(mockRouterBack).toHaveBeenCalled();
  });
});

describe("BackfillJobsList – canPauseJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([]);
  });

  it("returns true for enabled job with status 'running'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const job = makeJob({ enabled: true, status: "running" });
    expect((wrapper.vm as any).canPauseJob(job)).toBe(true);
  });

  it("returns false for disabled job", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const job = makeJob({ enabled: false, status: "running" });
    expect((wrapper.vm as any).canPauseJob(job)).toBe(false);
  });

  it("returns false for enabled job with status 'completed'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const job = makeJob({ enabled: true, status: "completed" });
    expect((wrapper.vm as any).canPauseJob(job)).toBe(false);
  });

  it("returns false for enabled job with status 'failed'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const job = makeJob({ enabled: true, status: "failed" });
    expect((wrapper.vm as any).canPauseJob(job)).toBe(false);
  });
});

describe("BackfillJobsList – canResumeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([]);
  });

  it("returns true for disabled job with status 'running'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const job = makeJob({ enabled: false, status: "running" });
    expect((wrapper.vm as any).canResumeJob(job)).toBe(true);
  });

  it("returns false for enabled job", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const job = makeJob({ enabled: true, status: "running" });
    expect((wrapper.vm as any).canResumeJob(job)).toBe(false);
  });

  it("returns false for disabled job with status 'completed'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const job = makeJob({ enabled: false, status: "completed" });
    expect((wrapper.vm as any).canResumeJob(job)).toBe(false);
  });

  it("returns false for disabled job with status 'failed'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const job = makeJob({ enabled: false, status: "failed" });
    expect((wrapper.vm as any).canResumeJob(job)).toBe(false);
  });
});

describe("BackfillJobsList – canEditJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([]);
  });

  it("returns true for status 'paused'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).canEditJob("paused")).toBe(true);
  });

  it("returns true for status 'completed'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).canEditJob("completed")).toBe(true);
  });

  it("returns false for status 'running'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).canEditJob("running")).toBe(false);
  });

  it("returns false for status 'failed'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).canEditJob("failed")).toBe(false);
  });
});

describe("BackfillJobsList – canDeleteJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([]);
  });

  it("returns true for status 'completed'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).canDeleteJob("completed")).toBe(true);
  });

  it("returns true for status 'failed'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).canDeleteJob("failed")).toBe(true);
  });

  it("returns true for status 'canceled'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).canDeleteJob("canceled")).toBe(true);
  });

  it("returns true for status 'paused'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).canDeleteJob("paused")).toBe(true);
  });

  it("returns false for status 'running'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).canDeleteJob("running")).toBe(false);
  });

  it("returns false for status 'pending'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).canDeleteJob("pending")).toBe(false);
  });
});

describe("BackfillJobsList – getProgressColor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([]);
  });

  it("returns 'blue' for deletionStatus 'pending'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).getProgressColor("pending")).toBe("blue");
  });

  it("returns 'blue' for deletionStatus 'in_progress'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).getProgressColor("in_progress")).toBe("blue");
  });

  it("returns 'positive' for undefined deletionStatus", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).getProgressColor(undefined)).toBe("positive");
  });

  it("returns 'positive' for deletionStatus 'completed'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).getProgressColor("completed")).toBe("positive");
  });
});

describe("BackfillJobsList – loadPipelineOptions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("extracts unique pipelines from loaded jobs", async () => {
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([
      makeJob({ job_id: "j1", pipeline_id: "pipe-1", pipeline_name: "Pipe A" }),
      makeJob({ job_id: "j2", pipeline_id: "pipe-1", pipeline_name: "Pipe A" }),
      makeJob({ job_id: "j3", pipeline_id: "pipe-2", pipeline_name: "Pipe B" }),
    ]);
    const wrapper = createWrapper();
    await flushPromises();
    const options = (wrapper.vm as any).pipelineOptions as any[];
    expect(options).toHaveLength(2);
    expect(options.map((o: any) => o.value)).toEqual(
      expect.arrayContaining(["pipe-1", "pipe-2"])
    );
  });
});

describe("BackfillJobsList – formatTimestamp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([]);
  });

  it("returns 'N/A' for falsy input (0)", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).formatTimestamp(0)).toBe("N/A");
  });

  it("returns 'N/A' for undefined", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect((wrapper.vm as any).formatTimestamp(undefined)).toBe("N/A");
  });

  it("returns a string for a valid timestamp", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const result = (wrapper.vm as any).formatTimestamp(1_700_000_000_000_000);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("BackfillJobsList – Error ODialog migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backfillService.listBackfillJobs).mockResolvedValue([]);
  });

  it("does not show the error ODialog initially", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const dialog = wrapper.find('[data-test="o-dialog-stub"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes("data-open")).toBe("false");
  });

  it("opens the error ODialog when showErrorDialog is called", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const job = makeJob({ error: "boom" });
    (wrapper.vm as any).showErrorDialog(job);
    await nextTick();
    const dialog = wrapper.find('[data-test="o-dialog-stub"]');
    expect(dialog.attributes("data-open")).toBe("true");
    expect((wrapper.vm as any).errorDialogData).toEqual(job);
  });

  it("forwards size 'md' and title 'Backfill Job Error' to ODialog", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const dialog = wrapper.find('[data-test="o-dialog-stub"]');
    expect(dialog.attributes("data-size")).toBe("md");
    expect(dialog.attributes("data-title")).toBe("Backfill Job Error");
  });

  it("forwards primary-button-label 'Close' to ODialog", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const dialog = wrapper.find('[data-test="o-dialog-stub"]');
    expect(dialog.attributes("data-primary-label")).toBe("Close");
  });

  it("closes and resets data when ODialog emits click:primary", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    (wrapper.vm as any).showErrorDialog(makeJob({ error: "boom" }));
    await nextTick();
    expect((wrapper.vm as any).errorDialogVisible).toBe(true);
    await wrapper.find('[data-test="o-dialog-stub-primary"]').trigger("click");
    await nextTick();
    expect((wrapper.vm as any).errorDialogVisible).toBe(false);
    expect((wrapper.vm as any).errorDialogData).toBeNull();
  });

  it("closes and resets data when ODialog emits update:open=false", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    (wrapper.vm as any).showErrorDialog(makeJob({ error: "boom" }));
    await nextTick();
    expect((wrapper.vm as any).errorDialogVisible).toBe(true);
    await wrapper.find('[data-test="o-dialog-stub-close"]').trigger("click");
    await nextTick();
    expect((wrapper.vm as any).errorDialogVisible).toBe(false);
    expect((wrapper.vm as any).errorDialogData).toBeNull();
  });

  it("renders job_id, pipeline name, and error message in the dialog body", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    (wrapper.vm as any).showErrorDialog(
      makeJob({
        job_id: "j-err",
        pipeline_id: "pipe-err",
        pipeline_name: "Err Pipe",
        error: "kaboom",
      })
    );
    await nextTick();
    const dialog = wrapper.find('[data-test="o-dialog-stub"]');
    const text = dialog.text();
    expect(text).toContain("j-err");
    expect(text).toContain("Err Pipe");
    expect(text).toContain("kaboom");
  });

  it("closeErrorDialog hides dialog and clears errorDialogData", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    (wrapper.vm as any).showErrorDialog(makeJob({ error: "boom" }));
    await nextTick();
    (wrapper.vm as any).closeErrorDialog();
    await nextTick();
    expect((wrapper.vm as any).errorDialogVisible).toBe(false);
    expect((wrapper.vm as any).errorDialogData).toBeNull();
  });
});
