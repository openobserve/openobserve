import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

/** Tracks whether the scroll area matched inside `root` can still scroll right, and its box within `root`. */
export function useScrollEndFade(root: Ref<HTMLElement | null>, selector: string) {
  const visible = ref(false);
  const box = ref({ top: 0, bottom: 0, end: 0 });
  let target: HTMLElement | null = null;
  let resize: ResizeObserver | undefined;

  function measure() {
    const host = root.value;
    if (!target || !host) {
      visible.value = false;
      return;
    }
    // A sub-pixel remainder is the end of the scroll; zoomed layouts round scrollWidth up.
    visible.value = target.scrollWidth - target.clientWidth - target.scrollLeft >= 1;
    const outer = host.getBoundingClientRect();
    const inner = target.getBoundingClientRect();
    const top = inner.top + target.clientTop - outer.top;
    box.value = {
      top,
      bottom: outer.bottom - (top + outer.top + target.clientHeight),
      end: outer.right - (inner.left + target.clientLeft + target.clientWidth),
    };
  }

  function detach() {
    target?.removeEventListener("scroll", measure);
    resize?.disconnect();
    target = null;
  }

  function attach(host: HTMLElement | null) {
    detach();
    target = host?.querySelector<HTMLElement>(selector) ?? null;
    if (target) {
      target.addEventListener("scroll", measure, { passive: true });
      if (typeof ResizeObserver !== "undefined") {
        resize = new ResizeObserver(measure);
        resize.observe(target);
        for (const child of Array.from(target.children)) resize.observe(child);
      }
    }
    measure();
  }

  // The table area mounts and unmounts with the catalog's loading and empty states.
  watch(root, attach, { flush: "post" });
  onMounted(() => attach(root.value));
  onBeforeUnmount(detach);

  return { visible, box, measure, refresh: () => attach(root.value) };
}
