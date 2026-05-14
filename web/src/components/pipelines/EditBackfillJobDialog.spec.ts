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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

installQuasar({ plugins: [Dialog, Notify] });

vi.mock("@/services/backfill", () => ({
  default: {
    updateBackfillJob: vi.fn().mockResolvedValue({ message: "updated" }),
    enableBackfillJob: vi.fn().mockResolvedValue({ message: "enabled" }),
  },
}));

vi.mock("@/components/DateTime.vue", () => ({
  default: {
    template: '<div data-test="time-range-picker" />',
    props: ["autoApply", "defaultType", "disableRelative", "minDate"],
    emits: ["on:date-change"],
    methods: {
      setCustomDate: vi.fn(),
    },
  },
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("quasar")>();
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(),
      dialog: vi.fn(() => ({ onOk: vi.fn((cb: () => void) => { cb(); return { onCancel: vi.fn() }; }) })),
      dark: { isActive: false },
    }),
  };
});

import backfillService from "@/services/backfill";
import type { BackfillJob } from "@/services/backfill";
import EditBackfillJobDialog from "./EditBackfillJobDialog.vue";

const mockJob: BackfillJob = {
  job_id: "job-001",
  pipeline_id: "pipeline-abc",
  pipeline_name: "Test Pipeline",
  start_time: 1700000000000000,
  end_time: 1700003600000000,
  current_position: 1700001800000000,
  progress_percent: 50,
  status: "running",
  enabled: true,
  chunk_period_minutes: 60,
  delay_between_chunks_secs: 5,
  delete_before_backfill: false,
};

// ODrawer stub: renders default slot inline and re-emits the events the
// component wires up (update:open, click:primary, click:secondary). The
// title/buttons live on the drawer itself in the real component, so we expose
// them via attrs so the test suite can assert on them.
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
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
      :data-primary-loading="primaryButtonLoading ? 'true' : 'false'"
      :data-primary-disabled="primaryButtonDisabled ? 'true' : 'false'"
    >
      <div data-test-stub="o-drawer-header"><slot name="header" /></div>
      <div data-test-stub="o-drawer-body"><slot /></div>
      <div data-test-stub="o-drawer-footer"><slot name="footer" /></div>
    </div>
  `,
  inheritAttrs: false,
};

function createWrapper(props: Record<string, unknown> = {}) {
  return mount(EditBackfillJobDialog, {
    props: {
      modelValue: true,
      job: mockJob,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: ODrawerStub,
      },
    },
  });
}

describe("EditBackfillJobDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("mounts without errors with job prop", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders ODrawer with data-test='edit-backfill-job-dialog'", () => {
      const wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="edit-backfill-job-dialog"]').exists(),
      ).toBe(true);
    });

    it("passes title 'Edit Backfill Job' to ODrawer", () => {
      const wrapper = createWrapper();
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-title")).toBe("Edit Backfill Job");
    });

    it("passes primary button label 'Update Job' to ODrawer", () => {
      const wrapper = createWrapper();
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-primary-label")).toBe("Update Job");
    });

    it("passes secondary button label 'Cancel' to ODrawer", () => {
      const wrapper = createWrapper();
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-secondary-label")).toBe("Cancel");
    });

    it("renders data-test='time-range-picker' inside drawer body", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="time-range-picker"]').exists()).toBe(
        true,
      );
    });

    it("renders data-test='advanced-options-expansion'", () => {
      const wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="advanced-options-expansion"]').exists(),
      ).toBe(true);
    });

    it("renders data-test='chunk-period-input'", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="chunk-period-input"]').exists()).toBe(
        true,
      );
    });

    it("renders ODrawer with open=true when modelValue is true", () => {
      const wrapper = createWrapper({ modelValue: true });
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-open")).toBe("true");
    });

    it("renders ODrawer with open=false when modelValue is false", () => {
      const wrapper = createWrapper({ modelValue: false });
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-open")).toBe("false");
    });
  });

  describe("formData initialization", () => {
    it("initializes formData from job prop when dialog opens", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.formData.startTimeMicros).toBe(mockJob.start_time);
      expect(vm.formData.endTimeMicros).toBe(mockJob.end_time);
      expect(vm.formData.chunkPeriodMinutes).toBe(mockJob.chunk_period_minutes);
      expect(vm.formData.delayBetweenChunks).toBe(
        mockJob.delay_between_chunks_secs,
      );
      expect(vm.formData.deleteBeforeBackfill).toBe(
        mockJob.delete_before_backfill,
      );
    });

    it("does not populate formData when job is null", async () => {
      const wrapper = createWrapper({ modelValue: true, job: null });
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.formData.startTimeMicros).toBe(0);
      expect(vm.formData.endTimeMicros).toBe(0);
    });

    it("re-initializes formData when job prop changes", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const updatedJob: BackfillJob = {
        ...mockJob,
        start_time: 1800000000000000,
        end_time: 1800003600000000,
        chunk_period_minutes: 30,
      };
      await wrapper.setProps({ job: updatedJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.formData.startTimeMicros).toBe(1800000000000000);
      expect(vm.formData.endTimeMicros).toBe(1800003600000000);
      expect(vm.formData.chunkPeriodMinutes).toBe(30);
    });
  });

  describe("updateDateTime", () => {
    it("sets startTimeMicros and endTimeMicros from DateTime event value", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;

      vm.updateDateTime({
        startTime: 1700000000000000,
        endTime: 1700007200000000,
      });
      await nextTick();

      expect(vm.formData.startTimeMicros).toBe(1700000000000000);
      expect(vm.formData.endTimeMicros).toBe(1700007200000000);
    });
  });

  describe("onSubmit (via ODrawer click:primary)", () => {
    it("calls backfillService.updateBackfillJob with correct parameters on submit", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.formData.startTimeMicros = 1700000000000000;
      vm.formData.endTimeMicros = 1700003600000000;
      vm.formData.chunkPeriodMinutes = 60;
      vm.formData.delayBetweenChunks = 5;
      vm.formData.deleteBeforeBackfill = false;

      await wrapper.findComponent(ODrawerStub).vm.$emit("click:primary");
      await flushPromises();

      expect(backfillService.updateBackfillJob).toHaveBeenCalledWith({
        org_id: store.state.selectedOrganization.identifier,
        pipeline_id: mockJob.pipeline_id,
        job_id: mockJob.job_id,
        data: {
          start_time: 1700000000000000,
          end_time: 1700003600000000,
          chunk_period_minutes: 60,
          delay_between_chunks_secs: 5,
          delete_before_backfill: false,
        },
      });
    });

    it("emits 'job-updated' on successful submit", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.formData.startTimeMicros = 1700000000000000;
      vm.formData.endTimeMicros = 1700003600000000;
      vm.formData.deleteBeforeBackfill = false;

      await wrapper.findComponent(ODrawerStub).vm.$emit("click:primary");
      await flushPromises();

      expect(wrapper.emitted("job-updated")).toBeTruthy();
      expect(wrapper.emitted("job-updated")!.length).toBe(1);
    });

    it("emits 'update:modelValue' with false after successful submit", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.formData.startTimeMicros = 1700000000000000;
      vm.formData.endTimeMicros = 1700003600000000;
      vm.formData.deleteBeforeBackfill = false;

      await wrapper.findComponent(ODrawerStub).vm.$emit("click:primary");
      await flushPromises();

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1];
      expect(lastEmit[0]).toBe(false);
    });

    it("sets errorMessage on service failure", async () => {
      vi.mocked(backfillService.updateBackfillJob).mockRejectedValueOnce(
        new Error("Network Error"),
      );

      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.formData.startTimeMicros = 1700000000000000;
      vm.formData.endTimeMicros = 1700003600000000;
      vm.formData.deleteBeforeBackfill = false;

      await wrapper.findComponent(ODrawerStub).vm.$emit("click:primary");
      await flushPromises();

      expect(vm.errorMessage).toBe("Network Error");
    });

    it("sets errorMessage from response data on API error", async () => {
      const apiError = {
        response: { data: { error: "Job not found" } },
        message: "Request failed",
      };
      vi.mocked(backfillService.updateBackfillJob).mockRejectedValueOnce(
        apiError,
      );

      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.formData.startTimeMicros = 1700000000000000;
      vm.formData.endTimeMicros = 1700003600000000;
      vm.formData.deleteBeforeBackfill = false;

      await wrapper.findComponent(ODrawerStub).vm.$emit("click:primary");
      await flushPromises();

      expect(vm.errorMessage).toBe("Job not found");
    });

    it("sets errorMessage when job prop is null on submit", async () => {
      const wrapper = createWrapper({ modelValue: true, job: null });
      await flushPromises();

      const vm = wrapper.vm as any;
      await vm.onSubmit();

      expect(vm.errorMessage).toBe("No job selected");
    });

    it("sets errorMessage when time range is invalid (both zero)", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.formData.startTimeMicros = 0;
      vm.formData.endTimeMicros = 0;

      await vm.onSubmit();

      expect(vm.errorMessage).toBe("Please select a valid time range");
    });

    it("sets errorMessage when start time >= end time", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.formData.startTimeMicros = 1700003600000000;
      vm.formData.endTimeMicros = 1700000000000000;

      await vm.onSubmit();

      expect(vm.errorMessage).toBe("End time must be after start time");
    });
  });

  describe("onCancel (via ODrawer click:secondary)", () => {
    it("emits 'update:modelValue' with false when secondary (cancel) is clicked", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      await wrapper.findComponent(ODrawerStub).vm.$emit("click:secondary");
      await nextTick();

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1];
      expect(lastEmit[0]).toBe(false);
    });

    it("resets formData on cancel", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.formData.chunkPeriodMinutes = 999;
      vm.errorMessage = "some error";

      await wrapper.findComponent(ODrawerStub).vm.$emit("click:secondary");
      await nextTick();

      expect(vm.formData.startTimeMicros).toBe(0);
      expect(vm.formData.endTimeMicros).toBe(0);
      expect(vm.formData.chunkPeriodMinutes).toBeNull();
      expect(vm.formData.delayBetweenChunks).toBeNull();
      expect(vm.formData.deleteBeforeBackfill).toBe(false);
      expect(vm.errorMessage).toBe("");
    });

    it("closes drawer by setting show to false via onCancel()", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.onCancel();
      await nextTick();

      const modelValueEmits = wrapper.emitted("update:modelValue");
      expect(modelValueEmits).toBeTruthy();
      const lastValue = modelValueEmits![modelValueEmits!.length - 1][0];
      expect(lastValue).toBe(false);
    });
  });

  describe("show computed (v-model:open <-> modelValue)", () => {
    it("show getter returns modelValue prop (true)", () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      const vm = wrapper.vm as any;
      expect(vm.show).toBe(true);
    });

    it("show getter returns modelValue prop (false)", () => {
      const wrapper = createWrapper({ modelValue: false, job: mockJob });
      const vm = wrapper.vm as any;
      expect(vm.show).toBe(false);
    });

    it("setting show emits 'update:modelValue'", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      const vm = wrapper.vm as any;
      vm.show = false;
      await nextTick();

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1][0]).toBe(false);
    });

    it("ODrawer update:open event flows back into v-model (sets show)", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      await wrapper.findComponent(ODrawerStub).vm.$emit("update:open", false);
      await nextTick();

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1][0]).toBe(false);
    });
  });

  describe("validation rules", () => {
    it("chunk period rule: returns true for empty/null value (optional field)", () => {
      const rule = (val: number | null) =>
        !val || (val >= 1 && val <= 1440) || "Must be between 1 and 1440";
      expect(rule(null)).toBe(true);
      expect(rule(0)).toBe(true);
    });

    it("chunk period rule: returns true for value 1 (lower bound)", () => {
      const rule = (val: number | null) =>
        !val || (val >= 1 && val <= 1440) || "Must be between 1 and 1440";
      expect(rule(1)).toBe(true);
    });

    it("chunk period rule: returns true for value 1440 (upper bound)", () => {
      const rule = (val: number | null) =>
        !val || (val >= 1 && val <= 1440) || "Must be between 1 and 1440";
      expect(rule(1440)).toBe(true);
    });

    it("chunk period rule: returns error for value exceeding 1440", () => {
      const rule = (val: number | null) =>
        !val || (val >= 1 && val <= 1440) || "Must be between 1 and 1440";
      expect(rule(1441)).toBe("Must be between 1 and 1440");
    });

    it("chunk period rule: returns error for value 2000 (well above max)", () => {
      const rule = (val: number | null) =>
        !val || (val >= 1 && val <= 1440) || "Must be between 1 and 1440";
      expect(rule(2000)).toBe("Must be between 1 and 1440");
    });

    it("delay rule: returns true for empty/null value (optional field)", () => {
      const rule = (val: number | null) =>
        !val || (val >= 1 && val <= 3600) || "Must be between 1 and 3600";
      expect(rule(null)).toBe(true);
      expect(rule(0)).toBe(true);
    });

    it("delay rule: returns true for value 1 (lower bound)", () => {
      const rule = (val: number | null) =>
        !val || (val >= 1 && val <= 3600) || "Must be between 1 and 3600";
      expect(rule(1)).toBe(true);
    });

    it("delay rule: returns true for value 3600 (upper bound)", () => {
      const rule = (val: number | null) =>
        !val || (val >= 1 && val <= 3600) || "Must be between 1 and 3600";
      expect(rule(3600)).toBe(true);
    });

    it("delay rule: returns error for value exceeding 3600", () => {
      const rule = (val: number | null) =>
        !val || (val >= 1 && val <= 3600) || "Must be between 1 and 3600";
      expect(rule(3601)).toBe("Must be between 1 and 3600");
    });
  });

  describe("resetForm", () => {
    it("resetForm resets all form fields to defaults", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.formData.chunkPeriodMinutes = 120;
      vm.formData.delayBetweenChunks = 10;
      vm.formData.deleteBeforeBackfill = true;
      vm.showAdvanced = true;
      vm.errorMessage = "Some error";

      vm.resetForm();
      await nextTick();

      expect(vm.formData.startTimeMicros).toBe(0);
      expect(vm.formData.endTimeMicros).toBe(0);
      expect(vm.formData.chunkPeriodMinutes).toBeNull();
      expect(vm.formData.delayBetweenChunks).toBeNull();
      expect(vm.formData.deleteBeforeBackfill).toBe(false);
      expect(vm.showAdvanced).toBe(false);
      expect(vm.errorMessage).toBe("");
    });
  });

  describe("loading state", () => {
    it("loading starts as false", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.loading).toBe(false);
    });

    it("passes loading=false to ODrawer initially via primaryButtonLoading", () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-primary-loading")).toBe("false");
    });

    it("ODrawer receives primaryButtonLoading=true when loading is true", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();
      const vm = wrapper.vm as any;

      vm.loading = true;
      await nextTick();

      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-primary-loading")).toBe("true");
    });
  });
});
