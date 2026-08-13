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

import { describe, it, expect, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import ViewDependenciesDrawer from "./ViewDependenciesDrawer.vue";
import i18n from "@/locales";

const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "title", "size", "side", "bleed"],
  emits: ["update:open"],
  template: `<div class="odrawer-stub" :data-open="open" :data-title="title" :data-side="side"><slot /></div>`,
};
const GraphStub = {
  name: "AlertDependenciesGraph",
  // Boolean-typed so the bare `embedded` attribute coerces to true.
  props: { embedded: { type: Boolean, default: false }, focus: { type: Object, default: null } },
  emits: ["deleted", "close"],
  template: `<div class="graph-stub" :data-focus="focus ? focus.name : ''" />`,
};

function mountDrawer(props: Record<string, unknown> = {}): VueWrapper {
  return mount(ViewDependenciesDrawer, {
    props: { open: true, focus: { kind: "template", name: "tpl-x" }, ...props },
    global: {
      plugins: [i18n],
      stubs: { ODrawer: ODrawerStub, AlertDependenciesGraph: GraphStub },
    },
  });
}

describe("ViewDependenciesDrawer", () => {
  let wrapper: VueWrapper;
  afterEach(() => wrapper?.unmount());

  it("is a right-hand drawer that renders the focused graph (embedded) while open", () => {
    wrapper = mountDrawer({ open: true });
    expect(wrapper.find(".odrawer-stub").attributes("data-side")).toBe("right");
    const graph = wrapper.findComponent(GraphStub);
    expect(graph.exists()).toBe(true);
    expect(graph.props("embedded")).toBe(true);
    expect(graph.props("focus")).toMatchObject({ kind: "template", name: "tpl-x" });
  });

  it("does not render the graph when closed", () => {
    wrapper = mountDrawer({ open: false });
    expect(wrapper.findComponent(GraphStub).exists()).toBe(false);
  });

  it("names the drawer after the focused entity", () => {
    wrapper = mountDrawer();
    expect(wrapper.find(".odrawer-stub").attributes("data-title")).toContain("tpl-x");
  });

  it("forwards the graph's 'deleted' event to the parent", async () => {
    wrapper = mountDrawer();
    await wrapper.findComponent(GraphStub).vm.$emit("deleted");
    expect(wrapper.emitted("deleted")).toBeTruthy();
  });

  it("closes (update:open=false) when the graph emits 'close'", async () => {
    wrapper = mountDrawer();
    await wrapper.findComponent(GraphStub).vm.$emit("close");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });
});
