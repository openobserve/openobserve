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
import { describe, expect, it } from "vitest";

import { raw } from "@/types/i18n";

import AssistantDictationMeter from "./AssistantDictationMeter.vue";

function render(level: number, elapsedMs: number) {
  return mount(AssistantDictationMeter, { props: { label: raw("Listening"), level, elapsedMs } });
}

describe("AssistantDictationMeter", () => {
  it("shows the label and the elapsed time as m:ss", () => {
    const wrapper = render(0, 65_400);
    expect(wrapper.text()).toContain("Listening");
    expect(wrapper.get('[data-test="assistant-dictate-elapsed"]').text()).toBe("1:05");
  });

  it("hides the bars and the timer from assistive technology", () => {
    const wrapper = render(0, 0);
    const hidden = ["assistant-dictate-level", "assistant-dictate-elapsed"];
    for (const id of hidden)
      expect(wrapper.get(`[data-test="${id}"]`).attributes("aria-hidden")).toBe("true");
  });

  it("scales the bars with the level, with a visible floor", () => {
    const bars = (level: number) =>
      render(level, 0)
        .findAll("[style]")
        .map((bar) => bar.attributes("style"));
    expect(bars(0)[0]).toContain("scaleY(0.2)");
    expect(bars(1)[1]).toContain("scaleY(1)");
  });

  it("offers a static dot in place of the bars under reduced motion", () => {
    const wrapper = render(0.5, 0);
    expect(wrapper.find(".motion-safe\\:hidden").exists()).toBe(true);
    expect(wrapper.findAll(".motion-reduce\\:hidden")).toHaveLength(4);
  });
});
