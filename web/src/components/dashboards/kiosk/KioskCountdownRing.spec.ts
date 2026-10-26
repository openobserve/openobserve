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
import { raw } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import KioskCountdownRing from "./KioskCountdownRing.vue";

const CIRCUMFERENCE = 2 * Math.PI * 11;

const mountRing = (props: Record<string, unknown>) =>
  mount(KioskCountdownRing, {
    props: { tooltip: raw("Next refresh at 23:16:30"), ...props },
    slots: { default: "<i data-test='inner' />" },
  });

const progressArc = (wrapper: ReturnType<typeof mountRing>) => wrapper.findAll("circle")[1];

describe("KioskCountdownRing", () => {
  it("fills the arc by the elapsed share of the wait", () => {
    const wrapper = mountRing({ progress: 0.25 });
    const offset = Number(progressArc(wrapper).attributes("stroke-dashoffset"));
    expect(offset).toBeCloseTo(CIRCUMFERENCE * 0.75);
    expect(wrapper.attributes("data-progress")).toBe("25");
    expect(wrapper.find('[data-test="inner"]').exists()).toBe(true);
  });

  it("clamps progress outside 0 to 1", () => {
    expect(mountRing({ progress: 3 }).attributes("data-progress")).toBe("100");
    expect(mountRing({ progress: -1 }).attributes("data-progress")).toBe("0");
  });

  it("spins a short arc while loading", () => {
    const wrapper = mountRing({ state: "spinning", progress: 0.5 });
    expect(wrapper.find("svg").classes()).toContain("motion-safe:animate-spin");
    expect(progressArc(wrapper).attributes("stroke-dasharray")).toBe("22 70");
  });

  it("draws only a dashed track when off", () => {
    const wrapper = mountRing({ state: "off" });
    const circles = wrapper.findAll("circle");
    expect(circles).toHaveLength(1);
    expect(circles[0].attributes("stroke-dasharray")).toBe("3 4");
  });

  it("shows a full muted ring when paused", () => {
    const wrapper = mountRing({ state: "paused", progress: 0.3 });
    expect(progressArc(wrapper).attributes("stroke-dashoffset")).toBe("0");
    expect(progressArc(wrapper).classes()).toContain("stroke-text-secondary");
  });

  it("is focusable and names itself with its tooltip", () => {
    const wrapper = mountRing({});
    expect(wrapper.attributes("tabindex")).toBe("0");
    expect(wrapper.attributes("aria-label")).toBe("Next refresh at 23:16:30");
    expect(wrapper.findComponent(OTooltip).props("content")).toBe("Next refresh at 23:16:30");
  });
});
