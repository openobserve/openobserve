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
import DependencyChainDialog from "./DependencyChainDialog.vue";
import i18n from "@/locales";

const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "size"],
  emits: ["update:open"],
  template: `<div class="odialog-stub" :data-open="open" :data-title="title"><slot /></div>`,
};
const GraphStub = {
  name: "DependencyChainGraph",
  props: { focus: { type: Object, default: null } },
  emits: ["deleted", "close"],
  template: `<div class="graph-stub" :data-focus="focus ? focus.name : ''" />`,
};

function mountDialog(props: Record<string, unknown> = {}): VueWrapper {
  return mount(DependencyChainDialog, {
    props: { open: true, focus: { kind: "alert", alertId: "a1", name: "cpu" }, ...props },
    global: {
      plugins: [i18n],
      stubs: { ODialog: ODialogStub, DependencyChainGraph: GraphStub },
    },
  });
}

describe("DependencyChainDialog", () => {
  let wrapper: VueWrapper;
  afterEach(() => wrapper?.unmount());

  it("renders the focused graph while open and names the dialog after the row", () => {
    wrapper = mountDialog({ open: true });
    const graph = wrapper.findComponent(GraphStub);
    expect(graph.exists()).toBe(true);
    expect(graph.props("focus")).toMatchObject({ kind: "alert", name: "cpu" });
    expect(wrapper.find(".odialog-stub").attributes("data-title")).toContain("cpu");
  });

  it("does not render the graph when closed", () => {
    wrapper = mountDialog({ open: false });
    expect(wrapper.findComponent(GraphStub).exists()).toBe(false);
  });

  it("forwards 'deleted' and closes on the graph's 'close'", async () => {
    wrapper = mountDialog();
    const graph = wrapper.findComponent(GraphStub);
    await graph.vm.$emit("deleted");
    expect(wrapper.emitted("deleted")).toBeTruthy();
    await graph.vm.$emit("close");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });
});
