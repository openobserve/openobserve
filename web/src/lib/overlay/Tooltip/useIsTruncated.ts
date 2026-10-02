import { ref, onMounted, onBeforeUnmount, type Ref } from "vue";

/** True when `el` is cutting its content off: wider than its box, or taller than it under `line-clamp`. */
export function isElementTruncated(el: Element | null | undefined): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.scrollWidth > el.clientWidth) return true;
  // Only a clamped box may be taller than itself; elsewhere glyph overflow would read as "cut".
  const clamp = getComputedStyle(el).getPropertyValue("-webkit-line-clamp");
  return clamp !== "" && clamp !== "none" && el.scrollHeight > el.clientHeight;
}

/** Full visible text of an element, capped so a huge value cannot flood a tooltip. */
export function readElementText(el: Element, maxLength = 2000): string {
  return (el.textContent ?? "").trim().slice(0, maxLength);
}

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
    isTruncated.value = isElementTruncated(el);
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
