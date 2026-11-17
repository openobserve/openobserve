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

<!-- One row of chips that never wraps: the chips that fit, then "+N" whose tooltip names them all. -->
<template>
  <span
    ref="rowRef"
    class="flex w-full max-w-full min-w-0 flex-nowrap items-center gap-1 overflow-hidden"
    :data-test="dataTest"
  >
    <span
      v-for="(item, index) in items"
      v-show="index < shown"
      :key="index"
      class="flex min-w-0 items-center"
      :class="index === shown - 1 && shown < items.length ? 'shrink overflow-hidden' : 'shrink-0'"
      data-fit-chip
    >
      <slot name="item" :item="item" />
    </span>
    <span
      v-show="shown < items.length"
      ref="moreRef"
      class="shrink-0"
      v-bind="tooltip ? { role: 'img', tabindex: 0, 'aria-label': tooltip } : {}"
      data-test="oncall-fit-chips-more"
    >
      <OTag variant="default-outline" size="sm">{{ raw(`+${items.length - shown}`) }}</OTag>
      <OTooltip v-if="tooltip" side="bottom" :content="tooltip" />
    </span>
  </span>
</template>

<script setup lang="ts" generic="T">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";
import { raw } from "@/types/i18n";

/// `tooltip` may be left out when an ancestor already names every item, so "+N" never stacks a second tooltip.
const props = withDefaults(defineProps<{ items: T[]; tooltip?: I18nText; dataTest?: string }>(), {
  tooltip: undefined,
  dataTest: undefined,
});

defineSlots<{ item(props: { item: T }): unknown }>();

const rowRef = ref<HTMLElement | null>(null);
const moreRef = ref<HTMLElement | null>(null);
const shown = ref(props.items.length);

/// Shows every chip, then keeps as many as fit beside the "+N" chip; measured, because chip widths follow their text.
async function fit() {
  const total = props.items.length;
  shown.value = total;
  await nextTick();
  const row = rowRef.value;
  if (!row || !row.clientWidth || !total) return;
  const start = row.getBoundingClientRect().left;
  const ends = [...row.querySelectorAll<HTMLElement>(":scope > [data-fit-chip]")].map(
    (el) => el.getBoundingClientRect().right - start,
  );
  if ((ends[total - 1] ?? 0) <= row.clientWidth) return;
  shown.value = total - 1;
  await nextTick();
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const more = (moreRef.value?.getBoundingClientRect().width ?? 0) + gap;
  let fits = 0;
  while (fits < total && ends[fits] + more <= row.clientWidth) fits += 1;
  // One chip always shows, so a cell is never just "+N".
  shown.value = Math.max(1, fits);
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  void fit();
  if (typeof ResizeObserver === "undefined" || !rowRef.value) return;
  let width = rowRef.value.clientWidth;
  observer = new ResizeObserver(() => {
    const next = rowRef.value?.clientWidth ?? 0;
    if (next === width) return;
    width = next;
    void fit();
  });
  observer.observe(rowRef.value);
});
onBeforeUnmount(() => observer?.disconnect());
// By content, not identity: callers build the list fresh on every render.
watch(
  () => JSON.stringify(props.items),
  () => void fit(),
);
</script>
