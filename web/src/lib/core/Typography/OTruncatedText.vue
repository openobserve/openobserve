<script lang="ts">
let sharedContext: CanvasRenderingContext2D | null = null;

// One canvas for every instance: each measurement sets its own font first.
function sharedMeasureContext(): CanvasRenderingContext2D | null {
  sharedContext ??= document.createElement("canvas").getContext("2d");
  return sharedContext;
}
</script>

<script setup lang="ts">
import type {
  TruncatedTextLines,
  TruncatedTextProps,
  TruncatedTextSlots,
} from "./OTruncatedText.types";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";
import { ELLIPSIS, middleTruncate } from "./middleTruncate";

const props = withDefaults(defineProps<TruncatedTextProps>(), {
  as: "span",
  lines: 1,
  tooltip: undefined,
  tooltipClass: undefined,
  truncate: "end",
  text: "",
  focusable: true,
  fitParent: false,
});

defineSlots<TruncatedTextSlots>();

// Literal class names: Tailwind only generates classes it can read in the source.
const clampClass: Record<TruncatedTextLines, string> = {
  1: "truncate",
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
  6: "line-clamp-6",
};

const isMiddle = computed(() => props.truncate === "middle");

// No typography of its own: size and colour stay with the call site's classes.
const classes = computed(() => ["min-w-0", clampClass[isMiddle.value ? 1 : props.lines]]);
const tooltipContent = computed(() => (props.tooltip === false ? undefined : props.tooltip));

const rootRef = ref<HTMLElement | null>(null);
const availableWidth = ref(0);
let measureContext: CanvasRenderingContext2D | null = null;

const lines = computed(() => props.text.split(/\r?\n/));
const isMultiLine = computed(() => lines.value.length > 1);
const lineText = computed(() =>
  isMultiLine.value ? `${lines.value[0]}${ELLIPSIS}` : lines.value[0],
);

// Built from the longhands: Firefox leaves the `font` shorthand of a computed style empty.
function fontOf(el: HTMLElement): string {
  const style = getComputedStyle(el);
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

// Until a width is known (or where there is no layout) the line shows whole and CSS ends it with "…".
const shownText = computed(() => {
  const context = measureContext;
  if (!availableWidth.value || !context || !rootRef.value) return lineText.value;
  context.font = fontOf(rootRef.value);
  return middleTruncate(
    lineText.value,
    availableWidth.value,
    (value) => context.measureText(value).width,
  );
});
const isCut = computed(() => shownText.value !== props.text);
const middleTooltip = computed(() => tooltipContent.value ?? raw(props.text));

// clientWidth rounds to whole pixels, so it can call a value that CSS visibly cuts "fitting"; the observer's content box is fractional.
let observedWidth: number | null = null;

function updateWidth() {
  const el = rootRef.value;
  if (!el) return;
  const width = props.fitParent ? parentRoom(el) : (observedWidth ?? roundedContentWidth(el));
  if (width > 0 && !measureContext) measureContext = sharedMeasureContext();
  availableWidth.value = width;
}

function roundedContentWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  // The text lays out inside the padding, so a cut fitted to the padded box would still lose its tail.
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  return Math.max(el.clientWidth - padding, 0);
}

// Sized by its own text, the root would shrink with every cut; the parent's room is stable.
function parentRoom(el: HTMLElement): number {
  const parent = el.parentElement;
  if (!parent) return roundedContentWidth(el);
  const style = getComputedStyle(parent);
  const gap = parseFloat(style.columnGap) || 0;
  const inner =
    parent.clientWidth -
    (parseFloat(style.paddingLeft) || 0) -
    (parseFloat(style.paddingRight) || 0);
  const siblings = [...parent.children].filter(
    (child): child is HTMLElement => child !== el && child instanceof HTMLElement,
  );
  // Layout widths, not rects: a scale-in animation would shrink a rect and leave the cut too short.
  const taken = siblings.reduce((sum, child) => sum + child.offsetWidth + gap, 0);
  const own = getComputedStyle(el);
  const padding = (parseFloat(own.paddingLeft) || 0) + (parseFloat(own.paddingRight) || 0);
  return Math.max(inner - taken - padding, 0);
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  const el = rootRef.value;
  if (!isMiddle.value || !el) return;
  updateWidth();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) observedWidth = entry.contentRect.width;
      updateWidth();
    });
    resizeObserver.observe(props.fitParent && el.parentElement ? el.parentElement : el);
  }
  // A late web font changes the text width without resizing the box.
  if (el.ownerDocument.fonts?.status === "loading") {
    el.ownerDocument.fonts.ready.then(() => {
      availableWidth.value = 0;
      updateWidth();
    });
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <component
    :is="as"
    v-if="isMiddle"
    ref="rootRef"
    :class="classes"
    data-test="o-truncated-text"
    :data-o-tooltip-off="tooltip === false ? '' : undefined"
    :tabindex="isCut && tooltip !== false && focusable ? 0 : undefined"
  >
    <!-- First child on purpose: with no element before it, the tooltip attaches to this root. -->
    <OTooltip
      v-if="tooltip !== false"
      :disabled="!isCut"
      :content="middleTooltip"
      :class="tooltipClass"
    />
    <template v-if="isCut">
      <span aria-hidden="true">{{ shownText }}</span>
      <span class="sr-only">{{ text }}</span>
    </template>
    <template v-else>{{ text }}</template>
  </component>
  <component
    :is="as"
    v-else
    :class="classes"
    data-test="o-truncated-text"
    :data-o-tooltip-off="tooltip === false ? '' : undefined"
  >
    <!-- First child on purpose: with no element before it, the tooltip attaches to this root. -->
    <OTooltip
      v-if="tooltip !== false"
      overflow-only
      :content="tooltipContent"
      :class="tooltipClass"
    />
    <slot />
  </component>
</template>
