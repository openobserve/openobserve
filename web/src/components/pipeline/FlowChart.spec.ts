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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";

installQuasar({ plugins: [Dialog, Notify] });

vi.mock("@vue-flow/core", () => ({
  VueFlow: {
    template: '<div class="vue-flow-stub"><slot /></div>',
    props: ["nodes", "edges", "modelValueNodes", "modelValueEdges"],
  },
  MarkerType: { ArrowClosed: "arrowclosed" },
  Edge: {},
}));

// FlowChart imports CSS from @vue-flow/core — mock those too so Vite doesn't
// try to process them in the test environment.
vi.mock("@vue-flow/core/dist/style.css", () => ({}));
vi.mock("@vue-flow/core/dist/theme-default.css", () => ({}));

import FlowChart from "@/components/pipeline/FlowChart.vue";

const globalConfig = {
  plugins: [i18n],
};

async function mountComp() {
  return mount(FlowChart, { global: globalConfig });
}

describe("FlowChart - rendering", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    wrapper = await mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("mounts without errors", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the #graph-container div", () => {
    expect(wrapper.find("#graph-container").exists()).toBe(true);
  });

  it("renders the VueFlow stub inside the container", () => {
    expect(wrapper.find(".vue-flow-stub").exists()).toBe(true);
  });
});

describe("FlowChart - initial nodes", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    wrapper = await mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("has 4 initial nodes", () => {
    const nodes = (wrapper.vm as any).nodes;
    expect(nodes).toHaveLength(4);
  });

  it("node with id '1' has type 'input'", () => {
    const nodes = (wrapper.vm as any).nodes;
    const node1 = nodes.find((n: any) => n.id === "1");
    expect(node1).toBeDefined();
    expect(node1.type).toBe("input");
  });

  it("node with id '1' has label 'Node 1'", () => {
    const nodes = (wrapper.vm as any).nodes;
    const node1 = nodes.find((n: any) => n.id === "1");
    expect(node1.label).toBe("Node 1");
  });

  it("node with id '2' has no explicit type", () => {
    const nodes = (wrapper.vm as any).nodes;
    const node2 = nodes.find((n: any) => n.id === "2");
    expect(node2).toBeDefined();
    expect(node2.type).toBeUndefined();
  });

  it("all four nodes have unique ids", () => {
    const nodes = (wrapper.vm as any).nodes;
    const ids = nodes.map((n: any) => n.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("node positions are defined as objects with x and y", () => {
    const nodes = (wrapper.vm as any).nodes;
    for (const node of nodes) {
      expect(node.position).toBeDefined();
      expect(typeof node.position.x).toBe("number");
      expect(typeof node.position.y).toBe("number");
    }
  });
});

describe("FlowChart - initial edges", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    wrapper = await mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("has 2 initial edges", () => {
    const edges = (wrapper.vm as any).edges;
    expect(edges).toHaveLength(2);
  });

  it("edge e1-2 connects source '1' to target '2'", () => {
    const edges = (wrapper.vm as any).edges;
    const e = edges.find((edge: any) => edge.id === "e1-2");
    expect(e).toBeDefined();
    expect(e.source).toBe("1");
    expect(e.target).toBe("2");
  });

  it("edge e1-2 is animated", () => {
    const edges = (wrapper.vm as any).edges;
    const e = edges.find((edge: any) => edge.id === "e1-2");
    expect(e.animated).toBe(true);
  });

  it("edge e1-3 is NOT animated (animated property is undefined)", () => {
    const edges = (wrapper.vm as any).edges;
    const e = edges.find((edge: any) => edge.id === "e1-3");
    expect(e.animated).toBeUndefined();
  });

  it("edge e1-3 connects source '1' to target '3'", () => {
    const edges = (wrapper.vm as any).edges;
    const e = edges.find((edge: any) => edge.id === "e1-3");
    expect(e.source).toBe("1");
    expect(e.target).toBe("3");
  });

  it("both edges have a markerEnd with type 'arrowclosed'", () => {
    const edges = (wrapper.vm as any).edges;
    for (const edge of edges) {
      expect(edge.markerEnd).toBeDefined();
      expect(edge.markerEnd.type).toBe("arrowclosed");
    }
  });
});

describe("FlowChart - VueFlow stub props", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    wrapper = await mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("VueFlow stub element is present in the rendered output", () => {
    // The mock renders as <div class="vue-flow-stub">
    expect(wrapper.find(".vue-flow-stub").exists()).toBe(true);
  });
});
