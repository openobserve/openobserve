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
import { raw } from "@/types/i18n";
import StaleRangeStrip from "./StaleRangeStrip.vue";

const mountStrip = () =>
  mount(StaleRangeStrip, {
    props: { text: raw("Results are for Last 15 minutes."), dataTest: "strip", shortcutId: "x" },
    global: {
      plugins: [i18n],
      stubs: { OShortcut: { template: "<kbd data-test='strip-shortcut' />" } },
    },
  });

describe("StaleRangeStrip", () => {
  it("is one full-width band holding the text, the run action and its shortcut", () => {
    const wrapper = mountStrip();
    const band = wrapper.get('[data-test="strip"]');
    expect(band.attributes("role")).toBe("status");
    expect(band.classes()).toContain("w-full");
    expect(band.text()).toContain("Results are for Last 15 minutes.");
    expect(band.find('[data-test="strip-run"]').exists()).toBe(true);
    expect(band.find('[data-test="strip-shortcut"]').exists()).toBe(true);
  });

  it("emits run from its action", async () => {
    const wrapper = mountStrip();
    await wrapper.get('[data-test="strip-run"]').trigger("click");
    expect(wrapper.emitted("run")).toHaveLength(1);
  });
});
