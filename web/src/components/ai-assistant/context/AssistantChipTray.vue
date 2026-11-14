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
    :data-collapsed="hidden.length > 0 ? '' : undefined"
    class="flex min-w-0 items-center gap-0.5 self-stretch"
  >
    <div class="flex min-w-0 items-center gap-0.5 self-stretch">
      <slot name="leading" />
      <ul
        v-if="items.length > 0"
        class="flex min-w-0 items-center gap-0.5"
        data-test="assistant-context-tray-list"
      >
        <li v-for="item in items" :key="item.id" class="max-w-40 min-w-0">
          <slot name="chip" :item="item" />
        </li>
      </ul>
    </div>
    <OPopover
      v-if="hidden.length > 0"
      v-model:open="open"
      side="top"
      align="start"
      privacy="mask"
      :aria-label="t('assistant.context.trayLabel')"
      content-class="w-64"
    >
      <template #trigger>
        <OButton
          variant="ghost"
          size="chip"
          :class="['text-text-secondary min-w-6 shrink-0 justify-center', TOUCH_TARGET_CLASS]"
          aria-haspopup="dialog"
          :aria-expanded="open"
          :aria-label="t('assistant.context.moreName', { count: hidden.length }, hidden.length)"
          data-test="assistant-context-more"
        >
          {{ t("assistant.context.more", { count: hidden.length }) }}
        </OButton>
      </template>
      <ul class="flex flex-col gap-0.5 p-1" data-test="assistant-context-more-list">
        <li v-for="item in hidden" :key="item.id" class="min-w-0">
          <slot name="hidden-item" :item="item" />
        </li>
      </ul>
    </OPopover>
  </div>
</template>

<script lang="ts">
import { computed, type ComputedRef, type Ref } from "vue";

/** Chips shown before `+N`: two in any composer, three in a wide one; each truncates to fit. */
export function trayChipLimit(layout: { narrow: boolean; wide: boolean }): number {
  return layout.wide && !layout.narrow ? 3 : 2;
}

/** The chips a tray shows and the rest that fold into `+N`, for a composer of this width. */
export function useChipCollapse<T>(
  all: Ref<T[]> | ComputedRef<T[]>,
  layout: ComputedRef<{ narrow: boolean; wide: boolean }>,
): { shown: ComputedRef<T[]>; hidden: ComputedRef<T[]> } {
  const limit = computed(() => trayChipLimit(layout.value));
  return {
    shown: computed(() => all.value.slice(0, limit.value)),
    hidden: computed(() => all.value.slice(limit.value)),
  };
}
</script>

<script setup lang="ts" generic="T extends { id: string }">
import { ref, watch } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import OButton from "@/lib/core/Button/OButton.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** The chips in view, each with a stable id. */
    items: readonly T[];
    /** The chips behind `+N`, listed in its menu. */
    hidden?: readonly T[];
  }>(),
  { hidden: () => [] },
);

defineSlots<{
  leading?: () => unknown;
  chip?: (scope: { item: T }) => unknown;
  "hidden-item"?: (scope: { item: T }) => unknown;
}>();

const { t } = useI18nTyped();
const open = ref(false);

// Removing the last hidden chip leaves nothing to list.
watch(
  () => props.hidden.length,
  (count) => {
    if (count === 0) open.value = false;
  },
);
</script>
