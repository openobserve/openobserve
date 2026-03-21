// Copyright 2023 OpenObserve Inc.
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
import { describe, it, expect, vi, beforeEach } from "vitest";
import GroupHeader from "@/components/common/GroupHeader.vue";

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `/mocked-assets/${path}`),
}));

const stubs = {
  "q-separator": { template: "<hr class='q-separator-stub' />" },
};

describe("GroupHeader.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createWrapper = (props: Record<string, any> = {}) =>
    mount(GroupHeader, {
      props: { title: "Default Title", iconPath: "icon.svg", showIcon: true, ...props },
      global: { stubs },
    });

  // ─── Mounting ─────────────────────────────────────────────────────────────────

  describe("Mounting", () => {
    it("mounts without errors", () => {
      expect(createWrapper().exists()).toBe(true);
    });

    it("has correct component name", () => {
      expect(createWrapper().vm.$options.name).toBe("GroupHeader");
    });
  });

  // ─── Props ────────────────────────────────────────────────────────────────────

  describe("Props", () => {
    it("accepts and renders title prop", () => {
      const wrapper = createWrapper({ title: "My Section" });
      expect(wrapper.find(".title-text").text()).toBe("My Section");
    });

    it("defaults title to empty string", () => {
      const wrapper = mount(GroupHeader, { global: { stubs } });
      expect(wrapper.vm.title).toBe("");
    });

    it("defaults showIcon to true", () => {
      const wrapper = mount(GroupHeader, {
        props: { title: "Test", iconPath: "icon.svg" },
        global: { stubs },
      });
      expect(wrapper.props("showIcon")).toBe(true);
    });

    it("defaults iconPath to empty string", () => {
      const wrapper = mount(GroupHeader, {
        props: { title: "Test" },
        global: { stubs },
      });
      expect(wrapper.props("iconPath")).toBe("");
    });
  });

  // ─── Title rendering ──────────────────────────────────────────────────────────

  describe("Title rendering", () => {
    it("renders the provided title text", () => {
      const wrapper = createWrapper({ title: "Cipher Keys" });
      expect(wrapper.find(".title-text").text()).toContain("Cipher Keys");
    });

    it("renders empty title text when title is empty string", () => {
      const wrapper = createWrapper({ title: "" });
      expect(wrapper.find(".title-text").text()).toBe("");
    });

    it("renders long titles correctly", () => {
      const longTitle = "A".repeat(100);
      const wrapper = createWrapper({ title: longTitle });
      expect(wrapper.find(".title-text").text()).toBe(longTitle);
    });

    it("renders titles with special characters", () => {
      const special = "Config & Settings <API>";
      const wrapper = createWrapper({ title: special });
      expect(wrapper.find(".title-text").text()).toBe(special);
    });
  });

  // ─── Icon rendering ───────────────────────────────────────────────────────────

  describe("Icon rendering", () => {
    it("shows image when showIcon is true", () => {
      const wrapper = createWrapper({ showIcon: true, iconPath: "icon.svg" });
      expect(wrapper.find("img").exists()).toBe(true);
    });

    it("hides image when showIcon is false", () => {
      const wrapper = createWrapper({ showIcon: false });
      expect(wrapper.find("img").exists()).toBe(false);
    });

    it("uses correct src from getImageURL", () => {
      const wrapper = createWrapper({ showIcon: true, iconPath: "custom/path.png" });
      expect(wrapper.find("img").attributes("src")).toBe("/mocked-assets/custom/path.png");
    });

    it("sets width and height style on image", () => {
      const wrapper = createWrapper({ showIcon: true });
      const style = wrapper.find("img").attributes("style") ?? "";
      expect(style).toContain("width: 24px");
      expect(style).toContain("height: 24px");
    });

    it("calls getImageURL with the provided iconPath", async () => {
      const { getImageURL } = await import("@/utils/zincutils");
      createWrapper({ iconPath: "test/icon.svg", showIcon: true });
      expect(getImageURL).toHaveBeenCalledWith("test/icon.svg");
    });
  });

  // ─── Computed `icon` ──────────────────────────────────────────────────────────

  describe("Computed icon property", () => {
    it("returns the mocked URL from getImageURL", () => {
      const wrapper = createWrapper({ iconPath: "my-icon.svg" });
      expect((wrapper.vm as any).icon).toBe("/mocked-assets/my-icon.svg");
    });

    it("returns mocked URL even when iconPath is empty", () => {
      const wrapper = createWrapper({ iconPath: "" });
      expect((wrapper.vm as any).icon).toBe("/mocked-assets/");
    });
  });

  // ─── Separator ────────────────────────────────────────────────────────────────

  describe("Separator", () => {
    it("renders a q-separator", () => {
      const wrapper = createWrapper();
      expect(wrapper.find(".q-separator-stub").exists()).toBe(true);
    });
  });

  // ─── Layout ───────────────────────────────────────────────────────────────────

  describe("Layout structure", () => {
    it("wraps content in a flex container", () => {
      const wrapper = createWrapper();
      const root = wrapper.find("div");
      expect(root.classes().some((c) => c.includes("flex") || c.includes("tw:"))).toBe(true);
    });

    it("icon appears before the title", () => {
      const wrapper = createWrapper({ showIcon: true, title: "Heading" });
      const html = wrapper.html();
      const imgIndex = html.indexOf("<img");
      const titleIndex = html.indexOf("Heading");
      expect(imgIndex).toBeLessThan(titleIndex);
    });
  });
});
