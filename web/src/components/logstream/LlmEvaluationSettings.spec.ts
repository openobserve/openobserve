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
import LlmEvaluationSettings from "./LlmEvaluationSettings.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { createStore } from "vuex";
import i18n from "@/locales";

const { mockGetPipelines, mockCreatePipeline, mockUpdatePipeline } = vi.hoisted(
  () => ({
    mockGetPipelines: vi.fn(),
    mockCreatePipeline: vi.fn(),
    mockUpdatePipeline: vi.fn(),
  }),
);

const mockToast = vi.hoisted(() => vi.fn());

vi.mock("@/services/pipelines", () => ({
  default: {
    getPipelines: mockGetPipelines,
    createPipeline: mockCreatePipeline,
    updatePipeline: mockUpdatePipeline,
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
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

  // The real OForm instance (single source of truth for the LLM-eval fields).
  const getForm = (w: any) => {
    const oform = w.findComponent(OForm);
    return oform.exists() ? (oform.vm as any).form : undefined;
  };
  const values = (w: any) => getForm(w)?.state.values;
  // Drive the form's own submit so the schema runs + the handler is awaited
  // deterministically (a fire-and-forget native submit would not be).
  const submit = async (w: any) => {
    await getForm(w)?.handleSubmit();
    await flushPromises();
  };

  describe("Loading State", () => {
    it("should show loading spinner initially before getPipelines resolves", async () => {
      let resolve: any;
      mockGetPipelines.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );

      const wrapper = mountComp();

      expect(
        wrapper.find('[data-test="stream-llm-eval-loading"]').exists(),
      ).toBe(true);

      resolve({ data: { list: [] } });
      await flushPromises();
    });

    it("should hide loading spinner after getPipelines resolves", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(
        wrapper.find('[data-test="stream-llm-eval-loading"]').exists(),
      ).toBe(false);
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

      expect(
        wrapper.find('[data-test="stream-llm-eval-enable-toggle"]').exists(),
      ).toBe(true);
    });

    it("should show info banner when disabled (default)", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(
        wrapper.find('[data-test="stream-llm-eval-info-banner"]').exists(),
      ).toBe(true);
    });

    it("should not show config fields when disabled", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(
        wrapper.find('[data-test="stream-llm-eval-span-identifier"]').exists(),
      ).toBe(false);
    });

    it("should seed default output stream name to streamName_evaluations", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(values(wrapper).outputStream).toBe("my-stream_evaluations");
    });

    it("should initialize enabled as false", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(values(wrapper).enabled).toBe(false);
      expect(
        wrapper.find('[data-test="stream-llm-eval-info-banner"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="stream-llm-eval-span-identifier"]').exists(),
      ).toBe(false);
    });

    it("should initialize samplingRate as 0.01", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(values(wrapper).samplingRate).toBe(0.01);
    });
  });

  describe("Required-field indicators", () => {
    // The three fields that become required once evaluation is enabled render
    // the * via the OForm* `required` prop (never a hardcoded asterisk). The
    // whole config section is v-if="enabled", so the fields are always required
    // when visible → a static * is accurate.
    it.each([
      ["spanIdentifier", OFormSelect],
      ["selectedTemplate", OFormSelect],
      ["outputStream", OFormInput],
    ] as const)("shows a required * on %s when enabled", async (name, Comp) => {
      const wrapper = mountComp();
      await flushPromises();

      getForm(wrapper).setFieldValue("enabled", true);
      await flushPromises();

      const field = wrapper
        .findAllComponents(Comp as any)
        .find((c: any) => c.props("name") === name);
      expect(field?.exists()).toBe(true);

      const label = field!.find("label");
      expect(label.exists()).toBe(true);
      expect(label.text()).toContain("*");
    });
  });

  describe("Existing Pipeline (prefill via form.reset)", () => {
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

    it("should enable toggle and reveal config fields when existing pipeline is found", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(values(wrapper).enabled).toBe(true);
      expect(
        wrapper.find('[data-test="stream-llm-eval-info-banner"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="stream-llm-eval-span-identifier"]').exists(),
      ).toBe(true);
    });

    it("should load span identifier from existing pipeline", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(values(wrapper).spanIdentifier).toBe("custom_identifier");
    });

    it("should load sampling rate from existing pipeline", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(values(wrapper).samplingRate).toBe(0.1);
      expect(values(wrapper).enableSampling).toBe(true);
    });

    it("should load output stream name from eval output node", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect(values(wrapper).outputStream).toBe("my-stream-eval-output");
    });
  });

  describe("samplingRatePercent", () => {
    it("should compute samplingRatePercent from samplingRate", async () => {
      const wrapper = mountComp();
      await flushPromises();

      getForm(wrapper).setFieldValue("samplingRate", 0.25);
      await flushPromises();
      expect((wrapper.vm as any).samplingRatePercent).toBe("25");
    });

    it("should show 1% for default 0.01 rate", async () => {
      const wrapper = mountComp();
      await flushPromises();

      expect((wrapper.vm as any).samplingRatePercent).toBe("1");
    });
  });

  describe("markDirty", () => {
    it("should emit dirty when markDirty is called", async () => {
      const wrapper = mountComp();
      await flushPromises();

      (wrapper.vm as any).markDirty();

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
      expect(vm.filteredFields).toEqual([
        { label: "span_id", value: "span_id" },
      ]);
    });

    it("should return all fields when search is empty", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      const mockUpdate = vi.fn((cb: any) => cb());

      vm.filterFields("", mockUpdate);
      expect(vm.filteredFields).toHaveLength(2);
    });
  });

  describe("Error Handling on Mount", () => {
    it("should seed default output stream name when getPipelines fails", async () => {
      mockGetPipelines.mockRejectedValue(new Error("Network error"));

      const wrapper = mountComp();
      await flushPromises();

      expect(values(wrapper).outputStream).toBe("my-stream_evaluations");
      expect((wrapper.vm as any).loading).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Real-OForm validation wiring (per the playbook §5 — at least one test MUST
  // mount the real OForm and prove the schema gates an invalid submit, so an
  // unwired `:schema` (the silent Options-API bug) would be caught).
  describe("OForm schema validation (real form)", () => {
    it("submit is a no-op (warning, no create) when evaluation is disabled", async () => {
      const wrapper = mountComp();
      await flushPromises();

      // enabled=false by default → schema relaxes everything → onSubmit runs
      // but early-returns with a warning toast; no pipeline is created.
      await submit(wrapper);

      expect(getForm(wrapper).state.isValid).toBe(true);
      expect(mockCreatePipeline).not.toHaveBeenCalled();
      expect(mockUpdatePipeline).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "warning" }),
      );
    });

    it("blocks submit and does NOT create when enabled but required fields empty", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("enabled", true);
      form.setFieldValue("spanIdentifier", "");
      form.setFieldValue("selectedTemplate", null);
      form.setFieldValue("outputStream", "");
      await flushPromises();

      await submit(wrapper);

      expect(form.state.isValid).toBe(false);
      expect(mockCreatePipeline).not.toHaveBeenCalled();
    });

    it("reveals required errors after submit, then clears on change (R3)", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("enabled", true);
      form.setFieldValue("spanIdentifier", "");
      form.setFieldValue("selectedTemplate", null);
      form.setFieldValue("outputStream", "");
      await flushPromises();

      // No validation before the first submit.
      expect(wrapper.text()).not.toContain("Field is required!");

      await submit(wrapper);
      expect(wrapper.text()).toContain("Field is required!");

      // Fix every required field → errors clear on change.
      form.setFieldValue("spanIdentifier", "gen_ai_system");
      form.setFieldValue("selectedTemplate", "tmpl-1");
      form.setFieldValue("outputStream", "my_stream_evaluations");
      await flushPromises();
      expect(form.state.isValid).toBe(true);
    });

    it("submits and creates a pipeline when the schema passes", async () => {
      mockGetPipelines
        .mockResolvedValueOnce({ data: { list: [] } }) // initial load
        .mockResolvedValueOnce({ data: { list: [] } }); // reload after create
      mockCreatePipeline.mockResolvedValue({});

      const wrapper = mountComp();
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("enabled", true);
      form.setFieldValue("spanIdentifier", "gen_ai_system");
      form.setFieldValue("selectedTemplate", "tmpl-1");
      form.setFieldValue("enableSampling", true);
      form.setFieldValue("samplingRate", 0.05);
      form.setFieldValue("outputStream", "my_stream_evaluations");
      await flushPromises();

      await submit(wrapper);

      expect(form.state.isValid).toBe(true);
      expect(mockCreatePipeline).toHaveBeenCalledTimes(1);
      const payload = mockCreatePipeline.mock.calls[0][0].data;
      const evalNode = payload.nodes.find(
        (n: any) => n.data?.node_type === "llm_evaluation",
      );
      expect(evalNode.data.llm_span_identifier).toBe("gen_ai_system");
      expect(evalNode.data.sampling_rate).toBe(0.05);
      expect(evalNode.data.eval_template).toBe("tmpl-1");
    });

    it("exposed save() routes through the form (blocks an invalid submit)", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("enabled", true);
      form.setFieldValue("spanIdentifier", "");
      form.setFieldValue("outputStream", "");
      await flushPromises();

      await (wrapper.vm as any).save();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(mockCreatePipeline).not.toHaveBeenCalled();
    });
  });
});
