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
import { defineComponent, h, inject } from "vue";
import { mount } from "@vue/test-utils";
import {
  DIALOG_DEPTH_KEY,
  countOpenOverlays,
  provideDialogLayerAboveOpenOverlays,
} from "./dialogStacking";

const overlay = (state: string) => {
  const el = document.createElement("div");
  el.setAttribute("role", "dialog");
  el.setAttribute("data-state", state);
  return el;
};

describe("dialogStacking", () => {
  it("counts only open dialog and drawer panels", () => {
    const root = document.createElement("div");
    root.append(overlay("open"), overlay("open"), overlay("closed"));
    expect(countOpenOverlays(root)).toBe(2);
  });

  it("provides a dialog layer one above each open overlay", () => {
    const root = document.createElement("div");
    root.append(overlay("open"), overlay("open"));
    const Child = defineComponent({
      setup: () => () => h("span", String(inject(DIALOG_DEPTH_KEY))),
    });
    const Parent = defineComponent({
      setup() {
        provideDialogLayerAboveOpenOverlays(root);
        return () => h(Child);
      },
    });
    expect(mount(Parent).text()).toBe("2");
  });
});
