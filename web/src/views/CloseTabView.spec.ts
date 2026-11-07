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

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import CloseTabView from "./CloseTabView.vue";

describe("CloseTabView", () => {
  it("says the sign-in worked and asks the browser to close the tab (`80` §2.3)", () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const wrapper = mount(CloseTabView);
    expect(wrapper.text()).toContain("You're signed in");
    expect(wrapper.text()).toContain("You can close this tab.");
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
  });
});
