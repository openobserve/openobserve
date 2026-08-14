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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import NodePalette from "@/components/flow/NodePalette.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

// ---------------------------------------------------------------------------
// Fixture helpers — the shared palette is fully prop-driven (no composable).
// ---------------------------------------------------------------------------

const makeNode = (overrides: Record<string, any> = {}) => ({
  io_type: "default",
  subtype: "function",
  label: "Test Node",
  icon: "settings",
  tooltip: "A test node",
  isSectionHeader: false,
  ...overrides,
});

const makeSectionHeader = (label: string) => ({
  io_type: "section",
  subtype: "header",
  label,
  isSectionHeader: true,
});

const globalConfig = { plugins: [i18n, store] };

async function mountComp(props: Record<string, any> = {}) {
  return mount(NodePalette, {
    props: {
      items: [],
      onDragStart: vi.fn(),
      ...props,
    },
    global: globalConfig,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NodePalette - mounting", () => {
  let wrapper: any = null;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("mounts without errors when items is empty", async () => {
    wrapper = await mountComp({ items: [] });
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the docked sidebar with no header of its own", async () => {
    wrapper = await mountComp({ items: [] });
    expect(wrapper.find(".np-sidebar").exists()).toBe(true);
    // The rail is headerless — the editor labels it from the outside (the
    // collapse toggle), so an in-rail title would only repeat that.
    expect(wrapper.find(".np-header").exists()).toBe(false);
  });

  it("renders no draggable node buttons when items is empty", async () => {
    wrapper = await mountComp({ items: [] });
    expect(wrapper.findAll("[draggable='true']")).toHaveLength(0);
  });
});

describe("NodePalette - draggable buttons for non-section-header nodes", () => {
  let wrapper: any = null;

  const items = [
    makeNode({ io_type: "input", subtype: "stream", label: "Stream Input", icon: "input" }),
    makeNode({ io_type: "output", subtype: "stream", label: "Stream Output", icon: "output" }),
    makeNode({ io_type: "default", subtype: "function", label: "Function", icon: "functions" }),
  ];

  beforeEach(async () => {
    wrapper = await mountComp({ items });
  });
  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("renders one draggable button per non-section-header node", () => {
    expect(wrapper.findAll("[draggable='true']")).toHaveLength(3);
  });

  it("input node button has class o2vf_node_input", () => {
    expect(wrapper.find(".o2vf_node_input").exists()).toBe(true);
  });
  it("output node button has class o2vf_node_output", () => {
    expect(wrapper.find(".o2vf_node_output").exists()).toBe(true);
  });
  it("default node button has class o2vf_node_default", () => {
    expect(wrapper.find(".o2vf_node_default").exists()).toBe(true);
  });
});

describe("NodePalette - section headers", () => {
  let wrapper: any = null;

  const items = [
    makeSectionHeader("Source Nodes"),
    makeNode({ io_type: "input", subtype: "stream", label: "Stream In", icon: "input" }),
    makeSectionHeader("Processing"),
    makeNode({ io_type: "default", subtype: "function", label: "Function", icon: "functions" }),
  ];

  beforeEach(async () => {
    wrapper = await mountComp({ items });
  });
  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("only real nodes are draggable (headers are not)", () => {
    expect(wrapper.findAll("[draggable='true']")).toHaveLength(2);
  });

  it("section header label text is rendered", () => {
    expect(wrapper.text()).toContain("Source Nodes");
    expect(wrapper.text()).toContain("Processing");
  });

  it("section labels render in .np-section elements", () => {
    expect(wrapper.findAll(".np-section")).toHaveLength(2);
  });
});

describe("NodePalette - node label and icon", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    wrapper = await mountComp({
      items: [makeNode({ subtype: "function", label: "My Function", icon: "functions" })],
    });
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
    const icon = wrapper.findComponent(OIcon);
    expect(icon.exists()).toBe(true);
  });
});

describe("NodePalette - drag and click callbacks", () => {
  let wrapper: any = null;
  const onDragStart = vi.fn();
  const onItemClick = vi.fn();
  const inputNode = makeNode({
    io_type: "input",
    subtype: "stream",
    label: "Stream",
    icon: "input",
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = await mountComp({ items: [inputNode], onDragStart, onItemClick });
  });
  afterEach(() => wrapper?.unmount());

  it("onDragStart is called with the event and the node item on dragstart", async () => {
    const btn = wrapper.find("[draggable='true']");
    await btn.trigger("dragstart");
    expect(onDragStart).toHaveBeenCalledTimes(1);
    const [, nodeArg] = onDragStart.mock.calls[0];
    expect(nodeArg).toMatchObject({ io_type: "input", label: "Stream" });
  });

  it("onItemClick is called with the node item on click", async () => {
    const btn = wrapper.find("[draggable='true']");
    await btn.trigger("click");
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick.mock.calls[0][0]).toMatchObject({ subtype: "stream" });
  });
});
