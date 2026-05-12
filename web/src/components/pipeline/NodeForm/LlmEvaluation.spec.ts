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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

vi.mock("vue-router", async () => {
  const actual = await vi.importActual("vue-router");
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    useRoute: () => ({ params: {}, query: {} }),
  };
});

const mockAddNode = vi.fn();
const mockDeletePipelineNode = vi.fn();

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: vi.fn(() => ({
    pipelineObj: {
      isEditNode: false,
      currentSelectedNodeID: "node-1",
      currentSelectedNodeData: {
        data: {
          name: "",
          llm_span_identifier: "gen_ai_system",
          sampling_rate: 0.01,
        },
      },
      currentSelectedPipeline: {
        nodes: [
          {
            id: "input-1",
            io_type: "input",
            data: {
              node_type: "stream",
              stream_name: "test-stream",
              stream_type: "logs",
            },
          },
        ],
      },
      userSelectedNode: {},
      userClickedNode: {},
    },
    addNode: mockAddNode,
    deletePipelineNode: mockDeletePipelineNode,
  })),
}));

const mockGetStream = vi.fn().mockResolvedValue({
  schema: [{ name: "field1" }, { name: "field2" }, { name: "gen_ai_system" }],
});

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: mockGetStream,
  }),
}));

import LlmEvaluation from "./LlmEvaluation.vue";

const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "size", "showClose", "title", "width", "persistent"],
  emits: ["update:open"],
  template: '<div class="o-drawer-stub"><slot /></div>',
};

function createWrapper(overrides: Record<string, any> = {}): VueWrapper<any> {
  return mount(LlmEvaluation, {
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: ODrawerStub,
        ConfirmDialog: {
          template: '<div data-test="confirm-dialog-stub"></div>',
          props: ["modelValue", "title", "message"],
          emits: ["update:ok", "update:cancel", "update:modelValue"],
        },
      },
      ...overrides,
    },
  });
}

describe("LlmEvaluation - rendering", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = createWrapper();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("mounts without errors", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("renders data-test='llm-evaluation-node-section'", () => {
    expect(
      wrapper.find('[data-test="llm-evaluation-node-section"]').exists()
    ).toBe(true);
  });

  it("renders data-test='llm-evaluation-node-name-input'", () => {
    expect(
      wrapper.find('[data-test="llm-evaluation-node-name-input"]').exists()
    ).toBe(true);
  });

  it("renders data-test='llm-evaluation-span-identifier-select'", () => {
    expect(
      wrapper
        .find('[data-test="llm-evaluation-span-identifier-select"]')
        .exists()
    ).toBe(true);
  });

  it("renders data-test='llm-evaluation-enable-sampling-toggle'", () => {
    expect(
      wrapper
        .find('[data-test="llm-evaluation-enable-sampling-toggle"]')
        .exists()
    ).toBe(true);
  });

  it("renders the save button", () => {
    expect(
      wrapper.find('[data-test="llm-evaluation-save-btn"]').exists()
    ).toBe(true);
  });

  it("renders the cancel button", () => {
    expect(
      wrapper.find('[data-test="llm-evaluation-cancel-btn"]').exists()
    ).toBe(true);
  });
});

describe("LlmEvaluation - initial state", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = createWrapper();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("nodeName defaults to 'evaluate' when not in edit mode", () => {
    // In non-edit mode (isEditNode: false), onMounted sets nodeName to "evaluate"
    expect((wrapper.vm as any).nodeName).toBe("evaluate");
  });

  it("enableSampling is true by default (component default ref value)", () => {
    // The ref default is true
    expect((wrapper.vm as any).enableSampling).toBe(true);
  });

  it("samplingRate defaults to 0.01", () => {
    expect((wrapper.vm as any).samplingRate).toBe(0.01);
  });

  it("llmSpanIdentifier defaults to 'gen_ai_system'", () => {
    expect((wrapper.vm as any).llmSpanIdentifier).toBe("gen_ai_system");
  });

  it("loadingFields starts as false after mount completes", async () => {
    expect((wrapper.vm as any).loadingFields).toBe(false);
  });
});

describe("LlmEvaluation - sampling rate slider visibility", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = createWrapper();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("sampling rate slider is visible when enableSampling is true", async () => {
    (wrapper.vm as any).enableSampling = true;
    await nextTick();
    expect(
      wrapper.find('[data-test="llm-evaluation-sampling-rate-slider"]').exists()
    ).toBe(true);
  });

  it("sampling rate slider is hidden when enableSampling is false", async () => {
    (wrapper.vm as any).enableSampling = false;
    await nextTick();
    expect(
      wrapper.find('[data-test="llm-evaluation-sampling-rate-slider"]').exists()
    ).toBe(false);
  });

  it("sampling rate display text reflects samplingRate value when enabled", async () => {
    (wrapper.vm as any).enableSampling = true;
    (wrapper.vm as any).samplingRate = 0.5;
    await nextTick();
    expect(wrapper.text()).toContain("50%");
  });
});

describe("LlmEvaluation - saveLlmEvaluationNode validation", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = createWrapper();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("does not call addNode when nodeName is empty", async () => {
    (wrapper.vm as any).nodeName = "";
    await (wrapper.vm as any).saveLlmEvaluationNode();
    expect(mockAddNode).not.toHaveBeenCalled();
  });

  it("does not call addNode when nodeName is only whitespace", async () => {
    (wrapper.vm as any).nodeName = "   ";
    await (wrapper.vm as any).saveLlmEvaluationNode();
    expect(mockAddNode).not.toHaveBeenCalled();
  });

  it("calls addNode when nodeName is valid", async () => {
    (wrapper.vm as any).nodeName = "my-llm-node";
    await (wrapper.vm as any).saveLlmEvaluationNode();
    expect(mockAddNode).toHaveBeenCalledOnce();
  });

  it("calls addNode with correct node_type='llm_evaluation'", async () => {
    (wrapper.vm as any).nodeName = "my-llm-node";
    await (wrapper.vm as any).saveLlmEvaluationNode();
    expect(mockAddNode).toHaveBeenCalledWith(
      expect.objectContaining({ node_type: "llm_evaluation" })
    );
  });

  it("calls addNode with enable_llm_judge=true", async () => {
    (wrapper.vm as any).nodeName = "my-llm-node";
    await (wrapper.vm as any).saveLlmEvaluationNode();
    expect(mockAddNode).toHaveBeenCalledWith(
      expect.objectContaining({ enable_llm_judge: true })
    );
  });

  it("passes sampling_rate=0 when enableSampling is false", async () => {
    (wrapper.vm as any).nodeName = "my-llm-node";
    (wrapper.vm as any).enableSampling = false;
    await (wrapper.vm as any).saveLlmEvaluationNode();
    expect(mockAddNode).toHaveBeenCalledWith(
      expect.objectContaining({ sampling_rate: 0.0 })
    );
  });

  it("passes the actual samplingRate value when enableSampling is true", async () => {
    (wrapper.vm as any).nodeName = "my-llm-node";
    (wrapper.vm as any).enableSampling = true;
    (wrapper.vm as any).samplingRate = 0.75;
    await (wrapper.vm as any).saveLlmEvaluationNode();
    expect(mockAddNode).toHaveBeenCalledWith(
      expect.objectContaining({ sampling_rate: 0.75 })
    );
  });

  it("trims whitespace from nodeName before saving", async () => {
    (wrapper.vm as any).nodeName = "  trimmed-node  ";
    await (wrapper.vm as any).saveLlmEvaluationNode();
    expect(mockAddNode).toHaveBeenCalledWith(
      expect.objectContaining({ name: "trimmed-node" })
    );
  });

  it("emits 'cancel:hideform' after successful save", async () => {
    (wrapper.vm as any).nodeName = "valid-node";
    await (wrapper.vm as any).saveLlmEvaluationNode();
    expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
  });

  it("does not emit 'cancel:hideform' when nodeName is empty", async () => {
    (wrapper.vm as any).nodeName = "";
    await (wrapper.vm as any).saveLlmEvaluationNode();
    expect(wrapper.emitted("cancel:hideform")).toBeFalsy();
  });
});

describe("LlmEvaluation - filterStreamFields", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = createWrapper();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("returns all fields for an empty filter string", () => {
    const update = vi.fn((cb: () => void) => cb());
    (wrapper.vm as any).filterStreamFields("", update);
    expect((wrapper.vm as any).filteredStreamFields).toHaveLength(3);
  });

  it("filters fields case-insensitively by label", () => {
    const update = vi.fn((cb: () => void) => cb());
    (wrapper.vm as any).filterStreamFields("FIELD", update);
    const labels = (wrapper.vm as any).filteredStreamFields.map(
      (f: any) => f.label
    );
    expect(labels).toContain("field1");
    expect(labels).toContain("field2");
    expect(labels).not.toContain("gen_ai_system");
  });

  it("filters fields by partial lowercase match", () => {
    const update = vi.fn((cb: () => void) => cb());
    (wrapper.vm as any).filterStreamFields("gen", update);
    const labels = (wrapper.vm as any).filteredStreamFields.map(
      (f: any) => f.label
    );
    expect(labels).toContain("gen_ai_system");
    expect(labels).not.toContain("field1");
  });

  it("returns empty array when no fields match the filter", () => {
    const update = vi.fn((cb: () => void) => cb());
    (wrapper.vm as any).filterStreamFields("xyznotfound", update);
    expect((wrapper.vm as any).filteredStreamFields).toHaveLength(0);
  });

  it("calls the update callback", () => {
    const update = vi.fn((cb: () => void) => cb());
    (wrapper.vm as any).filterStreamFields("field", update);
    expect(update).toHaveBeenCalledOnce();
  });
});

describe("LlmEvaluation - fetchSourceStreamFields", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = createWrapper();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("calls getStream on mount to load stream fields", () => {
    expect(mockGetStream).toHaveBeenCalledOnce();
  });

  it("populates filteredStreamFields after mount", () => {
    expect((wrapper.vm as any).filteredStreamFields).toHaveLength(3);
  });

  it("filteredStreamFields contains objects with label and value", () => {
    const fields: any[] = (wrapper.vm as any).filteredStreamFields;
    for (const field of fields) {
      expect(field).toHaveProperty("label");
      expect(field).toHaveProperty("value");
    }
  });
});

describe("LlmEvaluation - dark mode class", () => {
  it("applies bg-dark class when store theme is dark", async () => {
    // The test store has theme: 'dark'
    const wrapper = createWrapper();
    await flushPromises();
    const section = wrapper.find('[data-test="llm-evaluation-node-section"]');
    expect(section.classes()).toContain("bg-dark");
    wrapper.unmount();
  });
});

describe("LlmEvaluation - edit mode", () => {
  it("shows delete button when isEditNode is true", async () => {
    // Override useDnD to simulate edit mode
    const { default: useDnD } = await import("@/plugins/pipelines/useDnD");
    (useDnD as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      pipelineObj: {
        isEditNode: true,
        currentSelectedNodeID: "node-edit",
        currentSelectedNodeData: {
          data: {
            name: "existing-node",
            llm_span_identifier: "gen_ai_system",
            sampling_rate: 0.5,
          },
        },
        currentSelectedPipeline: { nodes: [] },
        userSelectedNode: {},
        userClickedNode: {},
      },
      addNode: mockAddNode,
      deletePipelineNode: mockDeletePipelineNode,
    });

    const w = createWrapper();
    await flushPromises();
    expect(
      w.find('[data-test="llm-evaluation-delete-btn"]').exists()
    ).toBe(true);
    w.unmount();
  });
});

describe("LlmEvaluation - close icon button", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = createWrapper();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("emits 'cancel:hideform' when the header close button is clicked", async () => {
    vi.useFakeTimers();
    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.exists()).toBe(true);
    drawer.vm.$emit("update:open", false);
    vi.advanceTimersByTime(400);
    await nextTick();
    expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    vi.useRealTimers();
  });
});

describe("LlmEvaluation - dialog behavior", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = createWrapper();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("dialog.show is false by default", () => {
    expect((wrapper.vm as any).dialog.show).toBe(false);
  });

  it("openCancelDialog sets dialog.show to true", async () => {
    await (wrapper.vm as any).openCancelDialog();
    expect((wrapper.vm as any).dialog.show).toBe(true);
  });

  it("openCancelDialog sets an okCallback that emits cancel:hideform", async () => {
    await (wrapper.vm as any).openCancelDialog();
    (wrapper.vm as any).dialog.okCallback();
    await nextTick();
    expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
  });
});
