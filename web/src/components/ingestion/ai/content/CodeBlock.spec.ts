// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";

const copyMock = vi.fn();
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyMock(...args),
}));
vi.mock("vuex", () => ({ useStore: () => ({ state: { theme: "light" } }) }));

import CodeBlock from "./CodeBlock.vue";

const mountBlock = (code: string, lang = "bash") =>
  mount(CodeBlock, {
    props: { code, lang },
    global: {
      stubs: {
        // Plain native button — the parent's @click falls through to it.
        // (Don't also $emit('click') or the handler fires twice in the stub.)
        OButton: {
          template: '<button data-test="ai-code-copy-btn"><slot /></button>',
        },
        OIcon: true,
        OTooltip: true,
      },
    },
  });

describe("CodeBlock", () => {
  beforeEach(() => copyMock.mockClear());

  it("renders the code and the language label", () => {
    const wrapper = mountBlock("echo hello", "bash");
    expect(wrapper.text()).toContain("echo hello");
    expect(wrapper.find(".o2-code-lang").text()).toBe("bash");
  });

  it("copies the raw code (not the highlighted markup) on click", () => {
    const code = 'curl --token="Basic abc=="';
    const wrapper = mountBlock(code, "bash");
    wrapper.find('[data-test="ai-code-copy-btn"]').trigger("click");
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copyMock.mock.calls[0][0]).toBe(code);
  });

  it("falls back to 'text' label when no language is given", () => {
    const wrapper = mountBlock("plain", "");
    expect(wrapper.find(".o2-code-lang").text()).toBe("text");
  });
});
