// Copyright 2025 OpenObserve Inc.
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
import LlmEvaluationSettings from "./LlmEvaluationSettings.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import { createStore } from "vuex";
import i18n from "@/locales";

installQuasar({ plugins: [Notify] });

const { mockGetPipelines, mockCreatePipeline, mockUpdatePipeline } = vi.hoisted(() => ({
  mockGetPipelines: vi.fn(),
  mockCreatePipeline: vi.fn(),
  mockUpdatePipeline: vi.fn(),
}));

vi.mock("@/services/pipelines", () => ({
  default: {
    getPipelines: mockGetPipelines,
    createPipeline: mockCreatePipeline,
    updatePipeline: mockUpdatePipeline,
  },
}));

const makeStore = (theme = "light") =>
  createStore({
    state: {
      theme,
      selectedOrganization: { identifier: "test-org" },
    },
  });

const defaultProps = {
  streamName: "my-stream",
  streamFields: [
    { label: "gen_ai_system", value: "gen_ai_system" },
    { label: "span_id", value: "span_id" },
  ],
};

describe("LlmEvaluationSettings", () => {
  let store: any;

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    // Default: no pipelines exist
    mockGetPipelines.mockResolvedValue({ data: { list: [] } });
  });

  const mountComp = (props = defaultProps, customStore?: any) =>
    mount(LlmEvaluationSettings, {
      props,
      global: { plugins: [i18n, customStore ?? store] },
    });

  describe("Loading State", () => {
    it("should show loading spinner initially before getPipelines resolves", async () => {
      // Don't resolve immediately
      let resolve: any;
      mockGetPipelines.mockReturnValue(new Promise((r) => { resolve = r; }));

      const wrapper = mountComp();
      // Should show loading spinner before promise resolves
      expect(wrapper.find(".llm-eval-settings__loading").exists()).toBe(true);

      // Resolve to clean up
      resolve({ data: { list: [] } });
      await flushPromises();
    });

    it("should hide loading spinner after getPipelines resolves", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(wrapper.find(".llm-eval-settings__loading").exists()).toBe(false);
    });

    it("should call getPipelines on mount", async () => {
      mountComp();
      await flushPromises();

      expect(mockGetPipelines).toHaveBeenCalledWith("test-org");
    });

    it("should not call getPipelines when streamName is empty", async () => {
      mountComp({ streamName: "", streamFields: [] });
      await flushPromises();

      expect(mockGetPipelines).not.toHaveBeenCalled();
    });
  });

  describe("Default State (no existing pipeline)", () => {
    it("should show enable toggle", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(wrapper.find('[data-test="stream-llm-eval-enable-toggle"]').exists()).toBe(true);
    });

    it("should show info banner when disabled (default)", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(wrapper.find(".llm-eval-settings__info-banner").exists()).toBe(true);
    });

    it("should not show config fields when disabled", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(wrapper.find('[data-test="stream-llm-eval-span-identifier"]').exists()).toBe(false);
    });

    it("should set default output stream name to streamName_evaluations", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.outputStream).toBe("my-stream_evaluations");
    });

    it("should initialize enabled as false", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.enabled).toBe(false);
    });

    it("should initialize samplingRate as 0.01", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.samplingRate).toBe(0.01);
    });
  });

  describe("Existing Pipeline", () => {
    const existingPipeline = {
      pipeline_id: "pipeline-123",
      version: 1,
      source: { stream_name: "my-stream", stream_type: "traces" },
      nodes: [
        {
          io_type: "default",
          data: {
            node_type: "llm_evaluation",
            llm_span_identifier: "custom_identifier",
            sampling_rate: 0.1,
          },
        },
        {
          io_type: "output",
          data: { stream_type: "logs", stream_name: "my-stream-eval-output" },
        },
      ],
    };

    beforeEach(() => {
      mockGetPipelines.mockResolvedValue({
        data: { list: [existingPipeline] },
      });
    });

    it("should enable toggle when existing pipeline is found", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.enabled).toBe(true);
    });

    it("should load span identifier from existing pipeline", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.spanIdentifier).toBe("custom_identifier");
    });

    it("should load sampling rate from existing pipeline", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.samplingRate).toBe(0.1);
      expect(vm.enableSampling).toBe(true);
    });

    it("should load output stream name from eval output node", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.outputStream).toBe("my-stream-eval-output");
    });

    it("should show config fields when enabled is true", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(wrapper.find('[data-test="stream-llm-eval-span-identifier"]').exists()).toBe(true);
    });
  });

  describe("samplingRatePercent computed", () => {
    it("should compute samplingRatePercent from samplingRate", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.samplingRate = 0.25;
      await flushPromises();
      expect(vm.samplingRatePercent).toBe("25");
    });

    it("should show 1% for default 0.01 rate", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.samplingRatePercent).toBe("1");
    });
  });

  describe("markDirty", () => {
    it("should emit dirty when markDirty is called", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.markDirty();

      expect(wrapper.emitted("dirty")).toBeTruthy();
    });
  });

  describe("filterFields", () => {
    it("should filter fields by search value", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      const mockUpdate = vi.fn((cb: any) => cb());

      vm.filterFields("span", mockUpdate);
      expect(vm.filteredFields).toEqual([{ label: "span_id", value: "span_id" }]);
    });

    it("should return all fields when search is empty", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      const mockUpdate = vi.fn((cb: any) => cb());

      vm.filterFields("", mockUpdate);
      expect(vm.filteredFields).toHaveLength(2);
    });

    it("should call update callback", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      const mockUpdate = vi.fn((cb: any) => cb());

      vm.filterFields("gen", mockUpdate);
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe("streamFields watch", () => {
    it("should sync filteredFields when streamFields prop changes", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const newFields = [
        { label: "new_field", value: "new_field" },
      ];
      await wrapper.setProps({ streamFields: newFields });
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.filteredFields).toEqual(newFields);
    });
  });

  describe("Error Handling on Mount", () => {
    it("should set default output stream name when getPipelines fails", async () => {
      mockGetPipelines.mockRejectedValue(new Error("Network error"));

      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.outputStream).toBe("my-stream_evaluations");
      expect(vm.loading).toBe(false);
    });
  });

  describe("Theme Styling", () => {
    it("should render correctly in light theme", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(wrapper.find(".llm-eval-settings__card--light").exists()).toBe(true);
    });

    it("should render correctly in dark theme", async () => {
      const darkStore = makeStore("dark");
      const wrapper = mountComp(defaultProps, darkStore);
      await flushPromises();
      expect(wrapper.find(".llm-eval-settings__card--dark").exists()).toBe(true);
    });
  });

  describe("save() exposed method", () => {
    it("should show warning notify when enabled is false", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      // enabled is false by default
      await vm.save();

      // Should not call create or update
      expect(mockCreatePipeline).not.toHaveBeenCalled();
      expect(mockUpdatePipeline).not.toHaveBeenCalled();
    });

    it("should call createPipeline when no existing pipeline", async () => {
      mockGetPipelines
        .mockResolvedValueOnce({ data: { list: [] } }) // initial load
        .mockResolvedValueOnce({ data: { list: [] } }); // after create
      mockCreatePipeline.mockResolvedValue({});

      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.enabled = true;
      await vm.save();

      expect(mockCreatePipeline).toHaveBeenCalled();
    });
  });
});
