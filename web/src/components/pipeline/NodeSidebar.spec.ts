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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

const mockOnDragStart = vi.fn();
const mockPipelineObj = { value: { nodes: [], edges: [] } };

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: vi.fn(() => ({
    onDragStart: mockOnDragStart,
    pipelineObj: mockPipelineObj,
  })),
}));

import NodeSidebar from "@/components/pipeline/NodeSidebar.vue";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const makeNode = (overrides: Record<string, any> = {}) => ({
  io_type: "default",
  label: "Test Node",
  icon: "settings",
  tooltip: "A test node",
  isSectionHeader: false,
  ...overrides,
});

const makeSectionHeader = (label: string) => ({
  io_type: "section",
  label,
  isSectionHeader: true,
});

const globalConfig = {
  plugins: [i18n, store],
};

async function mountComp(props: Record<string, any> = {}) {
  return mount(NodeSidebar, {
    props: {
      nodeTypes: [],
      hasInputType: false,
      ...props,
    },
    global: globalConfig,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NodeSidebar - mounting", () => {
  let wrapper: any = null;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("mounts without errors when nodeTypes is empty", async () => {
    wrapper = await mountComp({ nodeTypes: [] });
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the .nodes container div", async () => {
    wrapper = await mountComp({ nodeTypes: [] });
    expect(wrapper.find(".nodes").exists()).toBe(true);
  });

  it("renders no buttons when nodeTypes is empty", async () => {
    wrapper = await mountComp({ nodeTypes: [] });
    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(0);
  });
});

describe("NodeSidebar - draggable buttons for non-section-header nodes", () => {
  let wrapper: any = null;

  const nodeTypes = [
    makeNode({ io_type: "input", label: "Stream Input", icon: "input" }),
    makeNode({ io_type: "output", label: "Stream Output", icon: "output" }),
    makeNode({ io_type: "default", label: "Function", icon: "functions" }),
  ];

  beforeEach(async () => {
    wrapper = await mountComp({ nodeTypes });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("renders correct number of draggable buttons for non-section-header nodes", () => {
    // Quasar q-btn renders as <button> in the test environment
    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(3);
  });

  it("each button has draggable='true' attribute", () => {
    const draggableButtons = wrapper.findAll("[draggable='true']");
    expect(draggableButtons).toHaveLength(3);
  });

  it("input node button has class o2vf_node_input", () => {
    const btn = wrapper.find(".o2vf_node_input");
    expect(btn.exists()).toBe(true);
  });

  it("output node button has class o2vf_node_output", () => {
    const btn = wrapper.find(".o2vf_node_output");
    expect(btn.exists()).toBe(true);
  });

  it("default node button has class o2vf_node_default", () => {
    const btn = wrapper.find(".o2vf_node_default");
    expect(btn.exists()).toBe(true);
  });
});

describe("NodeSidebar - section headers", () => {
  let wrapper: any = null;

  const nodeTypes = [
    makeSectionHeader("Source Nodes"),
    makeNode({ io_type: "input", label: "Stream In", icon: "input" }),
    makeSectionHeader("Processing"),
    makeNode({ io_type: "default", label: "Function", icon: "functions" }),
  ];

  beforeEach(async () => {
    wrapper = await mountComp({ nodeTypes });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("section headers render as divs not buttons", () => {
    // There are 2 headers and 2 real nodes → only 2 buttons
    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(2);
  });

  it("section header label text is rendered", () => {
    expect(wrapper.text()).toContain("Source Nodes");
    expect(wrapper.text()).toContain("Processing");
  });

  it("section headers are not draggable", () => {
    // Only the 2 real nodes should have draggable=true
    const draggableEls = wrapper.findAll("[draggable='true']");
    expect(draggableEls).toHaveLength(2);
  });
});

describe("NodeSidebar - node label and icon", () => {
  let wrapper: any = null;

  const nodeTypes = [
    makeNode({
      io_type: "default",
      label: "My Function",
      icon: "functions",
    }),
  ];

  beforeEach(async () => {
    wrapper = await mountComp({ nodeTypes });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("node label text is rendered in .node-label element", () => {
    const label = wrapper.find(".node-label");
    expect(label.exists()).toBe(true);
    expect(label.text()).toContain("My Function");
  });

  it("node icon is rendered with the correct name", () => {
    // OIcon renders as <i class="OIcon ...">icon_name</i> in tests
    const icon = wrapper.find(".OIcon");
    expect(icon.exists()).toBe(true);
    // The icon name appears as text content inside OIcon stubs
    expect(icon.text()).toContain("functions");
  });
});

describe("NodeSidebar - dragstart event", () => {
  let wrapper: any = null;

  const inputNode = makeNode({ io_type: "input", label: "Stream", icon: "input" });

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = await mountComp({ nodeTypes: [inputNode] });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("onDragStart is called when a node button is dragged", async () => {
    const btn = wrapper.find("[draggable='true']");
    expect(btn.exists()).toBe(true);
    await btn.trigger("dragstart");
    expect(mockOnDragStart).toHaveBeenCalledTimes(1);
  });

  it("onDragStart is called with the drag event and the node object", async () => {
    const btn = wrapper.find("[draggable='true']");
    await btn.trigger("dragstart");
    const [, nodeArg] = mockOnDragStart.mock.calls[0];
    expect(nodeArg).toMatchObject({ io_type: "input", label: "Stream" });
  });
});

describe("NodeSidebar - hasInputType prop", () => {
  let wrapper: any = null;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("accepts hasInputType=true without error", async () => {
    wrapper = await mountComp({
      nodeTypes: [makeNode({ io_type: "input", label: "Stream", icon: "input" })],
      hasInputType: true,
    });
    expect(wrapper.exists()).toBe(true);
  });

  it("accepts hasInputType=false without error", async () => {
    wrapper = await mountComp({
      nodeTypes: [makeNode({ io_type: "input", label: "Stream", icon: "input" })],
      hasInputType: false,
    });
    expect(wrapper.exists()).toBe(true);
  });
});
