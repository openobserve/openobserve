import { ref, onMounted, onBeforeUnmount, type Ref } from "vue";

// Chromium reports scrollWidth === clientWidth for a clamped word that overflows by a fraction of a px yet still draws an ellipsis.
export function isElementTruncated(el: HTMLElement, clamp: boolean): boolean {
  if (!clamp) return el.scrollWidth > el.clientWidth;
  if (el.scrollHeight > el.clientHeight) return true;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  if (typeof range.getBoundingClientRect !== "function") return false;
  return range.getBoundingClientRect().width > el.getBoundingClientRect().width;
}

/**
 * Composable that tracks whether an element's content is being clipped by
 * CSS truncation (`overflow-hidden` + `text-ellipsis`/`whitespace-nowrap`),
 * so callers can show a tooltip with the full value only when it's actually
 * cut off — pair with `OTooltip`'s `disabled` prop.
 */
export function useIsTruncated(elRef: Ref<HTMLElement | null>, options: { clamp?: boolean } = {}) {
  const isTruncated = ref(false);

  function update() {
    const el = elRef.value;
    isTruncated.value = !!el && isElementTruncated(el, options.clamp === true);
  }

  let resizeObserver: ResizeObserver | null = null;

  function attach() {
    const el = elRef.value;
    if (!el) return;
    resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    update();
    // A late web font changes the text width without resizing the box, so the observer never fires.
    if (el.ownerDocument.fonts?.status === "loading") el.ownerDocument.fonts.ready.then(update);
  }

  function detach() {
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  onMounted(attach);
  onBeforeUnmount(detach);

  return { isTruncated, update };
}
