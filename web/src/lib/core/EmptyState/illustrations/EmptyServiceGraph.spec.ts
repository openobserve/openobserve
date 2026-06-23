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

  it("should default animated prop to true when not provided", () => {
    wrapper = mount(EmptyServiceGraph);
    // When animated=true, es-static class should NOT be on the svg
    const svg = wrapper.find("svg");
    expect(svg.classes()).not.toContain("es-static");
  });

  it("should add es-static class to the svg element when animated is false", () => {
    wrapper = mount(EmptyServiceGraph, {
      props: { animated: false },
    });
    const svg = wrapper.find("svg");
    expect(svg.classes()).toContain("es-static");
  });

  it("should not have es-static class when animated is true", () => {
    wrapper = mount(EmptyServiceGraph, {
      props: { animated: true },
    });
    const svg = wrapper.find("svg");
    expect(svg.classes()).not.toContain("es-static");
  });

  it("should accept a width prop and apply it to the svg element", () => {
    wrapper = mount(EmptyServiceGraph, {
      props: { width: 320 },
    });
    const svg = wrapper.find("svg");
    expect(svg.attributes("width")).toBe("320");
  });

  it("should always have the es-root class on the svg element", () => {
    wrapper = mount(EmptyServiceGraph);
    const svg = wrapper.find("svg");
    expect(svg.classes()).toContain("es-root");
  });
});
