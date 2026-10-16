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

import AssistantStatusDot from "./AssistantStatusDot.vue";
import { assistantSignalShape, type AssistantSignal } from "./AssistantStatusDot.types";

const SIGNALS: AssistantSignal[] = ["working", "attention", "failed", "unread"];

const mountDot = (state: AssistantSignal, extra: Record<string, unknown> = {}) =>
  mount(AssistantStatusDot, { props: { state, ...extra } });

describe("AssistantStatusDot", () => {
  it("gives every signal its own shape, so none differ by colour alone", () => {
    const shapes = SIGNALS.map((state) =>
      mountDot(state).get('[data-test="assistant-status-dot"]').attributes("data-shape"),
    );
    expect(shapes).toEqual(["ring", "dot-count", "glyph", "dot"]);
    expect(new Set(shapes).size).toBe(SIGNALS.length);
    expect(shapes).toEqual(SIGNALS.map((state) => assistantSignalShape[state]));
  });

  it("draws working as a hollow ring that pulses only without reduced motion", () => {
    const ring = mountDot("working").get('[data-shape="ring"] > span');
    expect(ring.classes()).toEqual(
      expect.arrayContaining([
        "rounded-full",
        "ring-2",
        "ring-assistant-signal-working",
        "bg-transparent",
        "motion-safe:animate-pulse",
        "motion-reduce:animate-none",
      ]),
    );
  });

  it("animates nothing but working", () => {
    for (const state of ["attention", "failed", "unread"] as const) {
      expect(mountDot(state).html()).not.toContain("animate-pulse");
    }
  });

  it("draws attention as a filled dot with a count that is sr-only below md", () => {
    const wrapper = mountDot("attention", { count: 2 });
    expect(wrapper.find(".bg-assistant-signal-attention").classes()).toContain("rounded-full");
    const count = wrapper.get(".tabular-nums");
    expect(count.text()).toBe("2");
    expect(count.classes()).toContain("max-md:sr-only");
    expect(mountDot("attention").text()).toBe("");
  });

  it("draws failed as the error glyph badge, not a filled dot", () => {
    const wrapper = mountDot("failed");
    const badge = wrapper.get(".text-assistant-signal-failed");
    expect(badge.classes()).toContain("size-3");
    expect(badge.find("svg, span").exists()).toBe(true);
    expect(wrapper.html()).not.toContain("rounded-full");
  });

  it("draws unread as a filled neutral dot", () => {
    expect(mountDot("unread").find(".bg-assistant-signal-unread").classes()).toContain(
      "rounded-full",
    );
  });

  it("keeps a system-colour outline in forced colours", () => {
    for (const state of SIGNALS.filter((s) => s !== "failed")) {
      expect(mountDot(state).html()).toContain("forced-colors:border");
    }
  });

  it("is hidden from assistive tech; the parent's name carries the state", () => {
    expect(
      mountDot("working").get('[data-test="assistant-status-dot"]').attributes("aria-hidden"),
    ).toBe("true");
  });

  it("sits in the corner of a positioned parent on request", () => {
    const corner = mountDot("unread", { placement: "corner" }).get(
      '[data-test="assistant-status-dot"]',
    );
    expect(corner.classes()).toContain("absolute");
    expect(corner.find(".ring-surface-base").exists()).toBe(true);
  });
});
