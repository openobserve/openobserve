import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { usePullToRefresh } from "./usePullToRefresh";

const isMobileRef = ref(true);
vi.mock("./useScreen", () => ({
  useScreen: () => ({
    isMobile: isMobileRef,
  }),
}));

const vibrateSpy = vi.fn();
vi.mock("./useHaptics", () => ({
  useHaptics: () => ({
    vibrate: vibrateSpy,
    supportsVibrate: { value: true },
  }),
}));

const makeTouch = (clientY: number): any => ({
  clientY,
  clientX: 0,
  identifier: 0,
});

const fireTouch = (
  el: HTMLElement,
  type: "touchstart" | "touchmove" | "touchend",
  clientY: number,
) => {
  const event: any = new Event(type, { bubbles: true, cancelable: true });
  event.touches = type === "touchend" ? [] : [makeTouch(clientY)];
  event.changedTouches = [makeTouch(clientY)];
  el.dispatchEvent(event);
};

const mountHarness = (onRefresh: () => Promise<unknown>) => {
  const Harness = defineComponent({
    setup() {
      const containerRef = ref<HTMLElement | null>(null);
      const state = usePullToRefresh(containerRef, {
        threshold: 70,
        onRefresh,
      });
      return { containerRef, ...state };
    },
    render() {
      return h(
        "div",
        {
          ref: "containerRef",
          style: "height: 200px; overflow-y: auto;",
        },
        [h("div", { style: "height: 400px" })],
      );
    },
  });
  return mount(Harness, { global: { plugins: [Quasar] }, attachTo: document.body });
};

describe("usePullToRefresh", () => {
  beforeEach(() => {
    isMobileRef.value = true;
    vibrateSpy.mockReset();
  });

  it("fires onRefresh when pull distance exceeds threshold", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const w = mountHarness(onRefresh);
    const el = w.element as HTMLElement;
    Object.defineProperty(el, "scrollTop", { value: 0, configurable: true });

    fireTouch(el, "touchstart", 100);
    fireTouch(el, "touchmove", 260);
    fireTouch(el, "touchend", 260);
    await nextTick();

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not fire onRefresh when pull distance is below threshold", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const w = mountHarness(onRefresh);
    const el = w.element as HTMLElement;
    Object.defineProperty(el, "scrollTop", { value: 0, configurable: true });

    fireTouch(el, "touchstart", 100);
    fireTouch(el, "touchmove", 140);
    fireTouch(el, "touchend", 140);
    await nextTick();

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not fire onRefresh if container is already scrolled", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const w = mountHarness(onRefresh);
    const el = w.element as HTMLElement;
    Object.defineProperty(el, "scrollTop", { value: 50, configurable: true });

    fireTouch(el, "touchstart", 100);
    fireTouch(el, "touchmove", 300);
    fireTouch(el, "touchend", 300);
    await nextTick();

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("is a no-op on desktop (isMobile === false)", async () => {
    isMobileRef.value = false;
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const w = mountHarness(onRefresh);
    const el = w.element as HTMLElement;
    Object.defineProperty(el, "scrollTop", { value: 0, configurable: true });

    fireTouch(el, "touchstart", 100);
    fireTouch(el, "touchmove", 300);
    fireTouch(el, "touchend", 300);
    await nextTick();

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("fires haptic impact exactly once when threshold is crossed", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const w = mountHarness(onRefresh);
    const el = w.element as HTMLElement;
    Object.defineProperty(el, "scrollTop", { value: 0, configurable: true });

    fireTouch(el, "touchstart", 100);
    // Below threshold — no haptic yet.
    fireTouch(el, "touchmove", 180);
    expect(vibrateSpy).not.toHaveBeenCalled();
    // Cross threshold — single impact.
    fireTouch(el, "touchmove", 260);
    expect(vibrateSpy).toHaveBeenCalledTimes(1);
    expect(vibrateSpy).toHaveBeenCalledWith("impact");
    // Keep pulling past threshold — must not re-fire within the gesture.
    fireTouch(el, "touchmove", 320);
    expect(vibrateSpy).toHaveBeenCalledTimes(1);
    fireTouch(el, "touchend", 320);
    await nextTick();
  });

  it("does not fire haptic when pull is released below threshold", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const w = mountHarness(onRefresh);
    const el = w.element as HTMLElement;
    Object.defineProperty(el, "scrollTop", { value: 0, configurable: true });

    fireTouch(el, "touchstart", 100);
    fireTouch(el, "touchmove", 140);
    fireTouch(el, "touchend", 140);
    await nextTick();

    expect(vibrateSpy).not.toHaveBeenCalled();
  });

  it("does not fire onRefresh while a previous refresh is in-flight", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    const onRefresh = vi.fn(
      () => new Promise((r) => (resolveFn = r)),
    );
    const w = mountHarness(onRefresh);
    const el = w.element as HTMLElement;
    Object.defineProperty(el, "scrollTop", { value: 0, configurable: true });

    fireTouch(el, "touchstart", 100);
    fireTouch(el, "touchmove", 300);
    fireTouch(el, "touchend", 300);
    await nextTick();
    expect(onRefresh).toHaveBeenCalledTimes(1);

    fireTouch(el, "touchstart", 100);
    fireTouch(el, "touchmove", 300);
    fireTouch(el, "touchend", 300);
    await nextTick();
    expect(onRefresh).toHaveBeenCalledTimes(1);

    resolveFn(undefined);
  });
});
