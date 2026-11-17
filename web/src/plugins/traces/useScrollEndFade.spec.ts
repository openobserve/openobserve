import { describe, it, expect, afterEach } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { useScrollEndFade } from "./useScrollEndFade";

function sized(el: HTMLElement, box: { scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => box.scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => box.clientWidth });
}

function host(box: { scrollWidth: number; clientWidth: number }) {
  let fade!: ReturnType<typeof useScrollEndFade>;
  const view = mount(
    defineComponent({
      setup() {
        const root = ref<HTMLElement | null>(null);
        fade = useScrollEndFade(root, '[data-test="scroller"]');
        return () => h("div", { ref: root }, [h("div", { "data-test": "scroller" })]);
      },
    }),
    { attachTo: document.body },
  );
  const scroller = view.get('[data-test="scroller"]').element as HTMLElement;
  sized(scroller, box);
  return { view, scroller, fade: () => fade };
}

let view: VueWrapper | undefined;
afterEach(() => view?.unmount());

describe("useScrollEndFade", () => {
  it("shows while the area can scroll further right and hides at the end of the scroll", async () => {
    const made = host({ scrollWidth: 1400, clientWidth: 1000 });
    view = made.view;
    made.fade().measure();
    expect(made.fade().visible.value).toBe(true);
    made.scroller.scrollLeft = 400;
    made.scroller.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(made.fade().visible.value).toBe(false);
    made.scroller.scrollLeft = 120;
    made.scroller.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(made.fade().visible.value).toBe(true);
  });

  it("stays hidden when nothing overflows", () => {
    const made = host({ scrollWidth: 1000, clientWidth: 1000 });
    view = made.view;
    made.fade().measure();
    expect(made.fade().visible.value).toBe(false);
  });

  it("treats a sub-pixel remainder as the end of the scroll", () => {
    const made = host({ scrollWidth: 1000.6, clientWidth: 1000 });
    view = made.view;
    made.fade().measure();
    expect(made.fade().visible.value).toBe(false);
  });
});
