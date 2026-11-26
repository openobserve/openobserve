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

import { afterEach, describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";

import { focusTargetOf, useRoleFocusLink } from "./useRoleFocusLink";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useRoleFocusLink", () => {
  it("accepts only the assistant module keys it offers", () => {
    expect(focusTargetOf({ query: { module: "assistant", focus: "ai" } })).toBe("ai");
    expect(focusTargetOf({ query: { module: "assistant", focus: "__proto__" } })).toBeNull();
    expect(focusTargetOf({ query: { module: "other", focus: "ai" } })).toBeNull();
    expect(focusTargetOf({ query: {} })).toBeNull();
  });

  it("opens the module once the role loads and focuses its PUT checkbox", async () => {
    const ready = ref(false);
    const keys = ref<string[]>([]);
    const opened: string[] = [];
    const frames: (() => void)[] = [];
    useRoleFocusLink({
      target: "ai",
      ready,
      moduleKeys: keys,
      open: (key) => opened.push(key),
      frame: (cb) => frames.push(cb),
    });
    keys.value = ["ai", "alert"];
    await nextTick();
    expect(opened).toEqual([]);
    ready.value = true;
    await nextTick();
    await nextTick();
    expect(opened).toEqual(["ai"]);
    document.body.innerHTML =
      '<div data-test="edit-role-module-pane"><label data-test="edit-role-module-pane-scope-all-AllowPut"><button role="checkbox" id="scope"></button></label><label data-test="edit-role-permissions-table-body-row-ai-col-AllowPut-checkbox"><button role="checkbox" id="row"></button></label></div>';
    frames.shift()?.();
    expect(document.activeElement?.id).toBe("row");
    ready.value = false;
    await nextTick();
    ready.value = true;
    await nextTick();
    expect(opened).toEqual(["ai"]);
  });
});
