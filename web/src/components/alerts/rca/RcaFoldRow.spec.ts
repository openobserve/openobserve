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
import i18n from "@/locales";
import RcaFoldRow from "./RcaFoldRow.vue";

const mountRow = (open: boolean) =>
  mount(RcaFoldRow, {
    props: { open },
    slots: {
      lead: "<span data-test='lead'>Root cause</span>",
      default: "A long statement",
      meta: "<span data-test='meta'>3 evidence</span>",
      actions: "<button data-test='cta'>Connect</button>",
      body: "<p data-test='body'>The reason</p>",
    },
    global: { plugins: [i18n] },
  });

describe("RcaFoldRow", () => {
  it("shows one title line with its lead and meta, the body folded", () => {
    const wrapper = mountRow(false);
    const toggle = wrapper.get("button[aria-expanded]");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.text()).toMatch(/Root cause.*A long statement.*3 evidence/);
    // The call to action sits beside the toggle, never inside the button.
    expect(toggle.find('[data-test="cta"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="cta"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="body"]').exists()).toBe(false);
  });

  it("asks to open from the title row and shows the body when open", async () => {
    const wrapper = mountRow(false);
    await wrapper.get("button[aria-expanded]").trigger("click");
    expect(wrapper.emitted("update:open")).toEqual([[true]]);

    const open = mountRow(true);
    const toggle = open.get("button[aria-expanded]");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(open.find('[data-test="body"]').exists()).toBe(true);
  });
});
