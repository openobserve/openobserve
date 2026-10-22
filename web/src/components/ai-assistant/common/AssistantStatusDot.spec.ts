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

  it("keeps dots solid and the working ring hollow in forced colours", () => {
    for (const state of ["unread", "attention"] as const) {
      const dot = mountDot(state).find(".rounded-full");
      expect(dot.classes()).toContain("size-2");
      expect(dot.classes()).toContain("forced-colors:border-4");
    }
    const ring = mountDot("working").find(".rounded-full").classes();
    expect(ring).toContain("forced-colors:border");
    expect(ring).not.toContain("forced-colors:border-4");
  });

  it("hides every shape from assistive tech; the parent's name carries the state", () => {
    for (const state of SIGNALS) {
      const root = mountDot(state).get('[data-test="assistant-status-dot"]');
      expect(root.attributes("aria-hidden")).toBeUndefined();
      expect(root.element.children).toHaveLength(1);
      expect(root.element.children[0].getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("keeps the count outside every aria-hidden subtree so it is read below md", () => {
    const count = mountDot("attention", { count: 3 }).get(".tabular-nums");
    expect(count.element.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("sits in the corner of a positioned parent on request", () => {
    const corner = mountDot("unread", { placement: "corner" }).get(
      '[data-test="assistant-status-dot"]',
    );
    expect(corner.classes()).toContain("absolute");
    expect(corner.find(".ring-surface-base").exists()).toBe(true);
  });
});
