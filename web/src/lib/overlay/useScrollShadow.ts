import { ref, onMounted, onBeforeUnmount, type Ref } from "vue";

/**
 * Composable that tracks whether a scrollable element can scroll
 * up and/or down, enabling CSS shadow indicators at the edges.
 */
export function useScrollShadow(elRef: Ref<HTMLElement | null>) {
  const canScrollUp = ref(false);
  const canScrollDown = ref(false);

  function update() {
    const el = elRef.value;
    if (!el) {
      canScrollUp.value = false;
      canScrollDown.value = false;
      return;
    }
    canScrollUp.value = el.scrollTop > 0;
    canScrollDown.value =
      el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  }

  let resizeObserver: ResizeObserver | null = null;

  function attach() {
    const el = elRef.value;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    update();
  }

  function detach() {
    const el = elRef.value;
    if (el) el.removeEventListener("scroll", update);
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  onMounted(attach);
  onBeforeUnmount(detach);

  return { canScrollUp, canScrollDown, update, attach, detach };
}
