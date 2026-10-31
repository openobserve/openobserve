import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import OToastProvider from "./OToastProvider.vue";
import { toastRecords, toast } from "./useToast";
import { confirmCopy, copyConfirm, dismissCopyConfirm } from "./copyConfirm";
import { raw } from "@/types/i18n";

beforeEach(() => {
  toastRecords.splice(0, toastRecords.length);
});

describe("OToastProvider", () => {
  it("closes a copy confirmation whose anchor leaves the page", () => {
    vi.useFakeTimers();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    confirmCopy(anchor, raw("Copied"));
    expect(copyConfirm.open).toBe(true);

    anchor.remove();
    vi.advanceTimersByTime(250);
    expect(copyConfirm.open).toBe(false);
    vi.useRealTimers();
  });

  it("closes with the toast fallback when a scroll finds its anchor gone before it was seen", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onUnseen = vi.fn();
    confirmCopy(anchor, raw("Copied"), onUnseen);

    anchor.remove();
    document.dispatchEvent(new Event("scroll"));
    expect(copyConfirm.open).toBe(false);
    expect(onUnseen).toHaveBeenCalledTimes(1);
  });

  it("listens for the activated control only while mounted", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const captured = (spy: typeof add) =>
      spy.mock.calls.filter(([, , opts]) => typeof opts === "object" && opts.capture);
    const wrapper = mount(OToastProvider, { attachTo: document.body });
    const added = captured(add).filter(([type]) => type !== "scroll");
    expect(added.map(([type]) => type)).toEqual(["pointerdown", "keydown"]);

    wrapper.unmount();
    for (const [type, fn] of added) {
      expect(captured(remove).some(([t, f]) => t === type && f === fn)).toBe(true);
    }
    vi.restoreAllMocks();
  });

  it("closes an open copy confirmation and stops its work when it unmounts", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error");
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");
    const top = { value: 500 };
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => new DOMRect(10, top.value, 20, 20);
    document.body.appendChild(anchor);
    const wrapper = mount(OToastProvider, { attachTo: document.body });
    const frame = vi.spyOn(window, "requestAnimationFrame");
    const onUnseen = vi.fn();
    confirmCopy(anchor, raw("Copied"), onUnseen);
    await nextTick();
    const frameId = frame.mock.results.at(-1)?.value;
    expect(frameId).toBeDefined();

    wrapper.unmount();
    top.value = 100;
    document.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(5000);

    expect(copyConfirm.open).toBe(false);
    expect(onUnseen).not.toHaveBeenCalled();
    expect(cancelFrame).toHaveBeenCalledWith(frameId);
    expect(vi.getTimerCount()).toBe(0);
    expect(errors).not.toHaveBeenCalled();
    anchor.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when the page scrolls under an open copy confirmation", () => {
    const anchorAt = (top: { value: number }) => {
      const anchor = document.createElement("button");
      anchor.getBoundingClientRect = () => new DOMRect(10, top.value, 20, 20);
      document.body.appendChild(anchor);
      return anchor;
    };

    it("keeps it while its anchor stays put", () => {
      const top = { value: 500 };
      const anchor = anchorAt(top);
      const scroller = document.createElement("div");
      document.body.appendChild(scroller);
      confirmCopy(anchor, raw("Copied"));

      scroller.dispatchEvent(new Event("scroll"));

      expect(copyConfirm.open).toBe(true);
      dismissCopyConfirm();
      anchor.remove();
      scroller.remove();
    });
  });

  it("shows a copy confirmation on its anchor and announces it", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const wrapper = mount(OToastProvider, { attachTo: document.body });

    confirmCopy(anchor, raw("Link copied"));
    for (let i = 0; i < 4; i++) await nextTick();
    expect(document.body.querySelector('[data-test="copy-confirm"]')).toBeNull();
    await vi.waitFor(() =>
      expect(document.body.querySelector('[data-test="copy-confirm"]')).not.toBeNull(),
    );
    const bubble = document.body.querySelector('[data-test="copy-confirm"]');
    expect(bubble?.textContent).toContain("Link copied");
    expect(bubble?.getAttribute("data-test-variant")).toBe("success");
    expect(bubble?.getAttribute("data-test-message")).toBe("Link copied");
    const region = document.body.querySelector('[data-test="copy-confirm-announcer"]');
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toBe("Link copied");

    dismissCopyConfirm();
    for (let i = 0; i < 4; i++) await nextTick();
    expect(document.body.querySelector('[data-test="copy-confirm"]')).toBeNull();
    expect(region?.textContent).toBe("");

    wrapper.unmount();
    anchor.remove();
  });

  it("renders nothing (no OToast elements) when toastRecords is empty", () => {
    const wrapper = mount(OToastProvider, { attachTo: document.body });
    // No ToastRoot elements should be rendered
    expect(wrapper.findAll('[role="status"], [role="alert"]')).toHaveLength(0);
  });

  it("renders one OToast per record in toastRecords", async () => {
    toast({ variant: "success", message: "First", timeout: 0 });
    toast({ variant: "error", message: "Second", timeout: 0 });

    const wrapper = mount(OToastProvider, { attachTo: document.body });
    await nextTick();

    const toastElements = wrapper.findAll('[role="status"], [role="alert"]');
    expect(toastElements).toHaveLength(2);
  });

  it("removes a record after openChange(false) fires", async () => {
    toast({ variant: "info", message: "Temp", timeout: 0 });

    const wrapper = mount(OToastProvider, { attachTo: document.body });
    await nextTick();

    expect(toastRecords).toHaveLength(1);

    // Simulate Reka firing openChange(false) by directly calling the handler
    // Manually trigger handleOpenChange by emitting on the OToast child
    const oToast = wrapper.findComponent({ name: "OToast" });
    oToast.vm.$emit("openChange", false);
    await nextTick();

    expect(toastRecords).toHaveLength(0);
  });
});
