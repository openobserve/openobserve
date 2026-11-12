<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    role="group"
    :aria-label="t('assistant.context.trayLabel')"
    data-test="assistant-context-tray"
    data-dd-privacy="mask"
    :data-collapsed="hiddenCount > 0 ? '' : undefined"
    class="flex min-w-0 items-center gap-0.5 self-stretch"
  >
    <!-- Expanded chips scroll rather than shrink, and Fewer stays outside the scroll so it is always in view. -->
    <div
      ref="scroller"
      :class="[
        'flex min-w-0 items-center gap-0.5 self-stretch',
        expanded ? 'scroll-px-6 [scrollbar-width:none] overflow-x-auto' : '',
      ]"
      :style="scrollerMask"
      :data-fade-start="fade.start ? '' : undefined"
      :data-fade-end="fade.end ? '' : undefined"
      data-test="assistant-context-tray-scroller"
      @scroll="syncFade"
      @wheel="onWheel"
      @focusin="revealFocused"
    >
      <slot name="leading" />
      <ul
        v-if="items.length > 0"
        :class="['flex items-center gap-0.5', expanded ? 'shrink-0' : 'min-w-0']"
        data-test="assistant-context-tray-list"
      >
        <li
          v-for="item in items"
          :key="item.id"
          :class="['max-w-40', expanded ? 'shrink-0' : 'min-w-0']"
        >
          <slot name="chip" :item="item" />
        </li>
      </ul>
    </div>
    <OTooltip v-if="hiddenLabels && hiddenCount > 0">
      <OButton
        variant="ghost"
        size="chip"
        :class="['text-text-secondary min-w-6 shrink-0 justify-center', TOUCH_TARGET_CLASS]"
        :aria-label="t('assistant.context.moreName', { count: hiddenCount }, hiddenCount)"
        data-test="assistant-context-more"
      >
        {{ t("assistant.context.more", { count: hiddenCount }) }}
      </OButton>
      <template #content>
        <ul class="flex flex-col gap-0.5" data-test="assistant-context-more-list">
          <li v-for="label in hiddenLabels" :key="label">{{ label }}</li>
        </ul>
      </template>
    </OTooltip>
    <OButton
      v-else-if="hiddenCount > 0 || expanded"
      variant="ghost"
      size="chip"
      :class="['text-text-secondary min-w-6 shrink-0 justify-center', TOUCH_TARGET_CLASS]"
      :aria-expanded="expanded"
      :aria-label="
        expanded
          ? t('assistant.context.fewerName')
          : t('assistant.context.moreName', { count: hiddenCount }, hiddenCount)
      "
      data-test="assistant-context-more"
      @click="emit('update:expanded', !expanded)"
    >
      {{
        expanded
          ? t("assistant.context.fewer")
          : t("assistant.context.more", { count: hiddenCount })
      }}
    </OButton>
  </div>
</template>

<script lang="ts">
import { computed, type ComputedRef, type Ref } from "vue";

/** Chips shown before `+N`; the composer's width decides which. */
export function trayChipLimit(layout: { narrow: boolean; wide: boolean }): number {
  if (layout.narrow) return 0;
  return layout.wide ? 3 : 1;
}

/** The chips a tray shows and how many fold into `+N`, for a composer of this width. */
export function useChipCollapse<T>(
  all: Ref<T[]> | ComputedRef<T[]>,
  layout: ComputedRef<{ narrow: boolean; wide: boolean }>,
  expanded: Ref<boolean>,
): { shown: ComputedRef<T[]>; hiddenCount: ComputedRef<number> } {
  const shown = computed(() =>
    expanded.value ? all.value : all.value.slice(0, trayChipLimit(layout.value)),
  );
  return { shown, hiddenCount: computed(() => all.value.length - shown.value.length) };
}
</script>

<script setup lang="ts" generic="T extends { id: string }">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";

import { edgeFadeOf, edgeMask, wheelToScroll, type EdgeFade } from "./trayScroll";

const props = defineProps<{
  /** The chips in view, each with a stable id. */
  items: readonly T[];
  expanded: boolean;
  hiddenCount: number;
  /** When set, `+N` only names the hidden chips in a tooltip instead of expanding the row. */
  hiddenLabels?: readonly string[];
}>();

const emit = defineEmits<{ "update:expanded": [expanded: boolean] }>();

defineSlots<{
  leading?: () => unknown;
  chip?: (scope: { item: T }) => unknown;
}>();

const { t } = useI18nTyped();

const scroller = ref<HTMLElement | null>(null);
const fade = ref<EdgeFade>({ start: false, end: false });
const scrollerMask = computed(() => {
  const mask = edgeMask(fade.value);
  return mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined;
});
let resizeObserver: ResizeObserver | null = null;

watch(
  [() => props.expanded, () => props.items.length],
  async () => {
    await nextTick();
    syncFade();
  },
  { flush: "post" },
);
onMounted(() => {
  if (typeof ResizeObserver === "undefined" || !scroller.value) return;
  resizeObserver = new ResizeObserver(() => syncFade());
  resizeObserver.observe(scroller.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

function syncFade(): void {
  const el = scroller.value;
  fade.value = props.expanded && el ? edgeFadeOf(el) : { start: false, end: false };
}

// The row hides its scrollbar, so an ordinary vertical wheel has to reach chips past the edge.
function onWheel(event: WheelEvent): void {
  const el = scroller.value;
  if (!props.expanded || !el) return;
  const delta = wheelToScroll(event, el);
  if (!delta) return;
  event.preventDefault();
  el.scrollLeft += delta;
  syncFade();
}

function revealFocused(event: FocusEvent): void {
  if (!props.expanded || !(event.target instanceof HTMLElement)) return;
  event.target.closest("li")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}
</script>
