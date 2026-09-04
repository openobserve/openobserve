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

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import DeployedCode from "./DeployedCode.vue";

describe("DeployedCode", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mount(DeployedCode);
    });

    it("should render an SVG element", () => {
      expect(wrapper.find("svg").exists()).toBe(true);
    });

    it("should apply the default width of 18px to the SVG", () => {
      expect(wrapper.find("svg").attributes("width")).toBe("18px");
    });

    it("should apply the default height of auto to the SVG", () => {
      expect(wrapper.find("svg").attributes("height")).toBe("auto");
    });

    it("should set fill to currentColor", () => {
      expect(wrapper.find("svg").attributes("fill")).toBe("currentColor");
    });
  });

  describe("custom props", () => {
    it("should bind a custom width prop as [value]px on the SVG width attribute", () => {
      wrapper = mount(DeployedCode, { props: { width: 32 } });
      expect(wrapper.find("svg").attributes("width")).toBe("32px");
    });

    it("should bind a custom numeric height prop to the SVG height attribute", () => {
      wrapper = mount(DeployedCode, { props: { height: 48 } });
      expect(wrapper.find("svg").attributes("height")).toBe("48");
    });

    it("should bind a custom string height prop to the SVG height attribute", () => {
      wrapper = mount(DeployedCode, { props: { height: "2rem" } });
      expect(wrapper.find("svg").attributes("height")).toBe("2rem");
    });

    it("should bind both custom width and height props together", () => {
      wrapper = mount(DeployedCode, { props: { width: 24, height: 24 } });
      const svg = wrapper.find("svg");
      expect(svg.attributes("width")).toBe("24px");
      expect(svg.attributes("height")).toBe("24");
    });
  });
});
