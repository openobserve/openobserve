import { ref, onMounted, onBeforeUnmount, type Ref } from "vue";

/**
 * Composable that tracks whether an element's content is being clipped by
 * CSS truncation (`overflow-hidden` + `text-ellipsis`/`whitespace-nowrap`),
 * so callers can show a tooltip with the full value only when it's actually
 * cut off — pair with `OTooltip`'s `disabled` prop.
 */
export function useIsTruncated(elRef: Ref<HTMLElement | null>) {
  const isTruncated = ref(false);

  function update() {
    const el = elRef.value;
    isTruncated.value = !!el && el.scrollWidth > el.clientWidth;
  }

  let resizeObserver: ResizeObserver | null = null;

  function attach() {
    const el = elRef.value;
    if (!el) return;
    resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    update();
  }

  function detach() {
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  onMounted(attach);
  onBeforeUnmount(detach);

  return { isTruncated, update };
}
