<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  OSnapScrollEmits,
  OSnapScrollExpose,
  OSnapScrollProps,
  OSnapScrollSlots,
} from "./OSnapScroll.types";
import { useShortcuts } from "@/lib/vue-shortcut-manager";

const props = withDefaults(defineProps<OSnapScrollProps>(), {
  snap: true,
  active: undefined,
});

const emit = defineEmits<OSnapScrollEmits>();

defineSlots<OSnapScrollSlots>();

const root = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);

// Sub-pixel layout makes an exact offset comparison flap between two stops.
const EDGE = 2;
// Trackpad momentum keeps firing wheel events; a pause this long starts a new gesture.
const GESTURE_GAP_MS = 200;
// The section whose start has crossed this share of the viewport is the current one.
const SPY_BAND = 0.3;
// A reveal hands focus to the element at once; a dropdown opened during a smooth glide closes on its next scroll event.
const REVEAL_BEHAVIOR: ScrollBehavior = "instant";

const BUTTON_LIKE =
  'button, a[href], summary, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"]';

const sections = (): HTMLElement[] =>
  root.value ? Array.from(root.value.querySelectorAll<HTMLElement>("[data-snap-section]")) : [];

const offsetOf = (el: HTMLElement): number => {
  const scroller = root.value;
  if (!scroller) return 0;
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
};

// A short section snaps only at its start; a tall one also at each visible block.
const markStops = (): void => {
  const scroller = root.value;
  if (!scroller) return;
  const viewport = scroller.clientHeight;
  for (const section of sections()) {
    const tall = props.snap && section.offsetHeight > viewport + EDGE;
    section.querySelectorAll<HTMLElement>("[data-snap-stop]").forEach((stop) => {
      if (tall && stop.offsetHeight > 0) stop.setAttribute("data-snap-on", "");
      else stop.removeAttribute("data-snap-on");
    });
  }
};

// `at` is where the stop starts; `to` is where the browser rests for it, above it by its scroll margin.
const stopList = (sectionsOnly: boolean): { at: number; to: number }[] => {
  const stops = sectionsOnly
    ? sections()
    : [
        ...sections(),
        ...Array.from(root.value?.querySelectorAll<HTMLElement>("[data-snap-on]") ?? []),
      ];
  return stops
    .map((el) => {
      const at = offsetOf(el);
      return { at, to: Math.max(0, at - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0)) };
    })
    .sort((a, b) => a.at - b.at);
};

const stopOffsets = (sectionsOnly: boolean): number[] =>
  stopList(sectionsOnly)
    .map((s) => s.to)
    .sort((a, b) => a - b);

const targetFor = (direction: 1 | -1, sectionsOnly: boolean): number | null => {
  const scroller = root.value;
  if (!scroller) return null;
  const top = scroller.scrollTop;
  const max = scroller.scrollHeight - scroller.clientHeight;
  const viewport = scroller.clientHeight;
  const stops = stopOffsets(sectionsOnly);
  if (direction === 1) {
    const next = stops.find((s) => s > top + EDGE) ?? max;
    // Never skip content: a block taller than the view pages by at most one view.
    return Math.min(next, sectionsOnly ? next : top + viewport, max);
  }
  const prev = [...stops].reverse().find((s) => s < top - EDGE) ?? 0;
  return Math.max(prev, sectionsOnly ? prev : top - viewport, 0);
};

const go = (direction: 1 | -1, sectionsOnly: boolean): void => {
  markStops();
  const target = targetFor(direction, sectionsOnly);
  if (target === null || !root.value) return;
  root.value.scrollTo({ top: target, behavior: "smooth" });
};

const pageStop = (direction: 1 | -1): void => go(direction, false);
const pageSection = (direction: 1 | -1): void => go(direction, true);

// Focus follows the jump so the next Tab starts in the picked section.
const scrollToSection = (id: string): void => {
  const section = sections().find((el) => el.dataset.snapSection === id);
  if (!section) return;
  if (props.snap && root.value) {
    root.value.scrollTo({ top: offsetOf(section), behavior: "smooth" });
  } else {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  section.querySelector<HTMLElement>("[data-snap-heading]")?.focus({ preventScroll: true });
};

// With snapping on, a stop is a resting place, so land on the last one at or above the element when it shows from there.
const revealElement = (el: HTMLElement): void => {
  const scroller = root.value;
  if (!scroller || !scroller.contains(el)) return;
  if (!props.snap) {
    el.scrollIntoView({ behavior: REVEAL_BEHAVIOR, block: "center" });
    return;
  }
  markStops();
  const top = offsetOf(el);
  const above = stopList(false).filter((s) => s.at <= top + EDGE);
  const stop = above[above.length - 1] ?? { at: 0, to: 0 };
  const view = scroller.clientHeight;
  let rest = stop.to;
  if (top + el.getBoundingClientRect().height > rest + view - EDGE) {
    // A section taller than the view rests anywhere it covers the view, so the element can sit just under the header.
    const section = el.closest<HTMLElement>("[data-snap-section]");
    const lastCovered = section ? offsetOf(section) + section.offsetHeight - view : rest;
    rest = Math.min(top - (stop.at - stop.to), Math.max(rest, lastCovered));
  }
  scroller.scrollTo({
    top: Math.max(0, Math.min(rest, scroller.scrollHeight - view)),
    behavior: REVEAL_BEHAVIOR,
  });
};

const updateActive = (): void => {
  const list = sections();
  const scroller = root.value;
  if (!list.length || !scroller) return;
  let id = list[0].dataset.snapSection ?? "";
  const atBottom =
    props.snap && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - EDGE;
  if (atBottom && scroller.scrollTop > 0) {
    id = list[list.length - 1].dataset.snapSection ?? id;
  } else {
    const band = props.snap
      ? scroller.getBoundingClientRect().top + scroller.clientHeight * SPY_BAND
      : window.innerHeight * SPY_BAND;
    for (const section of list) {
      if (section.getBoundingClientRect().top <= band) id = section.dataset.snapSection ?? id;
    }
  }
  if (id && id !== props.active) emit("update:active", id);
};

let frame = 0;
const onAnyScroll = (): void => {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    updateActive();
  });
};

const innerScrolls = (target: EventTarget | null, direction: 1 | -1): boolean => {
  let el = target instanceof Element ? target : null;
  while (el && el !== root.value) {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        const canMove =
          direction === 1 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
        if (canMove) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
};

let lastWheelAt = -Infinity;
const onWheel = (e: WheelEvent): void => {
  if (!props.snap || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  const direction = e.deltaY > 0 ? 1 : -1;
  if (innerScrolls(e.target, direction)) return;
  e.preventDefault();
  const now = e.timeStamp;
  const fresh = now - lastWheelAt > GESTURE_GAP_MS;
  lastWheelAt = now;
  if (fresh) pageStop(direction);
};

const onPageKey = (e: KeyboardEvent | undefined, run: () => void): void => {
  const focused = document.activeElement;
  // The shortcut swallowed Space, so a focused button still has to be pressed.
  if (e?.key === " " && focused instanceof HTMLElement && focused.matches(BUTTON_LIKE)) {
    focused.click();
    return;
  }
  run();
};

useShortcuts(
  [
    { id: "sectionedFormNextStop", handler: (e) => onPageKey(e, () => pageStop(1)) },
    { id: "sectionedFormPrevStop", handler: (e) => onPageKey(e, () => pageStop(-1)) },
    { id: "sectionedFormNextSection", handler: (e) => onPageKey(e, () => pageSection(1)) },
    { id: "sectionedFormPrevSection", handler: (e) => onPageKey(e, () => pageSection(-1)) },
  ],
  undefined,
  { active: computed(() => props.snap) },
);

let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  document.addEventListener("scroll", onAnyScroll, { capture: true, passive: true });
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      markStops();
      updateActive();
    });
    if (root.value) resizeObserver.observe(root.value);
    if (content.value) resizeObserver.observe(content.value);
  }
  markStops();
  updateActive();
});

onBeforeUnmount(() => {
  document.removeEventListener("scroll", onAnyScroll, { capture: true });
  resizeObserver?.disconnect();
  if (frame) cancelAnimationFrame(frame);
});

watch(
  () => props.snap,
  async () => {
    await nextTick();
    markStops();
    updateActive();
  },
);

defineExpose<OSnapScrollExpose>({ scrollToSection, revealElement, pageStop, pageSection });
</script>

<template>
  <div
    ref="root"
    data-test="o-snap-scroll"
    :class="[
      'min-h-0',
      snap
        ? '[container-type:size] snap-y snap-mandatory overflow-y-auto overscroll-contain [&_[data-snap-on]]:snap-start [&_[data-snap-section]]:min-h-[100cqh] [&_[data-snap-section]]:snap-start'
        : '',
    ]"
    @wheel="onWheel"
  >
    <div ref="content">
      <slot />
    </div>
  </div>
</template>
