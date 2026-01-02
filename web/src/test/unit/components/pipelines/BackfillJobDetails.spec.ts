// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { Quasar } from "quasar";
import BackfillJobDetails from "@/components/pipelines/BackfillJobDetails.vue";

// Mock backfill service
vi.mock("@/services/backfill", () => ({
  default: {
    getBackfillJob: vi.fn(() =>
      Promise.resolve({
        job_id: "job-123",
        pipeline_name: "test-pipeline",
        pipeline_id: "pipeline-123",
        status: "running",
        progress_percent: 50,
        created_at: 1234567890000000,
        start_time: 1234567890000000,
        end_time: 1234567900000000,
        current_position: 1234567895000000,
        chunks_completed: 5,
        chunks_total: 10,
        deletion_status: "not_required",
      })
    ),
    cancelBackfillJob: vi.fn(() => Promise.resolve()),
  },
}));

// Mock date-fns
vi.mock("date-fns", () => ({
  format: vi.fn((date, formatStr) => "2024-01-01 12:00:00"),
  formatDistanceToNow: vi.fn(() => "5 minutes ago"),
}));

describe("BackfillJobDetails.vue", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
      },
    });
  });

  const mountComponent = (props = {}) => {
    return mount(BackfillJobDetails, {
      props: {
        modelValue: true,
        jobId: "job-123",
        ...props,
      },
      global: {
        plugins: [store, Quasar],
      },
    });
  };

  describe("rendering", () => {
    it("should render dialog", () => {
      const wrapper = mountComponent();

      expect(wrapper.find('[data-test="backfill-job-details-dialog"]').exists()).toBe(true);
    });

    it("should render dialog title", () => {
      const wrapper = mountComponent();

      expect(wrapper.find('[data-test="dialog-title"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dialog-title"]').text()).toBe("Backfill Job Details");
    });

    it("should render close button", () => {
      const wrapper = mountComponent();

      expect(wrapper.find('[data-test="close-dialog-btn"]').exists()).toBe(true);
    });
  });

  describe("loading state", () => {
    it("should show loading spinner when loading", async () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      vm.loading = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.findComponent({ name: "q-spinner" }).exists()).toBe(true);
    });

    it("should hide loading spinner when not loading", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.loading = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.findComponent({ name: "q-spinner" }).exists()).toBe(false);
    });
  });

  describe("job details", () => {
    it("should display job information when loaded", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.loading = false;
      vm.job = {
        job_id: "job-123",
        pipeline_name: "test-pipeline",
        status: "running",
        progress_percent: 50,
      };
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain("job-123");
      expect(wrapper.text()).toContain("test-pipeline");
    });

    it("should display progress bar", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.loading = false;
      vm.job = {
        job_id: "job-123",
        status: "running",
        progress_percent: 75,
      };
      await wrapper.vm.$nextTick();

      expect(wrapper.findComponent({ name: "q-linear-progress" }).exists()).toBe(true);
    });

    it("should show not found message when job is null", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.loading = false;
      vm.job = null;
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain("Job not found");
    });
  });

  describe("cancel job", () => {
    it("should show cancel button for running jobs", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.loading = false;
      vm.job = {
        job_id: "job-123",
        status: "running",
        progress_percent: 50,
      };
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="cancel-job-btn"]').exists()).toBe(true);
    });

    it("should not show cancel button for completed jobs", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.loading = false;
      vm.job = {
        job_id: "job-123",
        status: "completed",
        progress_percent: 100,
      };
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="cancel-job-btn"]').exists()).toBe(false);
    });
  });

  describe("model value", () => {
    it("should emit update:modelValue when dialog closes", async () => {
      const wrapper = mountComponent({ modelValue: true });

      const vm = wrapper.vm as any;
      vm.show = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });
  });

  describe("timeline", () => {
    it("should show timeline section", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.loading = false;
      vm.job = {
        job_id: "job-123",
        status: "running",
        created_at: 1234567890000000,
      };
      await wrapper.vm.$nextTick();

      expect(wrapper.findComponent({ name: "q-timeline" }).exists()).toBe(true);
    });
  });
});
