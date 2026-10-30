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

import { describe, it, expect, vi } from "vitest";
import { resolveEditorSuggestMode, useEditorSuggestMode } from "./useEditorSuggestMode";

const state: any = { zoConfig: {} };
vi.mock("vuex", () => ({ useStore: () => ({ state }) }));

describe("resolveEditorSuggestMode", () => {
  it("passes the three modes through", () => {
    expect(resolveEditorSuggestMode("automatic")).toBe("automatic");
    expect(resolveEditorSuggestMode("typing")).toBe("typing");
    expect(resolveEditorSuggestMode("off")).toBe("off");
  });

  it("tolerates case and whitespace", () => {
    expect(resolveEditorSuggestMode(" Typing ")).toBe("typing");
    expect(resolveEditorSuggestMode("OFF")).toBe("off");
  });

  it("falls back to automatic for anything else", () => {
    for (const raw of [undefined, null, "", "auto", "on", 1, {}]) {
      expect(resolveEditorSuggestMode(raw)).toBe("automatic");
    }
  });
});

describe("useEditorSuggestMode", () => {
  it("reads zoConfig.editor_suggest_mode and follows it", () => {
    state.zoConfig = { editor_suggest_mode: "typing" };
    const { mode } = useEditorSuggestMode();
    expect(mode.value).toBe("typing");
    state.zoConfig = {};
    expect(useEditorSuggestMode().mode.value).toBe("automatic");
  });
});
