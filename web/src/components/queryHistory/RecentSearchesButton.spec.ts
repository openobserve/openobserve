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
import { mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";

import RecentSearchesButton from "./RecentSearchesButton.vue";

const mountButton = (attrs: Record<string, unknown> = {}) =>
  mount(RecentSearchesButton, {
    props: { dataTest: "clock" },
    attrs,
    global: { plugins: [store], stubs: { OTooltip: true } },
  });

describe("RecentSearchesButton", () => {
  afterEach(() => {
    store.state.zoConfig.query_history_enabled = true;
  });

  it("puts a caller's class on the button", () => {
    const button = mountButton({ class: "me-1" }).find('[data-test="clock"]');
    expect(button.exists()).toBe(true);
    expect(button.classes()).toContain("me-1");
  });

  it("asks for the full Recent searches drawer on click", async () => {
    const wrapper = mountButton();
    await wrapper.find('[data-test="clock"]').trigger("click");
    expect(wrapper.emitted("view-all")).toEqual([[null]]);
  });

  it("is hidden unless history is enabled", () => {
    store.state.zoConfig.query_history_enabled = false;
    expect(mountButton().find('[data-test="clock"]').exists()).toBe(false);
    delete store.state.zoConfig.query_history_enabled;
    expect(mountButton().find('[data-test="clock"]').exists()).toBe(false);
  });
});
