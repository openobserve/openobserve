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
import ViewDependenciesDialog from "./ViewDependenciesDialog.vue";
import i18n from "@/locales";

const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "size"],
  emits: ["update:open"],
  template: `<div class="odialog-stub" :data-open="open" :data-title="title"><slot /></div>`,
};
const GraphStub = {
  name: "AlertDependenciesGraph",
  // Boolean-typed so the bare `embedded` attribute coerces to true.
  props: { embedded: { type: Boolean, default: false }, focus: { type: Object, default: null } },
  emits: ["deleted", "close"],
  template: `<div class="graph-stub" :data-focus="focus ? focus.name : ''" />`,
};

function mountDialog(props: Record<string, unknown> = {}): VueWrapper {
  return mount(ViewDependenciesDialog, {
    props: { open: true, focus: { kind: "template", name: "tpl-x" }, ...props },
    global: {
      plugins: [i18n],
      stubs: { ODialog: ODialogStub, AlertDependenciesGraph: GraphStub },
    },
  });
}

describe("ViewDependenciesDialog", () => {
  let wrapper: VueWrapper;
  afterEach(() => wrapper?.unmount());

  it("renders the focused graph (embedded) only while open", () => {
    wrapper = mountDialog({ open: true });
    const graph = wrapper.findComponent(GraphStub);
    expect(graph.exists()).toBe(true);
    expect(graph.props("embedded")).toBe(true);
    expect(graph.props("focus")).toMatchObject({ kind: "template", name: "tpl-x" });
  });

  it("does not render the graph when closed", () => {
    wrapper = mountDialog({ open: false });
    expect(wrapper.findComponent(GraphStub).exists()).toBe(false);
  });

  it("names the dialog after the focused entity", () => {
    wrapper = mountDialog();
    expect(wrapper.find(".odialog-stub").attributes("data-title")).toContain("tpl-x");
  });

  it("forwards the graph's 'deleted' event to the parent", async () => {
    wrapper = mountDialog();
    await wrapper.findComponent(GraphStub).vm.$emit("deleted");
    expect(wrapper.emitted("deleted")).toBeTruthy();
  });

  it("closes (update:open=false) when the graph emits 'close'", async () => {
    wrapper = mountDialog();
    await wrapper.findComponent(GraphStub).vm.$emit("close");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });
});
