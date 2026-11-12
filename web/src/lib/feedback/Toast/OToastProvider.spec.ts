import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
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

  it("shows a failed copy red on its anchor and announces it as an alert, not politely", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const wrapper = mount(OToastProvider, { attachTo: document.body });

    confirmCopy(anchor, raw("Couldn't copy"), undefined, "error");
    await vi.waitFor(() =>
      expect(document.body.querySelector('[data-test="copy-confirm"]')).not.toBeNull(),
    );
    const bubble = document.body.querySelector('[data-test="copy-confirm"]');
    expect(bubble?.getAttribute("data-test-variant")).toBe("error");
    expect(bubble?.classList.contains("text-status-error-text")).toBe(true);
    expect(bubble?.textContent).toContain("Couldn't copy");
    const alert = document.body.querySelector('[data-test="copy-confirm-alert"]');
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent?.trim()).toBe("Couldn't copy");
    const polite = document.body.querySelector('[data-test="copy-confirm-announcer"]');
    expect(polite?.textContent?.trim()).toBe("");

    dismissCopyConfirm();
    await nextTick();
    expect(document.body.querySelector('[data-test="copy-confirm-alert"]')).toBeNull();

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

describe("copy confirmation bubble placement and colours", () => {
  let anchor: HTMLButtonElement;
  let placed: HTMLElement[] = [];

  const withRect = <T extends HTMLElement>(
    el: T,
    left: number,
    top: number,
    w: number,
    h: number,
  ) => {
    el.getBoundingClientRect = () => new DOMRect(left, top, w, h);
    return el;
  };
  const placeAnchor = (left: number, top: number, parent: HTMLElement = document.body) => {
    anchor = withRect(document.createElement("button"), left, top, 120, 24);
    parent.appendChild(anchor);
    placed.push(anchor);
  };
  const placeControl = (left: number, top: number, w: number, h: number, tag = "button") => {
    const el = withRect(document.createElement(tag), left, top, w, h);
    document.body.appendChild(el);
    placed.push(el);
    return el;
  };
  const bubbleRoot = () =>
    document.body
      .querySelector('[data-test="copy-confirm"]')
      ?.closest('[data-test="o-tooltip-content"]') as HTMLElement | null;

  const arrowClass = () =>
    [...(bubbleRoot()?.querySelectorAll("svg") ?? [])].at(-1)?.getAttribute("class");

  afterEach(() => {
    dismissCopyConfirm();
    placed.forEach((el) => el.remove());
    placed = [];
  });

  it("sits above the control when nothing is there", () => {
    placeAnchor(200, 300);
    confirmCopy(anchor, raw("Copied"));
    expect(copyConfirm.side).toBe("top");
  });

  it("moves to the end side when a small control sits inside the bubble's box but off every edge sample", () => {
    placeAnchor(200, 120);
    placeControl(230, 85, 24, 24);
    confirmCopy(anchor, raw("Copied"));
    expect(copyConfirm.side).toBe("right");
  });

  it("takes the start side, then below, when the end side is taken too", () => {
    placeAnchor(200, 120);
    placeControl(0, 80, 1024, 30, "div").setAttribute("role", "tab");
    placeControl(330, 120, 40, 24);
    confirmCopy(anchor, raw("Copied"));
    expect(copyConfirm.side).toBe("left");

    placeAnchor(10, 300);
    placeControl(0, 260, 1024, 30, "div").setAttribute("role", "tab");
    placeControl(140, 300, 40, 24);
    confirmCopy(anchor, raw("Copied"));
    expect(copyConfirm.side).toBe("bottom");
  });

  it("counts text boxes and focusable regions, not only buttons", () => {
    placeAnchor(200, 300);
    placeControl(220, 265, 60, 20, "input");
    confirmCopy(anchor, raw("Copied"));
    expect(copyConfirm.side).toBe("right");

    dismissCopyConfirm();
    placeControl(330, 300, 40, 24, "div").setAttribute("tabindex", "0");
    confirmCopy(anchor, raw("Copied"));
    expect(copyConfirm.side).toBe("left");
  });

  it("does not count the copied control, its contents or what holds it as covered", () => {
    const row = document.createElement("div");
    row.setAttribute("tabindex", "0");
    withRect(row, 0, 0, 1024, 768);
    document.body.appendChild(row);
    placed.push(row);
    placeAnchor(200, 300, row);
    anchor.appendChild(document.createElement("span"));
    confirmCopy(anchor, raw("Copied"));
    expect(copyConfirm.side).toBe("top");
  });

  it("ignores controls outside the dialog that holds the copied control", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    placed.push(dialog);
    placeAnchor(200, 300, dialog);
    placeControl(230, 265, 24, 24);
    confirmCopy(anchor, raw("Copied"));
    expect(copyConfirm.side).toBe("top");
  });

  it("falls back to the toast when every side would cover a control", () => {
    placeAnchor(200, 300);
    placeControl(0, 0, 1024, 299, "div").setAttribute("role", "tab");
    placeControl(0, 325, 1024, 443, "div").setAttribute("role", "tab");
    placeControl(0, 300, 199, 24);
    placeControl(321, 300, 703, 24);
    const toastFallback = vi.fn();
    confirmCopy(anchor, raw("Copied"), toastFallback);
    expect(copyConfirm.open).toBe(false);
    expect(toastFallback).toHaveBeenCalledTimes(1);
  });

  it("re-checks the drawn bubble and moves it, or hands over to the toast, when it covers a control", () => {
    const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const drawn = document.createElement("div");
    drawn.setAttribute("data-test", "o-tooltip-content");
    const label = document.createElement("span");
    label.setAttribute("data-test", "copy-confirm");
    drawn.appendChild(label);
    document.body.appendChild(drawn);
    placed.push(drawn);
    drawn.getBoundingClientRect = () =>
      copyConfirm.side === "top" ? new DOMRect(140, 262, 110, 30) : new DOMRect(329, 297, 110, 30);
    placeAnchor(200, 300);
    placeControl(150, 260, 30, 30);
    confirmCopy(anchor, raw("Copied"));
    expect(copyConfirm.open).toBe(true);
    expect(copyConfirm.side).toBe("right");

    placeControl(400, 300, 20, 20);
    placeControl(100, 300, 20, 20);
    placeControl(250, 340, 20, 20);
    const toastFallback = vi.fn();
    confirmCopy(anchor, raw("Copied"), toastFallback);
    expect(copyConfirm.open).toBe(false);
    expect(toastFallback).toHaveBeenCalledTimes(1);
    frame.mockRestore();
  });

  it("draws Copied as the inverse bubble and a failure in the error tint with a red border", async () => {
    placeAnchor(200, 300);
    const wrapper = mount(OToastProvider, { attachTo: document.body });
    confirmCopy(anchor, raw("Copied"));
    await vi.waitFor(() => expect(bubbleRoot()).toBeTruthy());
    expect(bubbleRoot()!.className).toContain("bg-copy-confirm-bg!");
    expect(bubbleRoot()!.className).toContain("text-copy-confirm-text!");
    expect(arrowClass()).toContain("fill-copy-confirm-bg");

    confirmCopy(anchor, raw("Couldn't copy"), undefined, "error");
    await vi.waitFor(() => expect(bubbleRoot()?.className).toContain("bg-copy-confirm-error-bg!"));
    expect(bubbleRoot()!.className).toContain("border-status-error-text/40");
    expect(bubbleRoot()!.className).not.toContain("text-copy-confirm-text!");
    expect(arrowClass()).toContain("fill-copy-confirm-error-bg");
    wrapper.unmount();
  });
});
