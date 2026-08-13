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
import AlertDependencies from "./AlertDependencies.vue";
import i18n from "@/locales";

// The page is a thin shell: an OPageLayout wrapper around the reusable graph
// (with no focus — the full org view).
const OPageLayoutStub = {
  name: "OPageLayout",
  props: ["title", "icon", "subtitle"],
  template: `<div class="page-layout" :data-title="title" :data-icon="icon"><slot /></div>`,
};
const GraphStub = {
  name: "AlertDependenciesGraph",
  props: ["embedded", "focus"],
  template: `<div class="graph-stub" />`,
};

describe("AlertDependencies (page)", () => {
  let wrapper: VueWrapper;
  afterEach(() => wrapper?.unmount());

  const mountPage = () =>
    mount(AlertDependencies, {
      global: {
        plugins: [i18n],
        stubs: { OPageLayout: OPageLayoutStub, AlertDependenciesGraph: GraphStub },
      },
    });

  it("renders the reusable graph in full-page (unfocused) mode", () => {
    wrapper = mountPage();
    const graph = wrapper.findComponent(GraphStub);
    expect(graph.exists()).toBe(true);
    // No embedded/focus props -> full org graph with its own toolbar.
    expect(graph.props("embedded")).toBeFalsy();
    expect(graph.props("focus")).toBeFalsy();
  });

  it("uses the account-tree page icon", () => {
    wrapper = mountPage();
    expect(wrapper.find(".page-layout").attributes("data-icon")).toBe("account-tree");
  });
});
