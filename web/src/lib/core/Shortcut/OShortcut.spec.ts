import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OShortcut from "./OShortcut.vue";

// Force a Mac platform so modifier symbols are deterministic in assertions.
vi.stubGlobal("navigator", { platform: "MacIntel" });

describe("OShortcut", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("combo rendering (string)", () => {
    it("should render a combo string as a single symbolised keycap", () => {
      wrapper = mount(OShortcut, { props: { keys: "ctrl+shift+a" } });
      const caps = wrapper.findAll("kbd");
      expect(caps).toHaveLength(1);
      expect(caps[0].text()).toBe("⌘⇧A");
    });

    it("should symbolise enter and ctrl in a two-key combo", () => {
      wrapper = mount(OShortcut, { props: { keys: "ctrl+enter" } });
      const caps = wrapper.findAll("kbd");
      expect(caps).toHaveLength(1);
      expect(caps[0].text()).toBe("⌘↵");
    });

    it("should render a bare single key unchanged", () => {
      wrapper = mount(OShortcut, { props: { keys: "?" } });
      expect(wrapper.find("kbd").text()).toBe("?");
    });
  });

  describe("array rendering", () => {
    it("should render one keycap per array element, symbolised", () => {
      wrapper = mount(OShortcut, { props: { keys: ["ctrl", "k"] } });
      expect(wrapper.findAll("kbd").map((c) => c.text())).toEqual(["⌘", "K"]);
    });

    it("should pass pre-symbolised array values through unchanged", () => {
      wrapper = mount(OShortcut, { props: { keys: ["⌘", "K"] } });
      expect(wrapper.findAll("kbd").map((c) => c.text())).toEqual(["⌘", "K"]);
    });
  });

  describe("size", () => {
    it("should apply small keycap sizing by default", () => {
      wrapper = mount(OShortcut, { props: { keys: "?" } });
      expect(wrapper.find("kbd").classes()).toContain("tw:h-5");
    });

    it("should apply medium keycap sizing when size='md'", () => {
      wrapper = mount(OShortcut, { props: { keys: "?", size: "md" } });
      const cls = wrapper.find("kbd").classes();
      expect(cls).toContain("tw:h-6");
      expect(cls).not.toContain("tw:h-5");
    });
  });

  it("should use the theme-aware keycap tokens (auto light/dark)", () => {
    wrapper = mount(OShortcut, { props: { keys: "?" } });
    const cls = wrapper.find("kbd").classes();
    expect(cls).toContain("tw:bg-kbd-bg");
    expect(cls).toContain("tw:border-kbd-border");
    expect(cls).toContain("tw:text-kbd-text");
  });
});
