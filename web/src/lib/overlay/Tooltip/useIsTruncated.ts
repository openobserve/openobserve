import { ref, onMounted, onBeforeUnmount, type Ref } from "vue";

/** True when `el` cuts its content off; `clamp` says whether the box is line-clamped, read from its style when left out. */
export function isElementTruncated(el: Element | null | undefined, clamp?: boolean): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.scrollWidth > el.clientWidth) return true;
  // Only a clamped box may be taller than itself; elsewhere glyph overflow would read as "cut".
  if (!(clamp ?? isLineClamped(el))) return false;
  if (el.scrollHeight > el.clientHeight) return true;
  // Chromium reports scrollWidth === clientWidth for a clamped word that overflows by a fraction of a px yet still draws an ellipsis.
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  if (typeof range.getBoundingClientRect !== "function") return false;
  return range.getBoundingClientRect().width > el.getBoundingClientRect().width;
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
export function useIsTruncated(elRef: Ref<HTMLElement | null>, options: { clamp?: boolean } = {}) {
  const isTruncated = ref(false);

  function update() {
    const el = elRef.value;
    isTruncated.value = isElementTruncated(el, options.clamp === true);
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

function isLineClamped(el: HTMLElement): boolean {
  const clamp = getComputedStyle(el).getPropertyValue("-webkit-line-clamp");
  return clamp !== "" && clamp !== "none";
}
