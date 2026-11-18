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
// The section whose start has crossed this share of the viewport is the current one.
const SPY_BAND = 0.3;
// A stop nearer the section's start than this share of the view would spend a key press on almost no movement.
const MIN_STOP = 0.1;
// A reveal hands focus to the element at once; a dropdown opened during a smooth glide closes on its next scroll event.
const REVEAL_BEHAVIOR: ScrollBehavior = "instant";
// Without `scrollend`, a scroll counts as finished after this long without a scroll event.
const SETTLE_MS = 150;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const BUTTON_LIKE =
  'button, summary, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"]';

const reducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.(REDUCED_MOTION)?.matches === true;

const motionBehavior = (): ScrollBehavior => (reducedMotion() ? "instant" : "smooth");

const sections = (): HTMLElement[] =>
  root.value ? Array.from(root.value.querySelectorAll<HTMLElement>("[data-snap-section]")) : [];

const offsetOf = (el: HTMLElement): number => {
  const scroller = root.value;
  if (!scroller) return 0;
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
};

const restOffset = (el: HTMLElement): number =>
  Math.max(0, offsetOf(el) - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0));

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

// A tall section also stops where its end meets the bottom of the view, so paging shows all of it.
const sectionEnds = (): number[] => {
  const viewport = root.value?.clientHeight ?? 0;
  return sections()
    .filter((section) => section.offsetHeight > viewport + EDGE)
    .map((section) => offsetOf(section) + section.offsetHeight - viewport);
};

// `at` is where the stop starts; `to` is where the browser rests for it, above it by its scroll margin.
const stopList = (sectionsOnly: boolean): { at: number; to: number }[] => {
  const stops = sectionsOnly
    ? sections()
    : [
        ...sections(),
        ...Array.from(root.value?.querySelectorAll<HTMLElement>("[data-snap-on]") ?? []),
      ];
  return stops.map((el) => ({ at: offsetOf(el), to: restOffset(el) })).sort((a, b) => a.at - b.at);
};

const stopOffsets = (sectionsOnly: boolean): number[] => {
  const starts = sections().map(offsetOf);
  if (sectionsOnly) return starts.sort((a, b) => a - b);
  const near = (root.value?.clientHeight ?? 0) * MIN_STOP;
  const blocks = stopList(false)
    .map((s) => s.to)
    .filter((to) => !starts.some((start) => to > start && to - start < near));
  return [...blocks, ...sectionEnds()].sort((a, b) => a - b);
};

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

const nearest = (stops: number[], top: number): number =>
  stops.reduce(
    (best, stop) => (Math.abs(stop - top) < Math.abs(best - top) ? stop : best),
    Infinity,
  );

// A section start inside the view means two sections show. A tall section rests on its nearest stop
// past where the scroll began, so its end stays reachable and is never a trap; a short one rests ahead.
const settleTarget = (top: number, from: number): number | null => {
  const scroller = root.value;
  if (!scroller) return null;
  const view = scroller.clientHeight;
  const list = sections();
  const lower = list.map(offsetOf).find((start) => start > top + EDGE && start < top + view - EDGE);
  if (lower === undefined) return null;
  const upper = list.filter((section) => offsetOf(section) <= top + EDGE).pop();
  const direction = Math.sign(top - from);
  let target: number;
  if (upper && upper.offsetHeight > view + EDGE) {
    markStops();
    const ahead = stopOffsets(false).filter((s) => !direction || (s - from) * direction > EDGE);
    if (!ahead.length) return null;
    target = nearest(ahead, top);
  } else {
    const up = direction < 0 || (direction === 0 && top - (lower - view) < lower - top);
    target = up ? lower - view : lower;
  }
  return Math.max(0, Math.min(target, scroller.scrollHeight - view));
};

// Never glide away from the section being worked in. The heading takes focus only as a Tab
// start after a jump, so it pins nothing.
const leavesFocus = (target: number): boolean => {
  const scroller = root.value;
  const focused = document.activeElement;
  if (!scroller || !(focused instanceof HTMLElement) || !scroller.contains(focused)) return false;
  if (focused.matches("[data-snap-heading]")) return false;
  const section = focused.closest<HTMLElement>("[data-snap-section]");
  if (!section) return false;
  const start = offsetOf(section);
  const end = start + section.getBoundingClientRect().height;
  return end <= target + EDGE || start >= target + scroller.clientHeight - EDGE;
};

// Focus moves a control into view below the sticky section header rather than under it.
const padForStickyHeader = (): void => {
  const scroller = root.value;
  if (!scroller) return;
  let height = 0;
  if (props.snap) {
    for (const section of sections()) {
      const candidates = [
        ...Array.from(section.children),
        ...Array.from(section.querySelectorAll("[data-snap-sticky]")),
      ];
      for (const child of candidates) {
        if (child instanceof HTMLElement && getComputedStyle(child).position === "sticky") {
          height = Math.max(height, child.offsetHeight);
        }
      }
    }
  }
  scroller.style.scrollPaddingTop = height ? `${height}px` : "";
};

const go = (direction: 1 | -1, sectionsOnly: boolean): void => {
  markStops();
  const target = targetFor(direction, sectionsOnly);
  if (target === null || !root.value) return;
  root.value.scrollTo({ top: target, behavior: motionBehavior() });
};

const pageStop = (direction: 1 | -1): void => go(direction, false);
const pageSection = (direction: 1 | -1): void => go(direction, true);

// Focus follows the jump so the next Tab starts in the picked section.
const scrollToSection = (id: string): void => {
  const section = sections().find((el) => el.dataset.snapSection === id);
  if (!section) return;
  if (props.snap && root.value) {
    root.value.scrollTo({ top: offsetOf(section), behavior: motionBehavior() });
  } else {
    section.scrollIntoView({ behavior: motionBehavior(), block: "start" });
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

// Only a scroll the user drives settles. A press on content cancels it, so a click never
// glides the control it pressed away, and a scripted scroll (focus, a test runner) never settles.
let driven = false;
const onDrive = (): void => {
  driven = true;
};
const onPress = (e: PointerEvent): void => {
  driven = e.target === root.value;
};

// The wheel is never intercepted: only once a scroll has stopped does it glide on to a whole section.
let restTop = 0;
const settle = (): void => {
  const scroller = root.value;
  if (!scroller || !props.snap) return;
  const top = scroller.scrollTop;
  const from = restTop;
  restTop = top;
  const wanted = driven;
  driven = false;
  if (!wanted || reducedMotion()) return;
  const target = settleTarget(top, from);
  if (target === null || Math.abs(target - top) <= EDGE || leavesFocus(target)) return;
  scroller.scrollTo({ top: target, behavior: "smooth" });
};

let settleTimer: ReturnType<typeof setTimeout> | undefined;
const hasScrollEnd = typeof window !== "undefined" && "onscrollend" in window;
const onOwnScroll = (): void => {
  if (hasScrollEnd) return;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, SETTLE_MS);
};

const onPageKey = (e: KeyboardEvent | undefined, run: () => void): void => {
  const focused = document.activeElement;
  // The shortcut swallowed Space, so a focused button still has to be pressed.
  if (e?.key === " " && focused instanceof HTMLElement && focused.matches(BUTTON_LIKE)) {
    // A held Space presses a native button once, not once per key repeat.
    if (!e.repeat) focused.click();
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
  root.value?.addEventListener("scroll", onOwnScroll, { passive: true });
  root.value?.addEventListener("scrollend", settle);
  root.value?.addEventListener("wheel", onDrive, { passive: true });
  root.value?.addEventListener("touchmove", onDrive, { passive: true });
  root.value?.addEventListener("pointerdown", onPress, { capture: true, passive: true });
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      markStops();
      padForStickyHeader();
      updateActive();
    });
    if (root.value) resizeObserver.observe(root.value);
    if (content.value) resizeObserver.observe(content.value);
  }
  markStops();
  padForStickyHeader();
  updateActive();
});

onBeforeUnmount(() => {
  document.removeEventListener("scroll", onAnyScroll, { capture: true });
  root.value?.removeEventListener("scroll", onOwnScroll);
  root.value?.removeEventListener("scrollend", settle);
  root.value?.removeEventListener("wheel", onDrive);
  root.value?.removeEventListener("touchmove", onDrive);
  root.value?.removeEventListener("pointerdown", onPress, { capture: true });
  clearTimeout(settleTimer);
  resizeObserver?.disconnect();
  if (frame) cancelAnimationFrame(frame);
});

watch(
  () => props.snap,
  async () => {
    await nextTick();
    markStops();
    padForStickyHeader();
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
        ? '[container-type:size] overflow-y-auto overscroll-contain [&_[data-snap-section]]:min-h-[100cqh]'
        : '',
    ]"
  >
    <div ref="content">
      <slot />
    </div>
  </div>
</template>
