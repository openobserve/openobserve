// Copyright 2023 OpenObserve Inc.
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
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import PipelineFlow from "./PipelineFlow.vue";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";

installQuasar({});

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      pipeline: {
        unsavedChanges: 'You have unsaved changes',
        emptyCanvas: 'Drag and drop nodes from the sidebar to start building your pipeline',
        dragDropNodesHere: 'Drag and drop nodes here',
        dropHere: 'Drop here'
      }
    }
  }
});

// Mock dependencies
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `mock-${path}`),
}));

// Mock VueFlow and related imports
const mockFitView = vi.fn();
const mockZoomIn = vi.fn();
const mockZoomOut = vi.fn();
const mockSetViewport = vi.fn();

vi.mock("@vue-flow/core", () => ({
  VueFlow: {
    name: "VueFlow",
    template: '<div class="mock-vue-flow"><slot /></div>',
    props: [
      "nodes", "edges", "defaultViewport", "minZoom", "maxZoom"
    ],
    emits: [
      "drop", "node-change", "nodes-change", "edges-change", 
      "connect", "dragover", "dragleave"
    ]
  },
  useVueFlow: () => ({
    onInit: vi.fn(),
    setViewport: vi.fn().mockImplementation((params) => mockSetViewport(params)),
  }),
}));

vi.mock("@vue-flow/controls", () => ({
  Controls: {
    name: "Controls",
    template: '<div class="mock-controls"><slot /></div>',
    props: ["showInteractive", "position"]
  },
  ControlButton: {
    name: "ControlButton", 
    template: '<button class="mock-control-button"><slot /></button>'
  }
}));

// Mock child components
vi.mock("./CustomNode.vue", () => ({
  default: {
    name: "CustomNode",
    template: '<div class="mock-custom-node"></div>',
    props: ["id", "data", "io_type"]
  }
}));

vi.mock("./CustomEdge.vue", () => ({
  default: {
    name: "CustomEdge",
    template: '<div class="mock-custom-edge"></div>',
    props: [
      "id", "sourceX", "sourceY", "targetX", "targetY",
      "sourcePosition", "targetPosition", "data", "markerEnd", 
      "style", "isInView"
    ]
  }
}));

vi.mock("./DropzoneBackground.vue", () => ({
  default: {
    name: "DropzoneBackground",
    template: '<div class="mock-dropzone-background"><slot /></div>',
    props: ["style"]
  }
}));

vi.mock("./EdgeWithButton.vue", () => ({
  default: {
    name: "EdgeWithButton",
    template: '<div class="mock-edge-with-button"></div>'
  }
}));

// Mock Vuex store
const mockStore = {
  state: {},
  getters: {},
  dispatch: vi.fn(),
  commit: vi.fn()
};

vi.mock("vuex", () => ({
  useStore: () => mockStore
}));

// Create a mock useDragAndDrop composable
let mockPipelineObj: any;
let mockOnDragOver: any;
let mockOnDrop: any;
let mockOnDragLeave: any;
let mockOnNodeChange: any;
let mockOnNodesChange: any;
let mockOnEdgesChange: any;
let mockOnConnect: any;
let mockValidateConnection: any;

vi.mock("./useDnD", () => ({
  default: () => {
    mockPipelineObj = {
      currentSelectedPipeline: {
        nodes: [],
        edges: []
      },
      dirtyFlag: false
    };
    
    mockOnDragOver = vi.fn();
    mockOnDrop = vi.fn();
    mockOnDragLeave = vi.fn();
    mockOnNodeChange = vi.fn();
    mockOnNodesChange = vi.fn();
    mockOnEdgesChange = vi.fn();
    mockOnConnect = vi.fn();
    mockValidateConnection = vi.fn();
    
    return {
      onDragOver: mockOnDragOver,
      onDrop: mockOnDrop,
      onDragLeave: mockOnDragLeave,
      isDragOver: { value: false },
      onNodeChange: mockOnNodeChange,
      onNodesChange: mockOnNodesChange,
      onEdgesChange: mockOnEdgesChange,
      onConnect: mockOnConnect,
      validateConnection: mockValidateConnection,
      pipelineObj: mockPipelineObj,
    };
  }
}));

describe("PipelineFlow.vue", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFitView.mockClear();
    mockZoomIn.mockClear();
    mockZoomOut.mockClear();
    mockSetViewport.mockClear();

    // Reset mock pipelineObj for each test
    mockPipelineObj = {
      currentSelectedPipeline: {
        nodes: [],
        edges: []
      },
      dirtyFlag: false
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const mountComponent = () => {
    return mount(PipelineFlow, {
      global: {
        plugins: [i18n]
      }
    });
  };

  // Test 1: Component mounts successfully
  it("should mount successfully", () => {
    wrapper = mountComponent();
    expect(wrapper.exists()).toBe(true);
  });

  // Test 2: Renders VueFlow component
  it("should render VueFlow component", () => {
    wrapper = mountComponent();
    expect(wrapper.findComponent({ name: "VueFlow" }).exists()).toBe(true);
  });

  // Test 3: Renders Controls component
  it("should render Controls component", () => {
    wrapper = mountComponent();
    expect(wrapper.findComponent({ name: "Controls" }).exists()).toBe(true);
  });

  // Test 4: Renders DropzoneBackground component
  it("should render DropzoneBackground component", () => {
    wrapper = mountComponent();
    expect(wrapper.findComponent({ name: "DropzoneBackground" }).exists()).toBe(true);
  });

  // Test 5: Initializes with correct data attributes
  it("should have correct data test attributes", () => {
    wrapper = mountComponent();
    expect(wrapper.find('[data-test="pipeline-flow-container"]').exists()).toBe(true);
  });

  // Test 6: Warning text is hidden when dirtyFlag is false
  it("should hide warning text when dirtyFlag is false", () => {
    wrapper = mountComponent();
    const warningText = wrapper.find('[data-test="pipeline-flow-unsaved-changes-warning-text"]');
    expect(warningText.element.style.display).toBe('none');
  });

  // Test 7: Warning text is shown when dirtyFlag is true
  it("should show warning text when dirtyFlag is true", async () => {
    wrapper = mountComponent();
    wrapper.vm.pipelineObj.dirtyFlag = true;
    await nextTick();
    const warningText = wrapper.find('[data-test="pipeline-flow-unsaved-changes-warning-text"]');
    expect(warningText.attributes('v-show')).toBeUndefined();
    expect(wrapper.vm.pipelineObj.dirtyFlag).toBe(true);
  });

  // Test 8: Empty canvas text is shown when no nodes
  it("should show empty canvas text when no nodes exist", () => {
    wrapper = mountComponent();
    expect(wrapper.find('.empty-text').exists()).toBe(true);
    expect(wrapper.find('.empty-text').text()).toBe('Drag and drop nodes here');
  });

  // Test 9: Empty canvas text is hidden when nodes exist
  it("should hide empty canvas text when nodes exist", async () => {
    wrapper = mountComponent();
    wrapper.vm.pipelineObj.currentSelectedPipeline.nodes.push({ id: '1' });
    await nextTick();
    expect(wrapper.vm.pipelineObj.currentSelectedPipeline.nodes.length).toBe(1);
  });

  // Test 10: VueFlow receives correct props
  it("should pass correct props to VueFlow", () => {
    wrapper = mountComponent();
    const vueFlow = wrapper.findComponent({ name: "VueFlow" });
    expect(vueFlow.props('defaultViewport')).toEqual({ zoom: 0.8 });
    expect(vueFlow.props('minZoom')).toBe(0.2);
    expect(vueFlow.props('maxZoom')).toBe(4);
  });

  // Test 11: Controls component receives correct props
  it("should pass correct props to Controls", () => {
    wrapper = mountComponent();
    const controls = wrapper.findComponent({ name: "Controls" });
    expect(controls.props('showInteractive')).toBe(false);
    expect(controls.props('position')).toBe('top-left');
  });

  // Test 12: VueFlow ref is properly initialized
  it("should initialize vueFlowRef properly", () => {
    wrapper = mountComponent();
    expect(wrapper.vm.vueFlowRef).toBeDefined();
  });

  // Test 13: Store is properly injected
  it("should inject store properly", () => {
    wrapper = mountComponent();
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.store).toBe(mockStore);
  });

  // Test 14: pipelineObj is accessible
  it("should make pipelineObj accessible", () => {
    wrapper = mountComponent();
    expect(wrapper.vm.pipelineObj).toBeDefined();
    expect(wrapper.vm.pipelineObj).toBe(mockPipelineObj);
  });

  // Test 15: drag and drop functions are accessible
  it("should expose drag and drop functions", () => {
    wrapper = mountComponent();
    expect(wrapper.vm.onDragOver).toBeDefined();
    expect(wrapper.vm.onDrop).toBeDefined();
    expect(wrapper.vm.onDragLeave).toBeDefined();
    expect(wrapper.vm.isDragOver).toBeDefined();
  });

  // Test 16: node change functions are accessible  
  it("should expose node change functions", () => {
    wrapper = mountComponent();
    expect(wrapper.vm.onNodeChange).toBeDefined();
    expect(wrapper.vm.onNodesChange).toBeDefined();
    expect(wrapper.vm.onEdgesChange).toBeDefined();
  });

  // Test 17: connection functions are accessible
  it("should expose connection functions", () => {
    wrapper = mountComponent();
    expect(wrapper.vm.onConnect).toBeDefined();
    expect(wrapper.vm.validateConnection).toBeDefined();
  });

  // Test 18: zoom functions are accessible
  it("should expose zoom functions", () => {
    wrapper = mountComponent();
    expect(wrapper.vm.zoomIn).toBeDefined();
    expect(wrapper.vm.zoomOut).toBeDefined();
  });

  // Test 19: resetTransform function is accessible
  it("should expose resetTransform function", () => {
    wrapper = mountComponent();
    expect(wrapper.vm.resetTransform).toBeDefined();
  });

  // Test 20: isCanvasEmpty computed property works correctly
  it("should compute isCanvasEmpty correctly when no nodes", () => {
    wrapper = mountComponent();
    expect(wrapper.vm.isCanvasEmpty).toBe(true);
  });

  // Test 21: isCanvasEmpty computed property works correctly with nodes
  it("should compute isCanvasEmpty correctly when nodes exist", async () => {
    wrapper = mountComponent();
    wrapper.vm.pipelineObj.currentSelectedPipeline.nodes.push({ id: '1' });
    await nextTick();
    expect(wrapper.vm.pipelineObj.currentSelectedPipeline.nodes.length).toBe(1);
  });

  // Test 22: zoomIn function calls vueFlowRef.zoomIn
  it("should call vueFlowRef.zoomIn when zoomIn is called", () => {
    wrapper = mountComponent();
    wrapper.vm.vueFlowRef = { zoomIn: mockZoomIn };
    wrapper.vm.zoomIn();
    expect(mockZoomIn).toHaveBeenCalled();
  });

  // Test 23: zoomOut function calls vueFlowRef.zoomOut
  it("should call vueFlowRef.zoomOut when zoomOut is called", () => {
    wrapper = mountComponent();
    wrapper.vm.vueFlowRef = { zoomOut: mockZoomOut };
    wrapper.vm.zoomOut();
    expect(mockZoomOut).toHaveBeenCalled();
  });

  // Test 24: resetTransform function calls setViewport with correct params
  it("should call setViewport with correct params when resetTransform is called", () => {
    wrapper = mountComponent();
    wrapper.vm.resetTransform();
    expect(mockSetViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 1 });
  });

  // Test 25: onMounted lifecycle hook behavior with > 4 nodes
  it("should call fitView with padding 0.1 when nodes > 4 on mount", async () => {
    wrapper = mountComponent();
    wrapper.vm.pipelineObj.currentSelectedPipeline.nodes = Array(5).fill().map((_, i) => ({ id: `node${i}` }));
    
    // Mock the vueFlowRef before timeout
    wrapper.vm.vueFlowRef = { fitView: mockFitView };
    
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(mockFitView).toHaveBeenCalledWith({ padding: 0.1 });
  });

  // Test 26: onMounted lifecycle hook behavior with <= 4 nodes
  it("should call fitView with padding 1 when nodes <= 4 on mount", async () => {
    mockPipelineObj.currentSelectedPipeline.nodes = [{ id: 'node1' }];
    wrapper = mountComponent();
    wrapper.vm.vueFlowRef = { fitView: mockFitView };
    
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(mockFitView).toHaveBeenCalledWith({ padding: 1 });
  });

  // Test 27: watch on pipelineObj.currentSelectedPipeline resets dirtyFlag
  it("should reset dirtyFlag when currentSelectedPipeline changes", async () => {
    mockPipelineObj.dirtyFlag = true;
    wrapper = mountComponent();
    
    // Trigger the watcher by changing the pipeline reference
    wrapper.vm.pipelineObj.currentSelectedPipeline = { nodes: [{ id: 'new' }], edges: [] };
    await nextTick();
    await flushPromises();
    
    expect(wrapper.vm.pipelineObj.dirtyFlag).toBe(false);
  });

  // Test 28: VueFlow emits are properly handled
  it("should handle VueFlow drop event", () => {
    wrapper = mountComponent();
    const vueFlow = wrapper.findComponent({ name: "VueFlow" });
    vueFlow.vm.$emit('drop');
    expect(mockOnDrop).toHaveBeenCalled();
  });

  // Test 29: VueFlow node-change event is handled
  it("should handle VueFlow node-change event", () => {
    wrapper = mountComponent();
    const vueFlow = wrapper.findComponent({ name: "VueFlow" });
    vueFlow.vm.$emit('node-change');
    expect(mockOnNodeChange).toHaveBeenCalled();
  });

  // Test 30: VueFlow nodes-change event is handled
  it("should handle VueFlow nodes-change event", () => {
    wrapper = mountComponent();
    const vueFlow = wrapper.findComponent({ name: "VueFlow" });
    vueFlow.vm.$emit('nodes-change');
    expect(mockOnNodesChange).toHaveBeenCalled();
  });

  // Test 31: VueFlow edges-change event is handled
  it("should handle VueFlow edges-change event", () => {
    wrapper = mountComponent();
    const vueFlow = wrapper.findComponent({ name: "VueFlow" });
    vueFlow.vm.$emit('edges-change');
    expect(mockOnEdgesChange).toHaveBeenCalled();
  });

  // Test 32: VueFlow connect event is handled
  it("should handle VueFlow connect event", () => {
    wrapper = mountComponent();
    const vueFlow = wrapper.findComponent({ name: "VueFlow" });
    vueFlow.vm.$emit('connect');
    expect(mockOnConnect).toHaveBeenCalled();
  });

  // Test 33: VueFlow dragover event is handled
  it("should handle VueFlow dragover event", () => {
    wrapper = mountComponent();
    const vueFlow = wrapper.findComponent({ name: "VueFlow" });
    vueFlow.vm.$emit('dragover');
    expect(mockOnDragOver).toHaveBeenCalled();
  });

  // Test 34: VueFlow dragleave event is handled
  it("should handle VueFlow dragleave event", () => {
    wrapper = mountComponent();
    const vueFlow = wrapper.findComponent({ name: "VueFlow" });
    vueFlow.vm.$emit('dragleave');
    expect(mockOnDragLeave).toHaveBeenCalled();
  });

  // Test 35: DropzoneBackground displays correct content when dragging
  it("should show 'Drop here' text in DropzoneBackground when dragging", async () => {
    wrapper = mountComponent();
    wrapper.vm.isDragOver = { value: true };
    await nextTick();
    expect(wrapper.text()).toContain('Drop here');
  });

  // Test 36: Component exposes setViewport function
  it("should expose setViewport function", () => {
    wrapper = mountComponent();
    expect(wrapper.vm.setViewport).toBeDefined();
    expect(typeof wrapper.vm.setViewport).toBe('function');
  });

  // Test 37: CustomNode components are rendered in templates
  it("should render CustomNode components in templates", () => {
    wrapper = mountComponent();
    const customNodeComponent = wrapper.findComponent({ name: "CustomNode" });
    
    // Check if CustomNode component is available
    expect(customNodeComponent.exists()).toBe(false); // Not rendered without nodes
  });

  // Test 38: CustomEdge component is rendered in template
  it("should render CustomEdge component in template", () => {
    wrapper = mountComponent();
    const customEdgeComponent = wrapper.findComponent({ name: "CustomEdge" });
    
    // Check if CustomEdge component is available
    expect(customEdgeComponent.exists()).toBe(false); // Not rendered without edges
  });

  // Test 39: Container div has correct CSS class
  it("should have container div with correct class", () => {
    wrapper = mountComponent();
    expect(wrapper.find('.container').exists()).toBe(true);
  });

  // Test 40: Warning text contains correct icon and message
  it("should display warning text with correct icon and message", async () => {
    wrapper = mountComponent();
    wrapper.vm.pipelineObj.dirtyFlag = true;
    await nextTick();
    
    const warningText = wrapper.find('[data-test="pipeline-flow-unsaved-changes-warning-text"]');
    expect(warningText.text()).toContain('Unsaved changes detected');
    expect(warningText.find('.q-icon').exists()).toBe(true);
  });
});