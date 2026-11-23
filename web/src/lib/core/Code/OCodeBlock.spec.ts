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
import hljs from "./highlighter";

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

  it("bypasses cache reads and writes for sensitive code", async () => {
    const highlight = vi.spyOn(hljs, "highlight");
    const wrapper = mountBlock({ code: "echo cache-probe", lang: "bash" });
    const initial = highlight.mock.calls.length;
    await wrapper.setProps({ sensitive: true });
    expect(highlight).toHaveBeenCalledTimes(initial + 1);
    await wrapper.setProps({ code: "echo secret-probe" });
    await wrapper.setProps({ code: "echo cache-probe" });
    expect(highlight).toHaveBeenCalledTimes(initial + 3);
    await wrapper.setProps({ sensitive: false, code: "echo secret-probe" });
    expect(highlight).toHaveBeenCalledTimes(initial + 4);
    await wrapper.setProps({ code: "echo cache-probe" });
    expect(highlight).toHaveBeenCalledTimes(initial + 4);
    highlight.mockRestore();
  });

  it("pads the code 12 px inside the frame", () => {
    expect(mountBlock({ code: "x" }).find("pre").classes()).toContain("p-3");
  });

  it("renders the code and names the language in the 36 px head", () => {
    const wrapper = mountBlock({ code: "echo hello", lang: "bash" });
    expect(wrapper.text()).toContain("echo hello");
    expect(wrapper.find('[data-test="code-block-name"]').text()).toBe("bash");
    expect(wrapper.find(".o2-code-toolbar").classes()).toContain("h-9");
  });

  it("names the file and shows the language beside it", () => {
    const wrapper = mountBlock({ code: "a: 1", lang: "yaml", filename: "otel.yaml" });
    expect(wrapper.find('[data-test="code-block-name"]').text()).toBe("otel.yaml");
    expect(wrapper.find(".o2-code-toolbar").text()).toContain("yaml");
  });

  it("copies the raw code (not the highlighted markup) on click", () => {
    const code = 'curl --token="Basic abc=="';
    const wrapper = mountBlock({ code, lang: "bash" });
    wrapper.find('[data-test="code-block-copy-btn"]').trigger("click");
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copyMock.mock.calls[0][0]).toBe(code);
  });

  it("leaves the failure wording to the shared copy, so a failed copy reads Couldn't copy", () => {
    const wrapper = mountBlock({ code: "x", lang: "bash" });
    wrapper.find('[data-test="code-block-copy-btn"]').trigger("click");
    expect(copyMock.mock.calls[0][2].errorMessage).toBeUndefined();
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
    expect(wrapper.find('[data-test="code-block-name"]').text()).toBe("text");
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

    const sixLines = ["a", "b", "c", "d", "e", "f"].join("\n");

    it("collapses past maxLines behind Show all N lines, and expands on click", async () => {
      const wrapper = mountBlock({ code: sixLines, maxLines: 4 });
      expect(pre(wrapper).attributes("style") ?? "").toContain("max-height");
      expect(pre(wrapper).classes()).toContain("overflow-y-hidden");
      const toggle = wrapper.find('[data-test="code-block-show-all"]');
      expect(toggle.exists()).toBe(true);
      await toggle.trigger("click");
      expect(pre(wrapper).attributes("style") ?? "").not.toContain("max-height");
    });

    it("collapses at 12 lines by default", () => {
      const thirteen = Array.from({ length: 13 }, (_, i) => `line ${i}`).join("\n");
      expect(
        mountBlock({ code: thirteen }).find('[data-test="code-block-show-all"]').exists(),
      ).toBe(true);
      expect(
        mountBlock({ code: sixLines }).find('[data-test="code-block-show-all"]').exists(),
      ).toBe(false);
    });

    it("offers a wrap toggle only when a line is long", async () => {
      expect(
        mountBlock({ code: "SELECT 1" }).find('[data-test="code-block-wrap-btn"]').exists(),
      ).toBe(false);
      const wrapper = mountBlock({ code: "x".repeat(80) });
      await wrapper.find('[data-test="code-block-wrap-btn"]').trigger("click");
      expect(pre(wrapper).classes()).toContain("o2-code-pre--wrap");
    });

    it("leaves the height uncapped when maxLines is not given", () => {
      const wrapper = mountBlock({ code: "SELECT 1" });
      expect(pre(wrapper).attributes("style") ?? "").not.toContain("max-height");
    });

    it("publishes the line-height so the cap and the leading cannot drift apart", () => {
      const wrapper = mountBlock({ code: sixLines, maxLines: 4 });
      const style = pre(wrapper).attributes("style") ?? "";

      const lineHeight = Number(/--code-line-height:\s*([\d.]+)/.exec(style)?.[1]);
      expect(lineHeight).toBeGreaterThan(0);

      // The cap is the published line-height times the lines, plus the 12 px padding on each side.
      expect(style).toContain(`max-height: calc(${4 * lineHeight}em + 1.5rem)`);
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

  describe("copy and masked selection", () => {
    const TOKEN = "abcd1234secretwxyz";
    const MASK = "abcd\u2022\u2022\u2022\u2022wxyz";
    const code = `curl -u me@x.io:${TOKEN} -k https://h/api/o/default/_json`;
    const masked = `curl -u me@x.io:${MASK} -k https://h/api/o/default/_json`;

    const mountAttached = (props: Record<string, unknown>) =>
      mount(OCodeBlock, {
        props: { code, codeMasked: masked, ...props } as any,
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

    it("copies the real code from the copy button", async () => {
      const wrapper = mountAttached({ tokenName: "prod-ingest" });
      await wrapper.find('[data-test="code-block-copy-btn"]').trigger("click");
      await flushPromises();
      expect(copyMock).toHaveBeenCalledTimes(1);
      expect(copyMock.mock.calls[0][0]).toBe(code);
      expect(wrapper.emitted("copy")).toEqual([[{ partial: false }]]);
      wrapper.unmount();
    });

    it("never copies on a click or Enter on the block itself", async () => {
      const wrapper = mountAttached({});
      const pre = wrapper.find("pre");
      await pre.trigger("pointerdown");
      await pre.trigger("click");
      await pre.trigger("keydown", { key: "Enter" });
      await flushPromises();
      expect(copyMock).not.toHaveBeenCalled();
      expect(pre.attributes("tabindex")).toBeUndefined();
      expect(wrapper.emitted("copy")).toBeUndefined();
      wrapper.unmount();
    });

    it("keeps the mask in a selection that crosses the token, warns, and reports no copy", () => {
      const wrapper = mountAttached({ tokenName: "prod-ingest" });
      const codeEl = wrapper.find("code").element;
      select(codeEl, masked.indexOf("me@"), masked.indexOf(" https"));
      const { setData, event } = fireCopy(codeEl);
      expect(setData).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(toastMock).toHaveBeenCalledTimes(1);
      expect(toastMock.mock.calls[0][0]).toMatchObject({
        variant: "warning",
        message: "The hidden token was copied as dots. Use Copy, or Reveal it first.",
      });
      expect(wrapper.emitted("copy")).toBeUndefined();
      wrapper.unmount();
    });

    it("reports a revealed selection across the token as a partial copy, with no warning", async () => {
      const wrapper = mountAttached({});
      await wrapper.find('[data-test="code-block-reveal-btn"]').trigger("click");
      const codeEl = wrapper.find("code").element;
      select(codeEl, 0, code.length);
      fireCopy(codeEl);
      expect(toastMock).not.toHaveBeenCalled();
      expect(wrapper.emitted("copy")).toEqual([[{ partial: true }]]);
      wrapper.unmount();
    });

    it("reports a selection copy as partial", () => {
      const wrapper = mountAttached({});
      const codeEl = wrapper.find("code").element;
      select(codeEl, masked.indexOf("https"), masked.length);
      fireCopy(codeEl);
      expect(wrapper.emitted("copy")).toEqual([[{ partial: true }]]);
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
