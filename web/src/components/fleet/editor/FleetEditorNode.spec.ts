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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import FleetEditorNode, { type EditorNodeData } from "./FleetEditorNode.vue";

const data = (over: Partial<EditorNodeData> = {}): EditorNodeData => ({
  kind: "receiver",
  name: raw("OTLP"),
  componentId: raw("otlp"),
  icon: "input",
  sharedCount: 1,
  selected: false,
  fromBase: false,
  ...over,
});

const mountNode = (d: EditorNodeData) =>
  mount(FleetEditorNode, {
    props: { id: "n1", data: d },
    global: { plugins: [i18n], stubs: { Handle: true } },
  });

describe("FleetEditorNode", () => {
  it("marks a component that comes from the collector's base config", () => {
    const wrapper = mountNode(data({ fromBase: true }));
    expect(wrapper.find('[data-test="fleet-editor-node-n1-from-base"]').text()).toBe(
      i18n.global.t("fleet.editor.fromBase"),
    );
  });

  it("shows the shared pipelines count next to the base marker", () => {
    const wrapper = mountNode(data({ fromBase: true, sharedCount: 3 }));
    expect(wrapper.find('[data-test="fleet-editor-node-n1-from-base"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-editor-node-n1-shared"]').text()).toBe(
      i18n.global.t("fleet.editor.sharedPipelines", { count: 3 }),
    );
  });

  it("does not mark a component defined in this config", () => {
    const wrapper = mountNode(data());
    expect(wrapper.find('[data-test="fleet-editor-node-n1-from-base"]').exists()).toBe(false);
  });
});
