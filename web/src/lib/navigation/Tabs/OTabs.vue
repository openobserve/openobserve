<script setup lang="ts">
import type { OTabsProps, OTabsEmits, OTabsSlots } from "./OTabs.types";
import { computed, provide, reactive, ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import { TABS_CONTEXT_KEY } from "./OTabs.types";
import type { TabsContext } from "./OTabs.types";
import { TabsRoot, TabsList } from "reka-ui";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const scrollRef = ref<HTMLElement | null>(null);
const tablistRef = ref<HTMLElement | null>(null);

function handleFocusin(event: FocusEvent): void {
  const target = event.target as HTMLElement;
  if (target.getAttribute("role") !== "tab") return;
  // Scroll into view: arrow keys move focus without activating, so modelValue watch doesn't fire
  const el = scrollRef.value;
  if (!el) return;
  const tabRect = target.getBoundingClientRect();
  const containerRect = el.getBoundingClientRect();
  if (tabRect.left < containerRect.left) {
    el.scrollBy({ left: tabRect.left - containerRect.left - 8, behavior: "smooth" });
  } else if (tabRect.right > containerRect.right) {
    el.scrollBy({ left: tabRect.right - containerRect.right + 8, behavior: "smooth" });
  }
}

const props = withDefaults(defineProps<OTabsProps>(), {
  orientation: "horizontal",
  align: "left",
  dense: false,
  bordered: false,
  reorderable: false,
});

const emit = defineEmits<OTabsEmits>();

defineSlots<OTabsSlots>();

const isVertical = computed(() => props.orientation === "vertical");

/** Called by ORouteTab and forwarded from TabsRoot's update:modelValue */
function onTabClick(name: string | number): void {
  emit("update:modelValue", name);
  emit("change", name);
}

// ── Drag-to-reorder (opt-in via `reorderable`) ─────────────────────────────
// Handlers are delegated on the tablist: drag events bubble up from the
// draggable tab buttons. State is reactive (not imperative DOM styling) so the
// dragged tab dims and the drop target shows an insertion line via OTab. OTabs
// doesn't own the tab list, so on drop it only reports the intended move (by
// tab name + side) via `reorder`; the parent applies it to its data.
const draggingName = ref<string | null>(null);
const dropTargetName = ref<string | null>(null);
const dropBefore = ref(true);

function clearDrag(): void {
  draggingName.value = null;
  dropTargetName.value = null;
}

function tabElFromEvent(e: DragEvent): HTMLElement | null {
  return (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-otab-name]") ?? null;
}

function onTabDragStart(e: DragEvent): void {
  if (!props.reorderable) return;
  const el = tabElFromEvent(e);
  const name = el?.dataset.otabName ?? null;
  if (name == null) return;
  draggingName.value = name;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", name);
  }
}

function onTabDragOver(e: DragEvent): void {
  if (!props.reorderable || draggingName.value == null) return;
  e.preventDefault(); // required to allow a drop
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  const el = tabElFromEvent(e);
  const name = el?.dataset.otabName ?? null;
  if (el == null || name == null || name === draggingName.value) {
    dropTargetName.value = null;
    return;
  }
  // Pointer past the tab's midpoint → drop after it, else before it.
  const rect = el.getBoundingClientRect();
  dropBefore.value = isVertical.value
    ? e.clientY < rect.top + rect.height / 2
    : e.clientX < rect.left + rect.width / 2;
  dropTargetName.value = name;
}

function onTabDrop(e: DragEvent): void {
  if (!props.reorderable) return;
  e.preventDefault();
  const from = draggingName.value ?? e.dataTransfer?.getData("text/plain") ?? null;
  const to = dropTargetName.value;
  if (from != null && to != null && from !== to) {
    // FLIP: sample the current tab positions BEFORE the parent applies the
    // reorder, then slide each tab from its old slot to its new one once the
    // DOM has patched — so the drop settles with motion instead of a jump.
    captureFlipFirst();
    emit("reorder", { from, to, before: dropBefore.value });
    nextTick(() => playFlip());
  }
  clearDrag();
}

// ── FLIP reorder animation ─────────────────────────────────────────────────
// The parent owns the list, so OTabs can't reorder the DOM itself — it only
// animates whatever move the parent applies in response to `reorder`. "First"
// rects are captured just before we emit; "Last" rects after Vue patches the
// DOM on the next tick. Each moved tab is offset back to its old x with no
// transition, then released to slide to identity. Purely visual; if the parent
// declines the move (no DOM change) every delta is 0 and this is a no-op.
const flipFirst = new Map<string | number, number>();

function tabButtons(): HTMLElement[] {
  const list = tablistRef.value;
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLElement>("[data-otab-name]"));
}

function captureFlipFirst(): void {
  flipFirst.clear();
  for (const el of tabButtons()) {
    const name = el.dataset.otabName;
    if (name != null) flipFirst.set(name, el.getBoundingClientRect().left);
  }
}

function playFlip(): void {
  if (flipFirst.size === 0) return;
  const moved: HTMLElement[] = [];
  for (const el of tabButtons()) {
    const name = el.dataset.otabName;
    const first = name != null ? flipFirst.get(name) : undefined;
    if (first == null) continue;
    const dx = first - el.getBoundingClientRect().left;
    if (!dx) continue;
    el.style.transition = "none";
    el.style.transform = `translateX(${dx}px)`;
    moved.push(el);
  }
  flipFirst.clear();
  if (moved.length === 0) return;
  // Commit the inverted starting transforms before releasing them.
  void tablistRef.value?.offsetWidth;
  requestAnimationFrame(() => {
    for (const el of moved) {
      el.style.transition = "transform 250ms cubic-bezier(0.2, 0, 0, 1)";
      el.style.transform = "";
    }
  });
}

function onTabTransitionEnd(e: TransitionEvent): void {
  // Clear the inline FLIP styles once the slide finishes so nothing lingers on
  // the tab (and a later reorder starts from a clean transform).
  if (e.propertyName !== "transform") return;
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-otab-name]");
  if (!el) return;
  el.style.transition = "";
  el.style.transform = "";
}

function onTabDragEnd(): void {
  clearDrag();
}

/** Provide context to OTab / ORouteTab descendants */
const context = computed<TabsContext>(() => ({
  modelValue: props.modelValue,
  onTabClick,
  isVertical: isVertical.value,
  dense: props.dense,
  reorderable: props.reorderable,
  draggingName: draggingName.value,
  dropTargetName: dropTargetName.value,
  dropBefore: dropBefore.value,
}));

provide(TABS_CONTEXT_KEY, context);

// ── Sliding active indicator (horizontal only) ────────────────────────────
// A single underline positioned over the active tab. On selection it animates
// (translateX + width) from the previous tab to the new one. It lives inside
// the scrolling tablist, so its offset-based coordinates stay correct while the
// tabs scroll.
const indicator = reactive({ left: 0, width: 0, visible: false });
// Suppress the transition on first paint so the bar doesn't slide in from the
// left edge on initial mount — only later selections animate.
const indicatorReady = ref(false);

function updateIndicator(): void {
  if (isVertical.value) return;
  const list = tablistRef.value;
  if (!list) return;
  const active = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (!active) {
    indicator.visible = false;
    return;
  }
  indicator.left = active.offsetLeft;
  indicator.width = active.offsetWidth;
  indicator.visible = true;
}

// ── Scroll arrows (horizontal only) ───────────────────────────────────────
const hasOverflow = ref(false);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

function updateScrollState(): void {
  const el = scrollRef.value;
  if (!el) {
    hasOverflow.value = false;
    canScrollLeft.value = false;
    canScrollRight.value = false;
    return;
  }
  // Measure the tabs, not scrollWidth: the sliding underline's transformed
  // bounds extend scrollWidth and would flash the arrows mid-animation.
  let contentWidth = 0;
  const list = tablistRef.value;
  if (list) {
    for (const tab of list.querySelectorAll<HTMLElement>('[role="tab"]')) {
      const right = tab.offsetLeft + tab.offsetWidth;
      if (right > contentWidth) contentWidth = right;
    }
    if (contentWidth > 0) contentWidth += 3; // tablist px-0.75 (3px) right padding
  }
  hasOverflow.value = contentWidth > el.clientWidth + 1;
  canScrollLeft.value = el.scrollLeft > 1;
  canScrollRight.value = el.scrollLeft + el.clientWidth < contentWidth - 1;
  // Tab geometry can shift on resize (wrap/overflow) — keep the bar aligned.
  updateIndicator();
}

function scrollTabs(direction: 1 | -1): void {
  const el = scrollRef.value;
  if (!el) return;
  el.scrollBy({ left: direction * 200, behavior: "smooth" });
}

let ro: ResizeObserver | null = null;
let mo: MutationObserver | null = null;
let scrollStateRaf = 0;

// Re-measure now and on the next frame: mutation callbacks can sample
// mid-update layout, and a wrong hasOverflow would never self-correct.
function updateScrollStateSettled(): void {
  updateScrollState();
  cancelAnimationFrame(scrollStateRaf);
  scrollStateRaf = requestAnimationFrame(() => updateScrollState());
}

onMounted(() => {
  if (isVertical.value) return;
  const el = scrollRef.value;
  if (!el) return;
  el.addEventListener("scroll", updateScrollState, { passive: true });
  ro = new ResizeObserver(updateScrollState);
  ro.observe(el);
  if (tablistRef.value) ro.observe(tablistRef.value);
  // Reorders and add/removes don't resize the stretched tablist, so the
  // ResizeObserver misses them — watch the child list instead.
  if (tablistRef.value) {
    mo = new MutationObserver(() => updateScrollStateSettled());
    mo.observe(tablistRef.value, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-selected"],
    });
  }
  nextTick(() => {
    updateScrollState();
    // Enable the slide animation only after the bar is placed once.
    requestAnimationFrame(() => {
      indicatorReady.value = true;
    });
  });
});

onUnmounted(() => {
  scrollRef.value?.removeEventListener("scroll", updateScrollState);
  ro?.disconnect();
  mo?.disconnect();
  cancelAnimationFrame(scrollStateRaf);
});

// Auto-scroll to reveal the active tab when modelValue changes
watch(
  () => props.modelValue,
  async () => {
    if (isVertical.value) return;
    await nextTick();
    // Slide the shared underline to the newly active tab.
    updateIndicator();
    const el = scrollRef.value;
    if (!el) return;
    const activeTab = el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!activeTab) return;
    const tabRect = activeTab.getBoundingClientRect();
    const containerRect = el.getBoundingClientRect();
    if (tabRect.left < containerRect.left) {
      el.scrollBy({ left: tabRect.left - containerRect.left - 8, behavior: "smooth" });
    } else if (tabRect.right > containerRect.right) {
      el.scrollBy({ left: tabRect.right - containerRect.right + 8, behavior: "smooth" });
    }
  },
);

// ── CSS classes ────────────────────────────────────────────────────────────
const alignClasses: Record<NonNullable<OTabsProps["align"]>, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
  justify: "justify-stretch",
};
</script>

<template>
  <!-- Vertical: TabsRoot wraps the layout; TabsList as-child on the tablist div -->
  <TabsRoot
    v-if="isVertical"
    :model-value="modelValue"
    :orientation="orientation"
    activation-mode="manual"
    as="div"
    @update:model-value="(v) => onTabClick(v as string | number)"
  >
    <TabsList as-child :loop="true">
      <div
        ref="tablistRef"
        :class="[
          'o-tabs relative flex flex-col gap-0.5 p-1',
          alignClasses[align],
          { 'border-card-glass-border border-b border-solid': bordered },
        ]"
        @dragstart="onTabDragStart"
        @dragover="onTabDragOver"
        @drop="onTabDrop"
        @dragend="onTabDragEnd"
        @transitionend="onTabTransitionEnd"
      >
        <slot />
      </div>
    </TabsList>
  </TabsRoot>

  <!-- Horizontal: TabsRoot as-child on the outer flex wrapper; TabsList as-child on the tablist div -->
  <TabsRoot
    v-else
    :model-value="modelValue"
    :orientation="orientation"
    activation-mode="manual"
    as-child
    @update:model-value="(v) => onTabClick(v as string | number)"
  >
    <div
      :class="[
        'flex flex-row items-stretch',
        { 'border-card-glass-border border-b border-solid': bordered },
      ]"
    >
      <!-- Left arrow -->
      <button
        v-show="hasOverflow"
        :disabled="!canScrollLeft"
        type="button"
        aria-hidden="true"
        tabindex="-1"
        class="text-tabs-active-text enabled:hover:text-tabs-indicator flex w-10 shrink-0 cursor-pointer items-center justify-center border-b-2 border-transparent bg-transparent outline-none disabled:cursor-default disabled:opacity-30"
        @click="scrollTabs(-1)"
      >
        <OIcon name="chevron-left" size="md" />
      </button>

      <!-- Scroll container: native wheel/trackpad horizontal scroll with the
           scrollbar hidden — the arrow buttons remain the visible affordance. -->
      <div
        ref="scrollRef"
        class="relative flex-1 overflow-x-auto pt-0.75 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <TabsList as-child :loop="true">
          <div
            ref="tablistRef"
            :class="['o-tabs relative flex flex-row px-0.75', alignClasses[align]]"
            @focusin="handleFocusin"
            @dragstart="onTabDragStart"
            @dragover="onTabDragOver"
            @drop="onTabDrop"
            @dragend="onTabDragEnd"
            @transitionend="onTabTransitionEnd"
          >
            <!-- Single shared underline — slides (translateX + width) to the
                 active tab instead of each tab drawing its own border. -->
            <span
              v-show="indicator.visible"
              aria-hidden="true"
              data-test="otabs-active-indicator"
              class="bg-tabs-indicator pointer-events-none absolute bottom-0 left-0 z-10 h-0.5 rounded-full"
              :class="indicatorReady ? 'transition-[transform,width] duration-300 ease-out' : ''"
              :style="{
                transform: `translateX(${indicator.left}px)`,
                width: `${indicator.width}px`,
              }"
            />
            <slot />
          </div>
        </TabsList>
      </div>

      <!-- Right arrow -->
      <button
        v-show="hasOverflow"
        :disabled="!canScrollRight"
        type="button"
        aria-hidden="true"
        tabindex="-1"
        class="text-tabs-active-text enabled:hover:text-tabs-indicator flex w-10 shrink-0 cursor-pointer items-center justify-center border-b-2 border-transparent bg-transparent outline-none disabled:cursor-default disabled:opacity-30"
        @click="scrollTabs(1)"
      >
        <OIcon name="chevron-right" size="md" />
      </button>
    </div>
  </TabsRoot>
</template>
