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

  it("should render no tooltip at all when tooltip is false", () => {
    wrapper = mount(OTruncatedText, { props: { tooltip: false }, slots: { default: "x" } });
    expect(wrapper.findComponent(OTooltip).exists()).toBe(false);
  });
});
