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
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";


vi.mock("@/services/backfill", () => ({
  default: {
    updateBackfillJob: vi.fn().mockResolvedValue({ message: "updated" }),
    enableBackfillJob: vi.fn().mockResolvedValue({ message: "enabled" }),
  },
}));

vi.mock("@/components/DateTime.vue", () => ({
  default: {
    template: '<div data-test="time-range-picker" />',
    props: ["defaultType", "defaultAbsoluteTime", "defaultRelativeTime", "disableRelative", "minDate"],
    emits: ["on:date-change"],
    methods: {
      setCustomDate: vi.fn(),
    },
  },
}));

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
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "width",
    "title",
    "subTitle",
    "formId",
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
        ODialog: ODialogStub,
        OCollapsible: {
          template: '<div><slot /></div>',
          props: ["modelValue", "icon", "label"],
        },
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
const validRange = () => ({
  type: "absolute",
  from: mockJob.start_time,
  to: mockJob.end_time,
});
const submitForm = async (w: any) => {
  await (w.vm as any).form.handleSubmit();
  await flushPromises();
};

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

  describe("form initialization", () => {
    it("initializes form + time range from job prop when dialog opens", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();
      expect(formVals(wrapper).timerange.from).toBe(mockJob.start_time);
      expect(formVals(wrapper).timerange.to).toBe(mockJob.end_time);
      expect(formVals(wrapper).chunkPeriodMinutes).toBe(mockJob.chunk_period_minutes);
      expect(formVals(wrapper).delayBetweenChunks).toBe(
        mockJob.delay_between_chunks_secs,
      );
      expect(formVals(wrapper).deleteBeforeBackfill).toBe(
        mockJob.delete_before_backfill,
      );
    });

    it("does not populate form time range when job is null", async () => {
      const wrapper = createWrapper({ modelValue: true, job: null });
      await flushPromises();
      expect(formVals(wrapper).timerange.from).toBeUndefined();
      expect(formVals(wrapper).timerange.to).toBeUndefined();
    });

    it("re-initializes form + time range when job prop changes", async () => {
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

      expect(formVals(wrapper).timerange.from).toBe(1800000000000000);
      expect(formVals(wrapper).timerange.to).toBe(1800003600000000);
      expect(formVals(wrapper).chunkPeriodMinutes).toBe(30);
    });
  });

  describe("timerange field", () => {
    it("setFieldValue('timerange', ...) updates the form value", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      setRange(wrapper, { type: "absolute", from: 1700000000000000, to: 1700007200000000 });
      await nextTick();

      expect(formVals(wrapper).timerange.from).toBe(1700000000000000);
      expect(formVals(wrapper).timerange.to).toBe(1700007200000000);
    });
  });

  describe("onSubmit (via real OForm submit)", () => {
    it("calls backfillService.updateBackfillJob with correct parameters on submit", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();
      // timerange + chunk/delay/deleteBeforeBackfill are seeded into the form
      // from the job (start/end / 60 / 5 / false) by the open-watch.

      await submitForm(wrapper);

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

      await submitForm(wrapper);

      expect(wrapper.emitted("job-updated")).toBeTruthy();
      expect(wrapper.emitted("job-updated")!.length).toBe(1);
    });

    it("emits 'update:modelValue' with false after successful submit", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      await submitForm(wrapper);

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1];
      expect(lastEmit[0]).toBe(false);
    });

    it("blocks submit when chunkPeriodMinutes is out of range", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      setField(wrapper, "chunkPeriodMinutes", 5000);

      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(false);
      expect(backfillService.updateBackfillJob).not.toHaveBeenCalled();
    });

    it("sets errorMessage on service failure", async () => {
      vi.mocked(backfillService.updateBackfillJob).mockRejectedValueOnce(
        new Error("Network Error"),
      );

      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      await submitForm(wrapper);

      expect((wrapper.vm as any).errorMessage).toBe("Network Error");
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

      await submitForm(wrapper);

      expect((wrapper.vm as any).errorMessage).toBe("Job not found");
    });

    it("sets errorMessage when job prop is null on submit", async () => {
      const wrapper = createWrapper({ modelValue: true, job: null });
      await flushPromises();

      // job is null → the form's default timerange is empty; supply a valid
      // range so the schema passes and the @submit handler runs the null guard.
      setRange(wrapper, { type: "absolute", from: 1700000000000000, to: 1700003600000000 });
      await submitForm(wrapper);

      expect((wrapper.vm as any).errorMessage).toBe("No job selected");
      expect(backfillService.updateBackfillJob).not.toHaveBeenCalled();
    });

    it("blocks submit + renders error when time range is invalid (both zero)", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      setRange(wrapper, { type: "absolute", from: 0, to: 0 });
      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(false);
      expect((wrapper.vm as any).timerangeError).toBe(
        "Please select a valid time range",
      );
      expect(wrapper.text()).toContain("Please select a valid time range");
      expect(backfillService.updateBackfillJob).not.toHaveBeenCalled();
    });

    it("blocks submit + renders error when start time >= end time", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      setRange(wrapper, { type: "absolute", from: 1700003600000000, to: 1700000000000000 });
      await submitForm(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(false);
      expect((wrapper.vm as any).timerangeError).toBe(
        "Start time must be before end time",
      );
      expect(backfillService.updateBackfillJob).not.toHaveBeenCalled();
    });
  });

  describe("onCancel (via ODrawer click:secondary)", () => {
    it("emits 'update:modelValue' with false when secondary (cancel) is clicked", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      await wrapper.findComponent(ODialogStub).vm.$emit("click:secondary");
      await nextTick();

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1];
      expect(lastEmit[0]).toBe(false);
    });

    it("resets form + time range on cancel", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      setField(wrapper, "chunkPeriodMinutes", 999);
      vm.errorMessage = "some error";

      await wrapper.findComponent(ODialogStub).vm.$emit("click:secondary");
      await nextTick();

      expect(formVals(wrapper).timerange.from).toBeUndefined();
      expect(formVals(wrapper).timerange.to).toBeUndefined();
      expect(formVals(wrapper).chunkPeriodMinutes).toBeNull();
      expect(formVals(wrapper).delayBetweenChunks).toBeNull();
      expect(formVals(wrapper).deleteBeforeBackfill).toBe(false);
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

      await wrapper.findComponent(ODialogStub).vm.$emit("update:open", false);
      await nextTick();

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1][0]).toBe(false);
    });
  });

  // These drive the REAL shared Zod schema (backfillJob.schema.ts) through the
  // form submit — not a hand-rolled copy of the rule. They lock in the main
  // baseline: only null/undefined are optional and PASS; 0 and empty ("") coerce
  // into the range check and BLOCK (main did `Number(v) < min`); an in-range
  // value passes; an out-of-range value blocks the save.
  describe("numeric-range validation (real schema)", () => {
    // Set one numeric field, submit through the real OForm, and report whether
    // the save actually fired (job + valid range are seeded from mockJob).
    const savesWith = async (field: string, value: unknown) => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();
      setField(wrapper, field, value);
      await submitForm(wrapper);
      const called =
        vi.mocked(backfillService.updateBackfillJob).mock.calls.length > 0;
      wrapper.unmount();
      return called;
    };

    it("chunkPeriodMinutes: 0 blocks the save (0 < min)", async () => {
      expect(await savesWith("chunkPeriodMinutes", 0)).toBe(false);
    });

    it("chunkPeriodMinutes: '' (cleared) blocks the save", async () => {
      expect(await savesWith("chunkPeriodMinutes", "")).toBe(false);
    });

    it("chunkPeriodMinutes: null (unset) passes — save is called", async () => {
      expect(await savesWith("chunkPeriodMinutes", null)).toBe(true);
    });

    it("chunkPeriodMinutes: 1 (lower bound) passes", async () => {
      expect(await savesWith("chunkPeriodMinutes", 1)).toBe(true);
    });

    it("chunkPeriodMinutes: 1440 (upper bound) passes", async () => {
      expect(await savesWith("chunkPeriodMinutes", 1440)).toBe(true);
    });

    it("chunkPeriodMinutes: 1441 (over max) blocks the save", async () => {
      expect(await savesWith("chunkPeriodMinutes", 1441)).toBe(false);
    });

    it("delayBetweenChunks: 0 blocks the save (0 < min)", async () => {
      expect(await savesWith("delayBetweenChunks", 0)).toBe(false);
    });

    it("delayBetweenChunks: 3600 (upper bound) passes", async () => {
      expect(await savesWith("delayBetweenChunks", 3600)).toBe(true);
    });

    it("delayBetweenChunks: 3601 (over max) blocks the save", async () => {
      expect(await savesWith("delayBetweenChunks", 3601)).toBe(false);
    });
  });

  describe("resetForm", () => {
    it("resetForm resets all form fields to defaults", async () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      const vm = wrapper.vm as any;
      setField(wrapper, "chunkPeriodMinutes", 120);
      setField(wrapper, "delayBetweenChunks", 10);
      setField(wrapper, "deleteBeforeBackfill", true);
      vm.showAdvanced = true;
      vm.errorMessage = "Some error";

      vm.resetForm();
      await nextTick();

      expect(formVals(wrapper).timerange.from).toBeUndefined();
      expect(formVals(wrapper).timerange.to).toBeUndefined();
      expect(formVals(wrapper).chunkPeriodMinutes).toBeNull();
      expect(formVals(wrapper).delayBetweenChunks).toBeNull();
      expect(formVals(wrapper).deleteBeforeBackfill).toBe(false);
      expect(vm.showAdvanced).toBe(false);
      expect(vm.errorMessage).toBe("");
    });
  });

  describe("loading state (form-driven)", () => {
    it("form is not submitting initially", () => {
      const wrapper = createWrapper();
      expect((wrapper.vm as any).form.state.isSubmitting).toBe(false);
    });

    it("passes primary-loading=false to ODrawer initially", () => {
      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-primary-loading")).toBe("false");
    });

    it("form.isSubmitting is true while the (awaited) save is in flight", async () => {
      let resolveFn: (val: any) => void = () => {};
      vi.mocked(backfillService.updateBackfillJob).mockImplementationOnce(
        () => new Promise((res) => { resolveFn = res; }),
      );

      const wrapper = createWrapper({ modelValue: true, job: mockJob });
      await flushPromises();

      // The awaited onSubmit keeps the form's isSubmitting (which the form-id
      // bridge mirrors onto the ODialog footer spinner) true for the whole save.
      (wrapper.vm as any).form.handleSubmit();
      // The schema validates asynchronously — wait for the save to actually fire.
      await vi.waitFor(() =>
        expect(backfillService.updateBackfillJob).toHaveBeenCalled(),
      );
      expect((wrapper.vm as any).form.state.isSubmitting).toBe(true);

      resolveFn({ message: "updated" });
      await vi.waitFor(() =>
        expect((wrapper.vm as any).form.state.isSubmitting).toBe(false),
      );
    });
  });
});
