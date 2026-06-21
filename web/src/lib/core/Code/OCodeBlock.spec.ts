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
});
