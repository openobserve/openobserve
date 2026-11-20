import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import { raw } from "@/types/i18n";
import OCopyButton from "./OCopyButton.vue";

const copyMock = vi.fn();
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyMock(...args),
}));

const i18n = createI18n({ locale: "en", legacy: false, messages: { en: enLocale } });
const global = {
  plugins: [i18n],
  stubs: { OTooltip: { props: ["content"], template: "<span data-tooltip>{{ content }}</span>" } },
};

const mountCopy = (props: Record<string, unknown> = {}) =>
  mount(OCopyButton, {
    props: { value: "4bf92f35", ...props },
    global,
    attrs: { "data-test": "copy" },
  });
const button = (wrapper: ReturnType<typeof mountCopy>) => wrapper.get('[data-test="copy"]');

describe("OCopyButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    copyMock.mockReset();
    copyMock.mockResolvedValue(true);
  });
  afterEach(() => vi.useRealTimers());

  it("is a ghost sm icon-only button named Copy by default", () => {
    const wrapper = mountCopy();
    expect(button(wrapper).attributes("data-o2-variant")).toBe("ghost");
    expect(button(wrapper).attributes("data-o2-size")).toBe("sm");
    expect(button(wrapper).classes()).toContain("size-control-sm");
    expect(button(wrapper).attributes("aria-label")).toBe("Copy");
    expect(wrapper.get("[data-tooltip]").text()).toBe("Copy");
  });

  it("names the value it copies", () => {
    const wrapper = mountCopy({ label: raw("Copy trace ID"), size: "xs" });
    expect(button(wrapper).attributes("aria-label")).toBe("Copy trace ID");
    expect(button(wrapper).classes()).toContain("size-control-xs");
  });

  it("renders a text button with showLabel", () => {
    const wrapper = mountCopy({ showLabel: true, variant: "secondary" });
    expect(button(wrapper).text()).toBe("Copy");
    expect(button(wrapper).classes()).toContain("h-control-sm");
  });

  it("copies silently, swaps to a check for 1.5 s and announces Copied", async () => {
    const wrapper = mountCopy({ showLabel: true });
    await button(wrapper).trigger("click");
    await flushPromises();
    expect(copyMock).toHaveBeenCalledWith("4bf92f35", expect.any(Function), { silent: true });
    expect(wrapper.emitted("copied")?.[0]).toEqual(["4bf92f35"]);
    expect(button(wrapper).attributes("data-copied")).toBe("true");
    expect(button(wrapper).text()).toBe("Copied");
    expect(wrapper.get("[role='status']").text()).toBe("Copied");
    vi.advanceTimersByTime(1500);
    await flushPromises();
    expect(button(wrapper).attributes("data-copied")).toBeUndefined();
    expect(wrapper.get("[role='status']").text()).toBe("");
  });

  it("reads a function value at click time", async () => {
    let current = "first";
    const wrapper = mountCopy({ value: () => current });
    current = "second";
    await button(wrapper).trigger("click");
    await flushPromises();
    expect(copyMock.mock.calls[0][0]).toBe("second");
  });

  it("says the copy was blocked and emits failed when the clipboard refuses", async () => {
    copyMock.mockResolvedValue(false);
    const wrapper = mountCopy();
    await button(wrapper).trigger("click");
    await flushPromises();
    expect(wrapper.emitted("failed")?.[0]).toEqual(["4bf92f35"]);
    expect(wrapper.emitted("copied")).toBeUndefined();
    expect(button(wrapper).attributes("aria-label")).toBe("Copy blocked · press Ctrl C");
  });

  it("never lets the click reach a clickable row", async () => {
    const onRow = vi.fn();
    const wrapper = mountCopy();
    const row = document.createElement("div");
    row.addEventListener("click", onRow);
    row.appendChild(wrapper.element.parentElement ?? wrapper.element);
    button(wrapper).element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(onRow).not.toHaveBeenCalled();
  });
});
