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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import EditorDraftDot from "./EditorDraftDot.vue";

const store = createStore({ state: { timezone: "UTC" } });

describe("EditorDraftDot", () => {
  it("names a row's draft with its time", () => {
    const wrapper = mount(EditorDraftDot, {
      props: { savedAt: Date.UTC(2026, 9, 21, 14, 32), dataTest: "row-dot" },
      global: { plugins: [store] },
    });
    const dot = wrapper.get('[data-test="row-dot"]');
    expect(dot.attributes("role")).toBe("img");
    expect(dot.attributes("aria-label")).toMatch(/^Unsaved draft · .*2026/);
    expect(dot.classes()).toContain("bg-button-pending-bg");
  });

  it("pins a silent dot to a button corner", () => {
    const wrapper = mount(EditorDraftDot, {
      props: { corner: true },
      global: { plugins: [store] },
    });
    const dot = wrapper.get('[data-test="editor-draft-dot"]');
    expect(dot.attributes("aria-hidden")).toBe("true");
    expect(dot.attributes("role")).toBeUndefined();
    expect(dot.classes()).toEqual(expect.arrayContaining(["absolute", "-end-1", "-top-1"]));
  });
});
