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
    it("should render every key of a combo as its own symbolised cap", () => {
      wrapper = mount(OShortcut, { props: { keys: "ctrl+shift+a" } });
      expect(wrapper.findAll("kbd").map((c) => c.text())).toEqual(["⌘", "⇧", "A"]);
    });

    it("should symbolise enter and ctrl in a two-key combo", () => {
      wrapper = mount(OShortcut, { props: { keys: "ctrl+enter" } });
      expect(wrapper.findAll("kbd").map((c) => c.text())).toEqual(["⌘", "↵"]);
    });

    it("should treat a lone plus as a key", () => {
      wrapper = mount(OShortcut, { props: { keys: "+" } });
      expect(wrapper.find("kbd").text()).toBe("+");
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

  describe("registry id resolution", () => {
    it("should resolve keys from the registry when only an id is given", () => {
      wrapper = mount(OShortcut, { props: { id: "alertsImport" } });
      expect(wrapper.findAll("kbd").map((c) => c.text())).toEqual(["I"]);
    });

    it("should render a ctrl-combo id as a ⌘ keycap on Mac", () => {
      wrapper = mount(OShortcut, { props: { id: "logsRunQuery" } });
      expect(wrapper.findAll("kbd").map((c) => c.text())).toEqual(["⌘", "↵"]);
    });

    it("should resolve a display-only id (e.g. delete)", () => {
      wrapper = mount(OShortcut, { props: { id: "alertsRowDelete" } });
      expect(wrapper.find("kbd").text()).toBe("⌫");
    });

    it("should prefer explicit keys over id", () => {
      wrapper = mount(OShortcut, { props: { keys: "x", id: "alertsImport" } });
      expect(wrapper.find("kbd").text()).toBe("X");
    });

    it("should render nothing for an unknown id", () => {
      wrapper = mount(OShortcut, { props: { id: "nopeNotAnId" } });
      expect(wrapper.find("[data-test='o-shortcut']").exists()).toBe(false);
    });
  });

  it("should draw one 18 px mono cap with a 2 px bottom edge (one size)", () => {
    wrapper = mount(OShortcut, { props: { keys: "?" } });
    const cls = wrapper.find("kbd").classes();
    expect(cls).toEqual(
      expect.arrayContaining(["h-4.5", "font-mono", "text-2xs", "border-b-2", "rounded-chip"]),
    );
  });

  it("should use the theme-aware keycap tokens (auto light/dark)", () => {
    wrapper = mount(OShortcut, { props: { keys: "?" } });
    const cls = wrapper.find("kbd").classes();
    expect(cls).toContain("bg-kbd-bg");
    expect(cls).toContain("border-kbd-border");
    expect(cls).toContain("text-kbd-text");
  });
});
