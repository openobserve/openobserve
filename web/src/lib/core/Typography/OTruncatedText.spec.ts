import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import OTruncatedText from "./OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

// jsdom has no layout, so a test sets the two widths the cut-off check compares.
function setWidths(el: Element, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
}

async function hoverPastDelay(el: Element) {
  el.dispatchEvent(new MouseEvent("mouseenter"));
  vi.advanceTimersByTime(700);
  await nextTick();
  await nextTick();
}

function tooltipBubble() {
  return document.body.querySelector('[data-test="o-tooltip-content"]');
}

describe("OTruncatedText", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
  });

  it("should render a span carrying only the cut-off classes", () => {
    wrapper = mount(OTruncatedText, { slots: { default: "payment-service" } });
    const root = wrapper.find('[data-test="o-truncated-text"]');
    expect(root.element.tagName).toBe("SPAN");
    expect(root.classes()).toEqual(["min-w-0", "truncate"]);
    expect(root.text()).toBe("payment-service");
  });

  it("should keep the call site's element, classes and data-test", () => {
    wrapper = mount(OTruncatedText, {
      props: { as: "div" },
      attrs: { class: "text-xs text-text-secondary", "data-test": "folder-name" },
      slots: { default: "Shared" },
    });
    const root = wrapper.find('[data-test="folder-name"]');
    expect(root.element.tagName).toBe("DIV");
    expect(root.classes()).toEqual(
      expect.arrayContaining(["text-xs", "text-text-secondary", "min-w-0", "truncate"]),
    );
  });

  it("should clamp to the requested number of lines instead of one line", () => {
    wrapper = mount(OTruncatedText, { props: { lines: 2 }, slots: { default: "Long text" } });
    const root = wrapper.find('[data-test="o-truncated-text"]');
    expect(root.classes()).toContain("line-clamp-2");
    expect(root.classes()).not.toContain("truncate");
  });

  it("should show the full text in a tooltip when the text is cut", async () => {
    vi.useFakeTimers();
    wrapper = mount(OTruncatedText, {
      slots: { default: "payment-service-production-eu-west" },
      attachTo: document.body,
    });
    const root = wrapper.find('[data-test="o-truncated-text"]').element;
    setWidths(root, 310, 200);

    await hoverPastDelay(root);

    expect(tooltipBubble()?.textContent).toContain("payment-service-production-eu-west");
  });

  it("should not open a tooltip when the text fits", async () => {
    vi.useFakeTimers();
    wrapper = mount(OTruncatedText, { slots: { default: "short" }, attachTo: document.body });
    const root = wrapper.find('[data-test="o-truncated-text"]').element;
    setWidths(root, 120, 200);

    await hoverPastDelay(root);

    expect(tooltipBubble()).toBeNull();
  });

  it("should show custom tooltip text when one is given", async () => {
    vi.useFakeTimers();
    wrapper = mount(OTruncatedText, {
      props: { tooltip: raw("Payment service (production)") },
      slots: { default: "payment-service" },
      attachTo: document.body,
    });
    const root = wrapper.find('[data-test="o-truncated-text"]').element;
    setWidths(root, 310, 200);

    await hoverPastDelay(root);

    expect(tooltipBubble()?.textContent).toContain("Payment service (production)");
  });

  it("should give the tooltip bubble the requested classes, keeping the text's line breaks", async () => {
    vi.useFakeTimers();
    const text = "SELECT *\n  FROM k8s\n WHERE a = 1";
    wrapper = mount(OTruncatedText, {
      props: { lines: 2, tooltipClass: "whitespace-pre-wrap font-mono" },
      slots: { default: () => text },
      attachTo: document.body,
    });
    const root = wrapper.find('[data-test="o-truncated-text"]').element;
    setWidths(root, 310, 200);

    await hoverPastDelay(root);

    expect(tooltipBubble()?.className).toContain("whitespace-pre-wrap");
    expect(tooltipBubble()?.className).toContain("font-mono");
    expect(tooltipBubble()?.textContent).toContain(text);
  });

  it("should render no tooltip at all when tooltip is false", () => {
    wrapper = mount(OTruncatedText, { props: { tooltip: false }, slots: { default: "x" } });
    expect(wrapper.findComponent(OTooltip).exists()).toBe(false);
  });

  it("should mark itself off when tooltip is false, so a surrounding table never shows its text", () => {
    wrapper = mount(OTruncatedText, { props: { tooltip: false }, slots: { default: "x" } });
    expect(wrapper.attributes("data-o-tooltip-off")).toBe("");
  });

  it("should carry no off marker when it has a tooltip", () => {
    wrapper = mount(OTruncatedText, { slots: { default: "x" } });
    expect(wrapper.attributes("data-o-tooltip-off")).toBeUndefined();
  });

  describe('truncate="middle"', () => {
    const RealResizeObserver = globalThis.ResizeObserver;

    // jsdom has no layout or canvas: give the element its rounded and fractional widths and the canvas a per-character measure.
    const withLayout = (clientWidth: number, contentWidth = clientWidth) => {
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth);
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        font: "",
        measureText: (value: string) => ({ width: Array.from(value).length * 10 }),
      } as unknown as CanvasRenderingContext2D);
      globalThis.ResizeObserver = class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element) {
          const entry = { target, contentRect: { width: contentWidth } } as ResizeObserverEntry;
          this.callback([entry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
      };
    };

    afterEach(() => {
      vi.restoreAllMocks();
      globalThis.ResizeObserver = RealResizeObserver;
    });

    it("cuts a long value in the middle so its start and tail stay visible", async () => {
      withLayout(150);
      wrapper = mount(OTruncatedText, {
        props: { truncate: "middle", text: "payment-service-production-eu-west-1" },
        attachTo: document.body,
      });
      await nextTick();
      const root = wrapper.find('[data-test="o-truncated-text"]');
      expect(root.findAll('[aria-hidden="true"]').at(-1)!.text()).toBe("payment…-west-1");
      expect(root.find(".sr-only").text()).toBe("payment-service-production-eu-west-1");
      expect(root.attributes("tabindex")).toBe("0");
    });

    it("fits the cut to the box inside its padding, so the tail is never clipped (F4)", async () => {
      withLayout(170, 150);
      wrapper = mount(OTruncatedText, {
        props: { truncate: "middle", text: "payment-service-production-eu-west-1" },
        attrs: { style: "padding-left: 10px; padding-right: 10px" },
        attachTo: document.body,
      });
      await nextTick();
      const root = wrapper.find('[data-test="o-truncated-text"]');
      expect(root.findAll('[aria-hidden="true"]').at(-1)!.text()).toBe("payment…-west-1");
    });

    it("cuts a value that overflows its box by a fraction of a pixel the rounded clientWidth hides", async () => {
      withLayout(150, 149.6);
      wrapper = mount(OTruncatedText, {
        props: { truncate: "middle", text: "abcdefghijklmno" },
        attachTo: document.body,
      });
      await nextTick();
      const root = wrapper.find('[data-test="o-truncated-text"]');
      expect(root.findAll('[aria-hidden="true"]').at(-1)!.text()).toBe("abcdef…ijklmno");
      expect(wrapper.findComponent(OTooltip).props("disabled")).toBe(false);
    });

    it("with fitParent, fits the room its parent leaves after its other children", async () => {
      withLayout(500);
      const widths = new Map<string, number>([
        ["parent", 200],
        ["copy", 40],
      ]);
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return widths.get(this.dataset.role ?? "") ?? 500;
      });
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return widths.get(this.dataset.role ?? "") ?? 0;
      });
      const host = mount(
        {
          components: { OTruncatedText },
          template: `<span data-role="parent"><OTruncatedText truncate="middle" fit-parent text="payment-service-production-eu-west-1" /><button data-role="copy" /></span>`,
        },
        { attachTo: document.body },
      );
      await nextTick();
      const root = host.find('[data-test="o-truncated-text"]');
      expect(root.findAll('[aria-hidden="true"]').at(-1)!.text()).toBe("payment…u-west-1");
      host.unmount();
    });

    it("shows the full value in its tooltip on hover and on focus", async () => {
      withLayout(150);
      vi.useFakeTimers();
      wrapper = mount(OTruncatedText, {
        props: { truncate: "middle", text: "payment-service-production-eu-west-1" },
        attachTo: document.body,
      });
      await nextTick();
      const root = wrapper.find('[data-test="o-truncated-text"]').element as HTMLElement;
      await hoverPastDelay(root);
      expect(tooltipBubble()?.textContent).toContain("payment-service-production-eu-west-1");
      root.dispatchEvent(new MouseEvent("mouseleave"));
      vi.advanceTimersByTime(700);
      await nextTick();
      root.dispatchEvent(new FocusEvent("focus"));
      vi.advanceTimersByTime(700);
      await nextTick();
      await nextTick();
      expect(tooltipBubble()?.textContent).toContain("payment-service-production-eu-west-1");
    });

    it("stays out of the Tab order when cut but not focusable, keeping its hover tooltip", async () => {
      withLayout(150);
      wrapper = mount(OTruncatedText, {
        props: {
          truncate: "middle",
          text: "payment-service-production-eu-west-1",
          focusable: false,
        },
        attachTo: document.body,
      });
      await nextTick();
      const root = wrapper.find('[data-test="o-truncated-text"]');
      expect(root.find(".sr-only").text()).toBe("payment-service-production-eu-west-1");
      expect(root.attributes("tabindex")).toBeUndefined();
      expect(wrapper.findComponent(OTooltip).props("disabled")).toBe(false);
    });

    it("measures every instance on one shared canvas", async () => {
      withLayout(150);
      const create = vi.spyOn(document, "createElement");
      const canvases = () => create.mock.calls.filter(([tag]) => tag === "canvas").length;
      const first = mount(OTruncatedText, {
        props: { truncate: "middle", text: "payment-service-production-eu-west-1" },
        attachTo: document.body,
      });
      const afterFirst = canvases();
      wrapper = mount(OTruncatedText, {
        props: { truncate: "middle", text: "checkout-service-production-us-east-2" },
        attachTo: document.body,
      });
      await nextTick();
      expect(canvases()).toBe(afterFirst);
      expect(wrapper.findAll('[aria-hidden="true"]').at(-1)!.text()).toBe("checkou…-east-2");
      first.unmount();
    });

    it("leaves a value that fits whole, with no tooltip and no tab stop", async () => {
      withLayout(150);
      wrapper = mount(OTruncatedText, {
        props: { truncate: "middle", text: "api" },
        attachTo: document.body,
      });
      await nextTick();
      const root = wrapper.find('[data-test="o-truncated-text"]');
      expect(root.text()).toBe("api");
      expect(root.attributes("tabindex")).toBeUndefined();
      expect(wrapper.findComponent(OTooltip).props("disabled")).toBe(true);
    });

    it("shows the first line of a multi-line value and counts it as cut", async () => {
      withLayout(150);
      wrapper = mount(OTruncatedText, {
        props: { truncate: "middle", text: "line one\nline two" },
        attachTo: document.body,
      });
      await nextTick();
      const root = wrapper.find('[data-test="o-truncated-text"]');
      expect(root.findAll('[aria-hidden="true"]').at(-1)!.text()).toBe("line one…");
      expect(wrapper.findComponent(OTooltip).props("disabled")).toBe(false);
    });

    it("shows the whole line until the element has a width to measure", () => {
      wrapper = mount(OTruncatedText, {
        props: { truncate: "middle", text: "payment-service-production-eu-west-1" },
      });
      const root = wrapper.find('[data-test="o-truncated-text"]');
      expect(root.text()).toBe("payment-service-production-eu-west-1");
      expect(root.classes()).toEqual(["min-w-0", "truncate"]);
    });
  });
});
