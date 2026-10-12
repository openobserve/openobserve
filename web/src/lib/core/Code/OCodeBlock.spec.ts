// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";

const copyMock = vi.fn();
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyMock(...args),
}));
vi.mock("vuex", () => ({ useStore: () => ({ state: { theme: "light" } }) }));
const toastMock = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

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
  beforeEach(() => {
    copyMock.mockReset();
    copyMock.mockResolvedValue(true);
  });

  it("insets the code only when padded", () => {
    expect(mountBlock({ code: "x" }).find("pre").classes()).not.toContain("px-3");
    expect(mountBlock({ code: "x", padded: true }).find("pre").classes()).toContain("px-3");
  });

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
    await flushPromises();
    expect(wrapper.emitted("copy")).toBeTruthy();
  });

  it("does not emit copy when the clipboard write fails", async () => {
    copyMock.mockResolvedValue(false);
    const wrapper = mountBlock({ code: "x", lang: "bash" });
    await wrapper.find('[data-test="code-block-copy-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("copy")).toBeUndefined();
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

  describe("inset", () => {
    const style = (w: any) => w.find("pre").attributes("style") ?? "";

    it("keeps the code flush with the border by default", () => {
      expect(style(mountBlock({ code: "SELECT 1" }))).not.toContain("padding");
    });

    it("pads the code away from the border when asked", () => {
      expect(style(mountBlock({ code: "SELECT 1", inset: true }))).toContain("padding: 0.75rem");
    });

    it("adds the inset to the height cap so the same number of lines stays visible", () => {
      const capped = style(mountBlock({ code: "SELECT 1", inset: true, maxLines: 4 }));
      expect(capped).toMatch(/max-height:\s*calc\([^)]*em \+ 1\.5rem\)/);
    });
  });

  describe("line numbers", () => {
    const gutter = (w: any) => w.find('[data-test="code-block-line-numbers"]');

    it("has no gutter by default", () => {
      const wrapper = mountBlock({ code: "a\nb" });
      expect(gutter(wrapper).exists()).toBe(false);
      expect(wrapper.find("pre").classes()).not.toContain("o2-code-pre--numbered");
    });

    it("numbers one line per row when asked", () => {
      const wrapper = mountBlock({ code: "one\ntwo\nthree", lineNumbers: true });

      expect(wrapper.find("pre").classes()).toContain("o2-code-pre--numbered");
      expect(gutter(wrapper).text()).toBe("1\n2\n3");
    });

    it("gives a trailing newline no number of its own", () => {
      // Generated files end with a newline; numbering it would show a count one
      // higher than the lines the reader can see.
      const wrapper = mountBlock({ code: "one\ntwo\n", lineNumbers: true });
      expect(gutter(wrapper).text()).toBe("1\n2");
    });

    it("keeps the numbers out of a selection and out of the a11y tree", () => {
      const wrapper = mountBlock({ code: "a\nb", lineNumbers: true });

      expect(gutter(wrapper).classes()).toContain("select-none");
      expect(gutter(wrapper).attributes("aria-hidden")).toBe("true");
    });

    it("suppresses the gutter when wrapping, which would misalign it", () => {
      const wrapper = mountBlock({ code: "a\nb", lineNumbers: true, wrap: true });

      expect(gutter(wrapper).exists()).toBe(false);
      expect(wrapper.find("pre").classes()).not.toContain("o2-code-pre--numbered");
    });

    it("numbers the masked variant it is actually showing", () => {
      const wrapper = mountBlock({
        code: "real\nsecret\nlines",
        codeMasked: "masked",
        lineNumbers: true,
      });
      expect(gutter(wrapper).text()).toBe("1");
    });
  });

  describe("copy on click and masked selection", () => {
    const TOKEN = "abcd1234secretwxyz";
    const MASK = "abcd\u2022\u2022\u2022\u2022wxyz";
    const code = `curl -u me@x.io:${TOKEN} -k https://h/api/o/default/_json`;
    const masked = `curl -u me@x.io:${MASK} -k https://h/api/o/default/_json`;

    const mountAttached = (props: Record<string, unknown>) =>
      mount(OCodeBlock, {
        props: { code, codeMasked: masked, copyOnClick: true, ...props } as any,
        global: { stubs },
        attachTo: document.body,
      });

    // Maps a character offset in the rendered text to the text node holding it.
    const pointAt = (root: Node, index: number): [Node, number] => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let node = walker.nextNode();
      while (node) {
        const len = node.textContent?.length ?? 0;
        if (index <= seen + len) return [node, index - seen];
        seen += len;
        node = walker.nextNode();
      }
      throw new Error("offset outside the text");
    };

    const select = (root: Element, from: number, to: number) => {
      const range = document.createRange();
      range.setStart(...pointAt(root, from));
      range.setEnd(...pointAt(root, to));
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    };

    const fireCopy = (el: Element) => {
      const setData = vi.fn();
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { setData } });
      el.dispatchEvent(event);
      return { setData, event };
    };

    beforeEach(() => {
      toastMock.mockReset();
      window.getSelection()?.removeAllRanges();
    });

    it("copies the real code and focuses the block on the first click", async () => {
      const wrapper = mountAttached({ tokenName: "prod-ingest" });
      const pre = wrapper.find("pre");
      await pre.trigger("pointerdown");
      await pre.trigger("click");
      await flushPromises();
      expect(copyMock).toHaveBeenCalledTimes(1);
      expect(copyMock.mock.calls[0][0]).toBe(code);
      expect(copyMock.mock.calls[0][2].successMessage).toBe("Copied with org token prod-ingest");
      expect(document.activeElement).toBe(pre.element);
      expect(wrapper.emitted("copy")).toEqual([[{ partial: false }]]);
      wrapper.unmount();
    });

    it("treats later clicks on the focused block as plain text", async () => {
      const wrapper = mountAttached({});
      const pre = wrapper.find("pre");
      await pre.trigger("pointerdown");
      await pre.trigger("click");
      await pre.trigger("pointerdown");
      await pre.trigger("click");
      expect(copyMock).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it("does not copy on a click that ends a drag selection", async () => {
      const wrapper = mountAttached({});
      const codeEl = wrapper.find("code").element;
      select(codeEl, 0, 4);
      await wrapper.find("pre").trigger("click");
      expect(copyMock).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("copies again on Enter while focused", async () => {
      const wrapper = mountAttached({});
      await wrapper.find("pre").trigger("keydown", { key: "Enter" });
      await flushPromises();
      expect(copyMock).toHaveBeenCalledTimes(1);
      expect(copyMock.mock.calls[0][0]).toBe(code);
      wrapper.unmount();
    });

    it("leaves clicks alone without copyOnClick", async () => {
      const wrapper = mountAttached({ copyOnClick: false });
      const pre = wrapper.find("pre");
      await pre.trigger("click");
      expect(copyMock).not.toHaveBeenCalled();
      expect(pre.attributes("tabindex")).toBeUndefined();
      wrapper.unmount();
    });

    it("puts the real token in the clipboard for a selection across the mask", async () => {
      const wrapper = mountAttached({ tokenName: "prod-ingest" });
      const codeEl = wrapper.find("code").element;
      const from = masked.indexOf("me@");
      const to = masked.indexOf(" https");
      select(codeEl, from, to);
      const { setData, event } = fireCopy(codeEl);
      expect(setData).toHaveBeenCalledWith("text/plain", `me@x.io:${TOKEN} -k`);
      expect(event.defaultPrevented).toBe(true);
      expect(codeEl.textContent).toBe(masked);
      expect(toastMock.mock.calls[0][0].message).toBe("Copied with org token prod-ingest");
      expect(wrapper.emitted("copy")).toEqual([[{ partial: true }]]);
      wrapper.unmount();
    });

    it("copies the whole token when the selection only touches part of the mask", () => {
      const wrapper = mountAttached({});
      const codeEl = wrapper.find("code").element;
      const bullets = masked.indexOf("\u2022");
      select(codeEl, bullets + 1, bullets + 3);
      const { setData } = fireCopy(codeEl);
      expect(setData).toHaveBeenCalledWith("text/plain", "1234secret");
      wrapper.unmount();
    });

    it("copies a selection without the token unchanged", () => {
      const wrapper = mountAttached({});
      const codeEl = wrapper.find("code").element;
      select(codeEl, masked.indexOf("https"), masked.length);
      const { setData, event } = fireCopy(codeEl);
      expect(setData).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(wrapper.emitted("copy")).toEqual([[{ partial: true }]]);
      wrapper.unmount();
    });

    it("does not rewrite when the mask does not line up with the code", () => {
      const wrapper = mountAttached({ codeMasked: "unrelated \u2022\u2022\u2022 text" });
      const codeEl = wrapper.find("code").element;
      select(codeEl, 0, 14);
      const { setData } = fireCopy(codeEl);
      expect(setData).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("does not rewrite once the secret is revealed", async () => {
      const wrapper = mountAttached({});
      await wrapper.find('[data-test="code-block-reveal-btn"]').trigger("click");
      const codeEl = wrapper.find("code").element;
      select(codeEl, 0, code.length);
      const { setData } = fireCopy(codeEl);
      expect(setData).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("shows the token as a toolbar link that emits token-click", async () => {
      const wrapper = mountAttached({
        tokenName: "prod-ingest",
        dataTest: "ingestion-curl-code-block",
      });
      const link = wrapper.find('[data-test="ingestion-curl-code-block-token-link"]');
      expect(link.text()).toBe("org token · prod-ingest");
      await link.trigger("click");
      expect(wrapper.emitted("token-click")).toHaveLength(1);
      wrapper.unmount();
    });

    it("has no token link without a token name", () => {
      const wrapper = mountAttached({});
      expect(wrapper.find('[data-test="code-block-token-link"]').exists()).toBe(false);
      wrapper.unmount();
    });
  });
});
