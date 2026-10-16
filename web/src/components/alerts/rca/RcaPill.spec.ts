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
import RcaPill from "./RcaPill.vue";
import { RCA_PILL_TONE_CLASS, type RcaPillTone } from "@/utils/incidents/rcaSummary";

describe("RcaPill", () => {
  it.each(Object.keys(RCA_PILL_TONE_CLASS) as RcaPillTone[])(
    "tone %s carries its classes and the slot text",
    (tone) => {
      const wrapper = mount(RcaPill, { props: { tone }, slots: { default: "Root cause" } });

      expect(wrapper.text()).toBe("Root cause");
      for (const cls of RCA_PILL_TONE_CLASS[tone].split(" ")) {
        expect(wrapper.classes()).toContain(cls);
      }
    },
  );

  it("open statuses are dashed; settled ones are not", () => {
    expect(RCA_PILL_TONE_CLASS.dash).toContain("border-dashed");
    expect(RCA_PILL_TONE_CLASS["warn-dash"]).toContain("border-dashed");
    expect(RCA_PILL_TONE_CLASS.strong).not.toContain("border-dashed");
  });

  it("wrap lets a long label break inside its column; the default stays on one line", () => {
    const wrapped = mount(RcaPill, { props: { tone: "strong", wrap: true } });
    const single = mount(RcaPill, { props: { tone: "strong" } });

    expect(wrapped.classes()).not.toContain("whitespace-nowrap");
    expect(wrapped.classes()).toContain("max-w-full");
    expect(single.classes()).toContain("whitespace-nowrap");
    expect(single.classes()).toContain("shrink-0");
  });

  it("a spinner replaces the icon", () => {
    const withSpinner = mount(RcaPill, {
      props: { tone: "neutral", icon: "verified", spinner: true },
    });
    const withIcon = mount(RcaPill, { props: { tone: "ok", icon: "verified" } });

    expect(withSpinner.findComponent({ name: "OSpinner" }).exists()).toBe(true);
    expect(withSpinner.findComponent({ name: "OIcon" }).exists()).toBe(false);
    expect(withIcon.findComponent({ name: "OIcon" }).exists()).toBe(true);
  });
});
