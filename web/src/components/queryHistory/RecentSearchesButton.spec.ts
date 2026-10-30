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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/query_history", () => ({
  default: { list: vi.fn().mockResolvedValue({ data: [] }) },
}));

import RecentSearchesButton from "./RecentSearchesButton.vue";

describe("RecentSearchesButton", () => {
  it("puts a caller's class on the clock button, since the popover renders no element", () => {
    const wrapper = mount(RecentSearchesButton, {
      props: { source: "logs", dataTest: "clock" },
      attrs: { class: "me-1" },
      global: { plugins: [store], stubs: { RecentSearchesPopover: true, OTooltip: true } },
    });
    const button = wrapper.find('[data-test="clock"]');
    expect(button.exists()).toBe(true);
    expect(button.classes()).toContain("me-1");
  });
});
