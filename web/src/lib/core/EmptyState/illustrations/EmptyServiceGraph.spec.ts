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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import EmptyServiceGraph from "./EmptyServiceGraph.vue";

describe("EmptyServiceGraph", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("should mount without errors", () => {
    wrapper = mount(EmptyServiceGraph);
    expect(wrapper.exists()).toBe(true);
  });

  it("should render an svg element", () => {
    wrapper = mount(EmptyServiceGraph);
    expect(wrapper.find("svg").exists()).toBe(true);
  });

  // Motion is native SVG (SMIL) <animateTransform>/<animate>, gated on `animated`
  // so callers can honour prefers-reduced-motion (OEmptyState wires this up).
  it("should render SMIL animation elements when animated (the default)", () => {
    wrapper = mount(EmptyServiceGraph);
    expect(wrapper.html().toLowerCase()).toContain("animatetransform");
  });

  it("should omit all SMIL animation elements when animated is false", () => {
    wrapper = mount(EmptyServiceGraph, {
      props: { animated: false },
    });
    const html = wrapper.html().toLowerCase();
    expect(html).not.toContain("animatetransform");
    expect(html).not.toContain("<animate");
  });

  it("should accept a width prop and apply it to the svg element", () => {
    wrapper = mount(EmptyServiceGraph, {
      props: { width: 320 },
    });
    const svg = wrapper.find("svg");
    expect(svg.attributes("width")).toBe("320");
  });
});
