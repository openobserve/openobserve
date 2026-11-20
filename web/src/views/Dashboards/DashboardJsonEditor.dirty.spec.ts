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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { byTest, click, pressEscape } from "@/test/unit/helpers/draftDom";
import DashboardJsonEditor from "./DashboardJsonEditor.vue";

vi.mock("@/utils/dashboard/panelValidation", () => ({
  validateDashboardJson: vi.fn(() => []),
}));

// Monaco does not run in jsdom; a textarea carries the same v-model:query contract.
const QueryEditorStub = {
  name: "QueryEditor",
  props: ["query", "debounceTime", "language", "editorId"],
  emits: ["update:query"],
  template: `<textarea :value="query" @input="$emit('update:query', $event.target.value)" />`,
};

const dashboardData = { dashboardId: "d1", title: "Ops overview", tabs: [] };
const savedText = JSON.stringify(dashboardData, null, 2);

let wrapper: VueWrapper | null = null;

const mountEditor = async () => {
  wrapper = mount(DashboardJsonEditor, {
    attachTo: document.body,
    props: {
      open: true,
      dashboardData,
      saveJsonDashboard: { isLoading: ref(false), execute: vi.fn() },
    },
    global: { plugins: [i18n, store], stubs: { QueryEditor: QueryEditorStub } },
  });
  await flushPromises();
};

const editor = () => byTest("dashboard-json-editor") as HTMLTextAreaElement;

const typeJson = async (text: string) => {
  editor().value = text;
  editor().dispatchEvent(new Event("input"));
  await flushPromises();
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("DashboardJsonEditor dismiss guard", () => {
  it("asks in the footer before Escape drops an edit to the JSON", async () => {
    await mountEditor();
    await typeJson('{ "dashboardId": "d1", "title": "Edited" }');

    pressEscape();
    await flushPromises();

    expect(byTest("o-drawer-discard-row")).not.toBeNull();
    expect(wrapper!.emitted("update:open")).toBeFalsy();
  });

  it("closes on Escape when the JSON is unchanged", async () => {
    await mountEditor();

    pressEscape();
    await flushPromises();

    expect(byTest("o-drawer-discard-row")).toBeNull();
    expect(wrapper!.emitted("update:open")).toEqual([[false]]);
  });

  it("reopens on the saved dashboard after Discard", async () => {
    await mountEditor();
    await typeJson('{ "dashboardId": "d1", "title": "Edited" }');
    pressEscape();
    await flushPromises();
    click("o-drawer-discard-btn");
    await flushPromises();
    expect(wrapper!.emitted("update:open")).toEqual([[false]]);

    await wrapper!.setProps({ open: false });
    await wrapper!.setProps({ open: true });
    await flushPromises();

    expect(editor().value).toBe(savedText);
    pressEscape();
    await flushPromises();
    expect(byTest("o-drawer-discard-row")).toBeNull();
  });
});
