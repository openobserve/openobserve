<script setup lang="ts" generic="T extends TemplateSuggestion">
// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, ref, watch } from "vue";
import {
  ListboxItem,
  ListboxRoot,
  PopoverAnchor,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
} from "reka-ui";
import { useVirtualizer } from "@tanstack/vue-virtual";
import useBreakpoint from "@/composables/useBreakpoint";
import { raw, useI18nTyped } from "@/types/i18n";
import type { TemplateSuggestion } from "./OTemplateInput.types";
import type {
  TemplateSuggestListEmits,
  TemplateSuggestListProps,
  TemplateSuggestListSlots,
} from "./OTemplateSuggestList.types";

const props = defineProps<TemplateSuggestListProps<T>>();
const emit = defineEmits<TemplateSuggestListEmits>();
defineSlots<TemplateSuggestListSlots<T>>();

const { t } = useI18nTyped();
const { lgUp } = useBreakpoint();

const scrollEl = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.matches.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => 28,
    overscan: 4,
  })),
);

// reka never scrolls a row this component highlights, so every move scrolls its own.
watch(
  () => props.highlightedIndex,
  (index) => {
    if (!props.open || index < 0 || index >= props.matches.length) return;
    virtualizer.value.scrollToIndex(index, { align: "auto" });
  },
);

function tokenFor(name: string) {
  return raw(`{{${name}}}`);
}

function onUpdateOpen(open: boolean) {
  if (!open) emit("close");
}

// A caret click inside the wrapper is not an outside interaction.
function onInteractOutside(event: Event) {
  if (props.boundary?.contains(event.target as Node)) event.preventDefault();
}

// Prevented, reka skips its own value change and highlight, so the row is never focused.
function onSelect(event: Event, name: string) {
  event.preventDefault();
  emit("select", name);
}
</script>

<template>
  <PopoverRoot :open="open" @update:open="onUpdateOpen">
    <PopoverAnchor :reference="reference ?? undefined" />
    <PopoverPortal>
      <PopoverContent
        align="start"
        :side-offset="4"
        :hide-when-detached="true"
        :disable-outside-pointer-events="false"
        :collision-padding="lgUp ? 0 : 8"
        :data-test="dataTest ? `${dataTest}-suggest` : undefined"
        :class="[
          'z-10001 flex w-56 flex-col overflow-hidden',
          'rounded-default shadow-md',
          'bg-select-content-bg border-select-content-border border',
        ]"
        :style="{ maxHeight: 'min(18rem, var(--reka-popover-content-available-height, 18rem))' }"
        @open-auto-focus.prevent
        @interact-outside="onInteractOutside"
      >
        <ListboxRoot
          role="listbox"
          :aria-label="t('components.templateInput.suggestions')"
          class="flex min-h-0 flex-1 flex-col"
        >
          <div ref="scrollEl" class="max-h-72 overflow-y-auto p-1">
            <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }">
              <!-- Reactive bindings on ListboxItem go stale: reka memoises the item and its Slot lets the memoised props win. -->
              <div
                v-for="row in virtualizer.getVirtualItems()"
                :key="`${row.key}-${matches[row.index].name}`"
                :ref="(node) => virtualizer.measureElement(node as HTMLElement | null)"
                :data-index="row.index"
                :data-active="row.index === highlightedIndex ? '' : undefined"
                :style="{
                  position: 'absolute',
                  top: 0,
                  insetInlineStart: 0,
                  width: '100%',
                  transform: `translateY(${row.start}px)`,
                }"
                class="rounded-default data-active:bg-select-item-hover-bg"
                @mousedown.prevent
                @pointermove="emit('highlight', row.index)"
              >
                <ListboxItem
                  :value="matches[row.index].name"
                  :data-test="
                    dataTest ? `${dataTest}-suggest-item-${matches[row.index].name}` : undefined
                  "
                  class="text-select-item-text flex cursor-pointer items-center gap-2 px-2 py-1 text-start font-mono text-xs outline-none select-none"
                  @select="onSelect($event, matches[row.index].name)"
                >
                  <slot
                    name="suggestion"
                    :suggestion="matches[row.index]"
                    :active="row.index === highlightedIndex"
                    >{{ tokenFor(matches[row.index].name) }}</slot
                  >
                </ListboxItem>
              </div>
            </div>
          </div>
        </ListboxRoot>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
