// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";

const copyMock = vi.fn();
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyMock(...args),
}));
vi.mock("vuex", () => ({ useStore: () => ({ state: { theme: "light" } }) }));

import OCodeBlock from "./OCodeBlock.vue";

const stubs = {
  // Native button so the parent's @click falls through (no extra $emit('click')
  // or the handler would fire twice). The real data-test attr is forwarded.
  OButton: {
    inheritAttrs: true,
    template: '<button v-bind="$attrs"><slot /></button>',
  },
  OIcon: true,
  OTooltip: true,
};

const mountBlock = (props: Record<string, unknown>) =>
  mount(OCodeBlock, { props: props as any, global: { stubs } });

describe("OCodeBlock", () => {
  beforeEach(() => copyMock.mockClear());

  it("renders the code and the language label", () => {
    const wrapper = mountBlock({ code: "echo hello", lang: "bash" });
    expect(wrapper.text()).toContain("echo hello");
    expect(wrapper.find(".o2-code-lang").text()).toBe("bash");
  });

  it("copies the raw code (not the highlighted markup) on click", () => {
    const code = 'curl --token="Basic abc=="';
    const wrapper = mountBlock({ code, lang: "bash" });
    wrapper.find('[data-test="code-block-copy-btn"]').trigger("click");
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copyMock.mock.calls[0][0]).toBe(code);
  });

  it("emits copy after copying", async () => {
    const wrapper = mountBlock({ code: "x", lang: "bash" });
    await wrapper.find('[data-test="code-block-copy-btn"]').trigger("click");
    expect(wrapper.emitted("copy")).toBeTruthy();
  });

  it("falls back to 'text' label when no language is given", () => {
    const wrapper = mountBlock({ code: "plain", lang: "" });
    expect(wrapper.find(".o2-code-lang").text()).toBe("text");
  });

  it("namespaces the copy button data-test via the dataTest prop", () => {
    const wrapper = mountBlock({ code: "x", lang: "bash", dataTest: "ai-code" });
    expect(wrapper.find('[data-test="ai-code-copy-btn"]').exists()).toBe(true);
  });

  it("exposes the dataTest prop on the block root so the block is locatable", () => {
    const wrapper = mountBlock({
      code: "insecureHTTP: true",
      lang: "javascript",
      dataTest: "ai-code",
    });
    const root = wrapper.find('[data-test="ai-code"]');
    expect(root.exists()).toBe(true);
    expect(root.text()).toContain("insecureHTTP: true");
  });

  it("shows a reveal toggle and copies the real code (not the mask) when masked", () => {
    const real = "secret=abc123";
    const wrapper = mountBlock({ code: real, lang: "bash", codeMasked: "secret=•••" });
    // masked variant shown by default
    expect(wrapper.text()).toContain("•••");
    expect(wrapper.find('[data-test="code-block-reveal-btn"]').exists()).toBe(true);
    // copy still uses the real code
    wrapper.find('[data-test="code-block-copy-btn"]').trigger("click");
    expect(copyMock.mock.calls[0][0]).toBe(real);
  });

  it("hides the copy button when copyable is false", () => {
    const wrapper = mountBlock({ code: "x", lang: "bash", copyable: false });
    expect(wrapper.find('[data-test="code-block-copy-btn"]').exists()).toBe(false);
  });

  describe("wrap and maxLines", () => {
    const pre = (w: any) => w.find("pre");

    it("scrolls horizontally by default, preserving the existing behaviour", () => {
      const wrapper = mountBlock({ code: "SELECT 1" });
      expect(pre(wrapper).classes()).not.toContain("o2-code-pre--wrap");
    });

    it("wraps long lines when asked, so the end of a query stays visible", () => {
      const wrapper = mountBlock({ code: "SELECT 1", wrap: true });
      expect(pre(wrapper).classes()).toContain("o2-code-pre--wrap");
    });

    it("caps the height at the requested number of lines and scrolls past it", () => {
      const wrapper = mountBlock({ code: "SELECT 1", maxLines: 4 });
      const style = pre(wrapper).attributes("style") ?? "";

      // Expressed in em so the cap tracks the code font size rather than
      // assuming a pixel height.
      expect(style).toContain("max-height");
      expect(style).toContain("em");
      expect(style).toContain("overflow-y: auto");
    });

    it("leaves the height uncapped when maxLines is not given", () => {
      const wrapper = mountBlock({ code: "SELECT 1" });
      expect(pre(wrapper).attributes("style") ?? "").not.toContain("max-height");
    });

    it("publishes the line-height so the cap and the leading cannot drift apart", () => {
      const wrapper = mountBlock({ code: "SELECT 1", maxLines: 4 });
      const style = pre(wrapper).attributes("style") ?? "";

      const lineHeight = Number(/--code-line-height:\s*([\d.]+)/.exec(style)?.[1]);
      expect(lineHeight).toBeGreaterThan(0);

      // The cap must be the published line-height times the requested lines —
      // if the stylesheet and the maths ever diverge, this catches it.
      const capped = /max-height:\s*calc\(([\d.]+)em\)/.exec(style)?.[1];
      expect(Number(capped)).toBeCloseTo(4 * lineHeight, 5);
    });
  });
});
