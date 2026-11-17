<script setup lang="ts">
import {
  TOOLTIP_TRIGGER_ATTR,
  INERT_TRIGGER_ATTR,
  TOOLTIP_TRIGGER_OVERFLOW,
  type TooltipEmits,
  type TooltipProps,
  type TooltipSlots,
} from "./OTooltip.types";
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipArrow,
  injectTooltipProviderContext,
} from "reka-ui";
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  onUnmounted,
  onActivated,
  onDeactivated,
  useAttrs,
  watch,
  useSlots,
  type ComponentPublicInstance,
} from "vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import { isElementTruncated, readElementText } from "./useIsTruncated";
import { hoversNestedTrigger } from "./nestedTrigger";
import { isDisplayContents, tooltipHoverTarget, tooltipNameTarget } from "./triggerName";
import { claimTooltip, releaseTooltip } from "./exclusiveTooltip";
import { LinkedTooltipProvider, countOpenTooltip, sharedTooltipProvider } from "./tooltipProvider";
import { TOOLTIP_DELAY_MS } from "@/lib/styles/motion";

// Both modes render a fragment (provider + portalled content, or the child-mode
// anchor pair), so Vue has no single root to fall attributes onto: anything a
// call site passed — class, style, aria-* — was silently DROPPED with an
// "Extraneous non-props attributes" warning. Take them over explicitly and put
// them on the bubble, which is what a caller styling or labelling a tooltip
// means.
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<TooltipProps>(), {
  side: "top",
  align: "center",
  sideOffset: 4,
  alignOffset: 0,
  arrowClass: "fill-surface-overlay",
  delay: TOOLTIP_DELAY_MS,
  maxWidth: "20rem",
  disabled: false,
  hoverable: false,
  // MUST stay explicitly undefined. Vue casts an absent Boolean prop to `false`,
  // so without this `open` is false rather than undefined — the `open !== undefined`
  // guard below then passes, TooltipRoot receives `open: false`, and reka switches
  // into CONTROLLED mode locked shut. Wrapper mode never emits update:open, so the
  // tooltip could never open: hovering left the trigger at data-state="closed"
  // forever. Child mode was unaffected because it drives `open` itself.
  open: undefined,
  overflowOnly: false,
  exclusive: false,
  anchor: undefined,
});

const emit = defineEmits<TooltipEmits>();

defineSlots<TooltipSlots>();

const slots = useSlots();
// The app root's provider shares one skip-delay window across every tooltip; a tree mounted outside it has none.
const appProvider = sharedTooltipProvider(injectTooltipProviderContext(null));
// A kept-alive page that is away holds every root shut, so none of them keeps the shared skip window open.
const suspended = ref(false);
const hasDefaultSlot = computed(() => !!slots.default);
const isAnchored = computed(() => props.anchor !== undefined);

// Captured when an overflow-only tooltip opens, so the bubble shows exactly the cut text.
const overflowText = ref("");
const contentText = computed(() => props.content ?? overflowText.value);
// A cut element with no text of its own (an icon) would otherwise open an empty bubble.
const hasNothingToShow = () =>
  props.content === undefined && !slots.content && overflowText.value === "";
const triggerMarker = computed(() => (props.overflowOnly ? TOOLTIP_TRIGGER_OVERFLOW : ""));

// ─── Wrapper mode: controlled so a fitting overflow-only trigger never opens, and another exclusive tooltip can close this one ──
const wrapperTriggerRef = ref<ComponentPublicInstance | null>(null);
const wrapperOpen = ref(false);
const wrapperUncontrolledOpen = ref(false);
let resettingHover = false;
// Always controlled, so a deactivated page can shut a root that opened on its own hover.
const wrapperRootOpen = computed<boolean>(() => {
  if (props.disabled || suspended.value) return false;
  if (props.open !== undefined) return props.open;
  if (props.overflowOnly || props.exclusive) return wrapperOpen.value;
  return wrapperUncontrolledOpen.value;
});
const isPlainWrapper = () => props.open === undefined && !props.overflowOnly && !props.exclusive;
function onWrapperOpenChange(next: boolean) {
  // Reka's hover timer still fires for a disabled root, which would leave it open once re-enabled.
  if (suspended.value || resettingHover || (next && props.disabled)) return;
  // A plain tooltip reports only real changes, as Reka's uncontrolled root does.
  if (isPlainWrapper() && next === wrapperUncontrolledOpen.value) return;
  wrapperUncontrolledOpen.value = next;
  emit("update:open", next);
  if (isPlainWrapper() || props.open !== undefined) return;
  if (!next) {
    wrapperOpen.value = false;
    return;
  }
  if (props.overflowOnly) {
    const el = wrapperTriggerRef.value?.$el as Element | undefined;
    if (!el || !isElementTruncated(el)) return;
    overflowText.value = readElementText(el);
    if (hasNothingToShow()) return;
  }
  wrapperOpen.value = true;
}

const attrs = useAttrs();

// `data-test` stays owned by the component: e2e selects the bubble by
// `o-tooltip-content` in many places, so a call-site value must not replace it.
// Everything else (class, style, aria-*, id) is forwarded to the content.
const forwardedAttrs = computed(() => {
  const { "data-test": _componentOwned, ...rest } = attrs;
  return rest;
});

// ─── Child mode (placed inside a parent element as its tooltip) ───────────────
// When no default slot is provided, OTooltip attaches to its parent: it finds
// its parent element via a hidden DOM anchor span and attaches hover listeners to it.
const childAnchorRef = ref<HTMLSpanElement | null>(null);
const parentEl = ref<Element | null>(null);
const childOpen = ref(false);
// Lazy-mount guard: the reka tooltip tree (Provider/Root/Portal/Content — ~6
// components + floating-ui setup) is NOT rendered until the parent is first
// hovered. This is the whole perf story for long/virtualized tables: a row that
// is only scrolled past, never hovered, pays nothing for its tooltips. Once a
// tooltip has been opened we keep it mounted so repeat hovers are instant.
const childActivated = ref(false);
let cleanupFn: (() => void) | null = null;
// Pending open timer for the hover delay (child mode). Wrapper mode gets its
// delay for free from reka's `delay-duration`; child mode wires its own hover
// listeners, so it has to honour `props.delay` here too.
let childShowTimer: ReturnType<typeof setTimeout> | null = null;
// Grace-period close timer used only when `hoverable` is set. On leaving the
// trigger we wait briefly before closing so the pointer can travel onto the
// bubble; entering the bubble cancels this timer and keeps the tooltip open.
let childHideTimer: ReturnType<typeof setTimeout> | null = null;
// The portalled bubble sits outside the trigger, so moving within it is not moving away.
let pointerInBubble = false;
const HOVERABLE_GRACE_MS = 120;
let labelledEl: Element | null = null;

// An icon-only control has no other name, so the tooltip text becomes it and follows the text.
function syncTriggerName() {
  const text = props.content && !props.overflowOnly ? String(props.content) : "";
  if (labelledEl) {
    if (text) labelledEl.setAttribute("aria-label", text);
    else {
      labelledEl.removeAttribute("aria-label");
      labelledEl = null;
    }
    return;
  }
  const target = text && parentEl.value ? tooltipNameTarget(parentEl.value) : null;
  if (target) {
    target.setAttribute("aria-label", text);
    labelledEl = target;
  }
}
watch(() => props.content, syncTriggerName);

// Called from the content bubble's hover handlers (child mode). Entering the
// bubble cancels a pending close; leaving it closes the tooltip.
const onContentEnter = () => {
  if (!props.hoverable) return;
  pointerInBubble = true;
  if (childHideTimer) {
    clearTimeout(childHideTimer);
    childHideTimer = null;
  }
};
const onContentLeave = () => {
  if (!props.hoverable) return;
  pointerInBubble = false;
  childOpen.value = false;
};

const childRootOpen = computed(() => {
  if (props.disabled || suspended.value) return false;
  return isAnchored.value ? !!props.open && !!props.anchor : childOpen.value;
});
const rootOpen = computed<boolean>(() =>
  hasDefaultSlot.value ? wrapperRootOpen.value : childRootOpen.value,
);
let countedOpen = false;
// Reka reports to its own provider only on a change, missing a root that mounts open, so the shared window is driven from here.
watch(
  rootOpen,
  (open) => {
    if (!appProvider || open === countedOpen) return;
    countedOpen = open;
    countOpenTooltip(appProvider, open ? 1 : -1);
  },
  { immediate: true },
);
// Reka reports nothing when an open root unmounts, which would leave the skip window open for good.
function releaseProviderOpen() {
  if (!appProvider || !countedOpen) return;
  countedOpen = false;
  countOpenTooltip(appProvider, -1);
}
function onChildOpenChange(next: boolean) {
  if (suspended.value) return;
  if (isAnchored.value) emit("update:open", next);
  else childOpen.value = next;
}

function isInertTrigger(): boolean {
  return !!parentEl.value?.hasAttribute(INERT_TRIGGER_ATTR);
}

// Reka dismisses on any outside pointerdown, which would close the tooltip the click on its own trigger opens.
function onChildPointerDownOutside(event: Event) {
  const target = event.target as Node | null;
  if (isInertTrigger() && target && parentEl.value?.contains(target)) event.preventDefault();
}

onMounted(() => {
  if (!hasDefaultSlot.value && !isAnchored.value && childAnchorRef.value) {
    // Prefer the nearest previous visible sibling — the actual trigger element (e.g. the
    // ToggleGroupItem button). Walking up instead when the parent is display:contents would
    // land on the group container, causing all items in the group to share one hover target.
    let sibling: Element | null = childAnchorRef.value.previousElementSibling;
    while (sibling && (sibling as HTMLElement).style.display === "none") {
      sibling = sibling.previousElementSibling;
    }

    let candidate: Element | null = sibling;
    if (!candidate) {
      // Fallback: walk up past display:contents ancestors — they have no layout box
      // and getBoundingClientRect() returns all-zeros, sending the tooltip to (0,0).
      candidate = childAnchorRef.value.parentElement;
      while (candidate && isDisplayContents(candidate)) {
        candidate = candidate.parentElement;
      }
    }
    // An overflow-only tooltip measures its own text element, so it never widens to the control.
    if (candidate && !props.overflowOnly) candidate = tooltipHoverTarget(candidate);
    parentEl.value = candidate;
    if (parentEl.value) {
      parentEl.value.setAttribute(TOOLTIP_TRIGGER_ATTR, triggerMarker.value);
      syncTriggerName();
      // Open after `props.delay` ms of hover (matching wrapper mode); leaving
      // before then cancels the pending open so a quick pass-over shows nothing.
      // Mount the reka tree (if not already) and open it. Deferring the mount to
      // here — the first hover, after the delay — is what keeps un-hovered rows
      // cheap.
      const activateAndOpen = () => {
        childShowTimer = null;
        // Only the innermost tooltip that will actually open wins.
        if (hoversNestedTrigger(parentEl.value)) return;
        if (props.overflowOnly) {
          // Measured now, not at mount: width and text may have changed since.
          if (!parentEl.value || !isElementTruncated(parentEl.value)) return;
          overflowText.value = readElementText(parentEl.value);
          if (hasNothingToShow()) return;
        }
        childActivated.value = true;
        childOpen.value = true;
      };
      const show = () => {
        if (props.disabled) return;
        if (childShowTimer) clearTimeout(childShowTimer);
        // A return inside the hoverable grace window would otherwise be closed by the pending hide.
        if (childHideTimer) {
          clearTimeout(childHideTimer);
          childHideTimer = null;
        }
        const insideSkipWindow = appProvider ? !appProvider.isOpenDelayed.value : false;
        if (props.delay > 0 && !insideSkipWindow) {
          childShowTimer = setTimeout(activateAndOpen, props.delay);
        } else {
          activateAndOpen();
        }
      };
      const hide = () => {
        if (childShowTimer) {
          clearTimeout(childShowTimer);
          childShowTimer = null;
        }
        if (props.hoverable) {
          // Delay the close so the pointer can reach the bubble; onContentEnter
          // cancels this timer if it lands there in time.
          if (childHideTimer) clearTimeout(childHideTimer);
          childHideTimer = setTimeout(() => {
            childOpen.value = false;
            childHideTimer = null;
          }, HOVERABLE_GRACE_MS);
        } else {
          childOpen.value = false;
        }
      };
      // A trigger with no action of its own opens on click too, so touch and click users can read it.
      const openOnClick = () => {
        if (props.disabled || props.overflowOnly || !isInertTrigger()) return;
        if (childShowTimer) {
          clearTimeout(childShowTimer);
          childShowTimer = null;
        }
        childActivated.value = true;
        childOpen.value = true;
      };
      // Chrome drops mouseleave when the hovered child is re-rendered, so the first move off the trigger also ends the hover.
      const hideOnMoveAway = (e: MouseEvent) => {
        if (pointerInBubble || parentEl.value?.contains(e.target as Node)) return;
        document.removeEventListener("mousemove", hideOnMoveAway);
        hide();
      };
      const enter = () => {
        pointerInBubble = false;
        document.addEventListener("mousemove", hideOnMoveAway, { passive: true });
        show();
      };
      const leave = () => {
        document.removeEventListener("mousemove", hideOnMoveAway);
        hide();
      };
      parentEl.value.addEventListener("click", openOnClick);
      parentEl.value.addEventListener("mouseenter", enter);
      parentEl.value.addEventListener("mouseleave", leave);
      // Keyboard-focus parity with hover, so a Tab-reachable trigger (e.g. an
      // inert locked tile) can surface its tooltip without a pointer.
      parentEl.value.addEventListener("focus", show);
      parentEl.value.addEventListener("blur", hide);
      cleanupFn = () => {
        parentEl.value?.removeEventListener("click", openOnClick);
        parentEl.value?.removeEventListener("mouseenter", enter);
        parentEl.value?.removeEventListener("mouseleave", leave);
        document.removeEventListener("mousemove", hideOnMoveAway);
        parentEl.value?.removeEventListener("focus", show);
        parentEl.value?.removeEventListener("blur", hide);
        parentEl.value?.removeAttribute(TOOLTIP_TRIGGER_ATTR);
        labelledEl?.removeAttribute("aria-label");
      };
    }
  }
});

// Exclusive tooltips show one at a time; a caller-controlled one (`open`) is left to its caller.
const closeSelf = () => {
  wrapperOpen.value = false;
  childOpen.value = false;
};
watch(
  () => props.exclusive && (wrapperOpen.value || childOpen.value),
  (open) => (open ? claimTooltip(closeSelf) : releaseTooltip(closeSelf)),
);

function cancelChildTimers() {
  if (childShowTimer) {
    clearTimeout(childShowTimer);
    childShowTimer = null;
  }
  if (childHideTimer) {
    clearTimeout(childHideTimer);
    childHideTimer = null;
  }
}

function dropOpenState() {
  cancelChildTimers();
  childOpen.value = false;
  wrapperOpen.value = false;
  wrapperUncontrolledOpen.value = false;
}

// A hover delay that runs out while disabled must not open the tooltip once it is re-enabled.
watch(
  () => props.disabled,
  (disabled) => {
    if (!disabled || !childShowTimer) return;
    clearTimeout(childShowTimer);
    childShowTimer = null;
  },
);
// Reka re-attaches the trigger's listeners only after this render, still latched by a hover that left while disabled.
watch(
  () => props.disabled,
  (disabled) => {
    if (!disabled && !wrapperRootOpen.value) resetHoverLatch();
  },
  { flush: "post" },
);
// Reka drops a disabled trigger's listeners, so only this sees the hover end that must keep it shut on re-enable.
function onWrapperTriggerLeave() {
  if (!props.disabled) return;
  wrapperOpen.value = false;
  wrapperUncontrolledOpen.value = false;
}

let bubbleMounted = false;
let hoverResetPending = false;
// Reka's trigger latches its first pointermove until a pointerleave, which a detached trigger never gets.
function resetWrapperTriggerHover() {
  hoverResetPending = false;
  const node = wrapperTriggerRef.value?.$el as Node | undefined;
  const trigger = node instanceof CharacterData ? node.nextElementSibling : node;
  resettingHover = true;
  trigger?.dispatchEvent(new Event("pointerleave"));
  resettingHover = false;
}
function resetHoverLatch() {
  // A mounted hoverable bubble turns the trigger's pointerleave into a grace area, so the reset waits for it to go.
  if (bubbleMounted && props.hoverable) hoverResetPending = true;
  else resetWrapperTriggerHover();
}
function onBubbleMounted() {
  bubbleMounted = true;
}
function onBubbleUnmounted() {
  bubbleMounted = false;
  if (hoverResetPending) resetWrapperTriggerHover();
}

onBeforeUnmount(() => {
  hoverResetPending = false;
});
onUnmounted(() => {
  releaseTooltip(closeSelf);
  cancelChildTimers();
  cleanupFn?.();
  releaseProviderOpen();
});

// A kept-alive page deactivates WITHOUT unmounting, and a detached trigger
// never fires `mouseleave` — so a tooltip open at the moment of a tab switch
// stayed open forever: its portalled bubble lives in <body>, its anchor's rect
// collapses to all-zeros, and floating-ui parks the orphan at the viewport's
// top-left next to the new page's own, correct copy of the same tooltip.
onDeactivated(() => {
  dropOpenState();
  suspended.value = true;
  resetHoverLatch();
});
onActivated(() => {
  suspended.value = false;
});

const effectiveSideOffset = computed(() => props.sideOffset);

const contentStyle = computed(() => ({ maxWidth: props.maxWidth }));

const contentClasses = computed(() => [
  "z-10100 px-2.5 py-1.5",
  "bg-surface-overlay rounded-default border border-tooltip-border shadow-md",
  "text-xs text-text-body font-medium leading-snug",
  // Force long unbreakable tokens (file paths, hashes, URLs) to wrap inside the
  // max-width box instead of overflowing onto the content behind the tooltip.
  // overflow-wrap is inherited, so nested content (e.g. pre-wrap divs) wraps too.
  "break-words",
  "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
  "data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
  "data-[side=top]:slide-in-from-bottom-1",
  "data-[side=bottom]:slide-in-from-top-1",
  "data-[side=left]:slide-in-from-right-1",
  "data-[side=right]:slide-in-from-left-1",
  // Hoverable tooltips let the pointer land on the bubble and select its text.
  props.hoverable ? "pointer-events-auto select-text cursor-text" : "",
  props.contentClass,
]);
</script>

<template>
  <!-- ΓöÇΓöÇ Wrapper mode: default slot provides the trigger ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ -->
  <LinkedTooltipProvider v-if="hasDefaultSlot" :shared="appProvider">
    <TooltipRoot
      :delay-duration="delay"
      :disable-hoverable-content="!hoverable"
      :open="wrapperRootOpen"
      :disabled="disabled"
      @update:open="onWrapperOpenChange"
    >
      <TooltipTrigger
        ref="wrapperTriggerRef"
        as-child
        :data-o-tooltip-trigger="triggerMarker"
        @pointerleave="onWrapperTriggerLeave"
      >
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          v-bind="forwardedAttrs"
          data-test="o-tooltip-content"
          :side="side"
          :align="align"
          :side-offset="effectiveSideOffset"
          :align-offset="alignOffset"
          :style="contentStyle"
          :class="contentClasses"
        >
          <span
            :class="shortcut || shortcutId ? 'inline-flex items-center gap-1.5' : ''"
            @vue:mounted="onBubbleMounted"
            @vue:unmounted="onBubbleUnmounted"
          >
            <slot name="content">{{ contentText }}</slot>
            <OShortcut v-if="shortcut || shortcutId" :keys="shortcut" :id="shortcutId" />
          </span>
          <TooltipArrow :width="10" :height="5" :class="arrowClass" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </LinkedTooltipProvider>

  <!-- ── Child mode: no default slot, attaches to parent element as its tooltip.
       The reka tree is mounted lazily (v-if) on first hover — see childActivated
       — so un-hovered rows in a long/virtualized table cost next to nothing. -->
  <template v-else>
    <LinkedTooltipProvider v-if="childActivated || isAnchored" :shared="appProvider">
      <TooltipRoot :delay-duration="0" :open="childRootOpen" @update:open="onChildOpenChange">
        <!-- Hidden trigger span; reference overrides positioning anchor to parentEl -->
        <!-- NOTE: `style="display:none"` here is a FUNCTIONAL CONTRACT, not
             decoration — do NOT convert it to `class="hidden"`. The anchor
             resolution in onMounted() skips hidden siblings by testing
             `.style.display === "none"`, which only sees an INLINE style. With a
             class, that loop stops on this span and anchors every child-mode
             tooltip to a zero-size hidden element, so it never opens on hover. -->
        <TooltipTrigger
          as="span"
          :reference="(isAnchored ? anchor : parentEl) ?? undefined"
          style="display: none"
          aria-hidden="true"
        />
        <TooltipPortal>
          <TooltipContent
            v-bind="forwardedAttrs"
            data-test="o-tooltip-content"
            :side="side"
            :align="align"
            :side-offset="effectiveSideOffset"
            :align-offset="alignOffset"
            :style="contentStyle"
            :class="contentClasses"
            @pointer-down-outside="onChildPointerDownOutside"
            @mouseenter="onContentEnter"
            @mouseleave="onContentLeave"
          >
            <span :class="shortcut || shortcutId ? 'inline-flex items-center gap-1.5' : ''">
              <slot name="content">{{ contentText }}</slot>
              <OShortcut v-if="shortcut || shortcutId" :keys="shortcut" :id="shortcutId" />
            </span>
            <TooltipArrow :width="10" :height="5" :class="arrowClass" />
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </LinkedTooltipProvider>
    <!-- Anchor placeholder: inserted at the real DOM position to resolve parentElement.
         `style="display:none"` is required, not decorative — see the note above. -->
    <span ref="childAnchorRef" style="display: none" aria-hidden="true" />
  </template>
</template>
