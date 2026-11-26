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

<!-- Same cards as the pipeline destination type step (CreateDestinationForm), plus a one-line description. -->
<template>
  <div
    class="grid grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))] gap-3"
    role="radiogroup"
    aria-required="true"
    :aria-label="label"
    data-test="ai-toolset-type-tiles"
  >
    <div
      v-for="(tile, index) in tiles"
      :key="tile.id"
      :data-test="`ai-toolsets-add-${tile.id}`"
      :data-type="tile.id"
      role="radio"
      :aria-checked="modelValue === tile.id"
      :aria-describedby="`${uid}-${tile.id}`"
      :tabindex="index === tabStop ? 0 : -1"
      class="focus-visible:ring-focus-ring-accent destination-type-card group rounded-default hover:border-card-glass-border hover:shadow-status-info-text/15 relative flex min-h-30 min-w-0 cursor-pointer flex-col items-center justify-center overflow-hidden border-2 px-3 py-5 outline-none [transition:all_0.3s_ease] hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2"
      :class="
        modelValue === tile.id
          ? 'selected border-card-glass-border bg-status-info-bg shadow-status-info-text/20 shadow-lg'
          : 'border-border-default bg-surface-base'
      "
      @click="emit('update:modelValue', tile.id)"
      @keydown="onKeydown($event, index)"
    >
      <OTooltip :content="tile.tip" />
      <span :id="`${uid}-${tile.id}`" class="sr-only">{{ tile.tip }}</span>
      <img
        v-if="tile.image"
        :src="tile.image"
        alt=""
        class="mb-2 h-12 w-12 object-contain [transition:all_0.3s_ease]"
      />
      <OIcon
        v-else-if="tile.icon"
        :name="tile.icon"
        size="lg"
        class="card-icon text-icon-color group-[.selected]:text-card-glass-border mb-2 [transition:color_0.3s_ease]"
      />
      <div
        class="card-label text-compact text-text-body group-[.selected]:text-text-body mt-1 w-full min-w-0 text-center leading-[1.3] font-medium"
      >
        {{ tile.name }}
      </div>
      <!-- One line inside the card; the card's tooltip carries the full text. -->
      <OTruncatedText
        as="div"
        :tooltip="false"
        data-test="ai-toolset-type-short"
        class="text-2xs text-text-secondary mt-1 block w-full overflow-hidden text-center"
      >
        {{ tile.short }}
      </OTruncatedText>
      <div
        v-if="modelValue === tile.id"
        class="bg-status-positive text-text-inverse absolute top-1.5 right-1.5 z-1 flex h-5 w-5 items-center justify-center overflow-hidden rounded-full"
      >
        <OIcon name="check" size="xs" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import type { I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

export interface ToolsetTypeTile {
  /** A preset id, `custom-mcp` or `skill`. */
  id: string;
  name: I18nText;
  short: I18nText;
  /** Full description, shown in the card's tooltip. */
  tip: I18nText;
  image?: string;
  icon?: IconName;
}

const props = defineProps<{
  tiles: ToolsetTypeTile[];
  modelValue: string | null;
  label: I18nText;
}>();

const emit = defineEmits<{
  "update:modelValue": [id: string];
}>();

const uid = useId();

// One tab stop for the group: the chosen card, or the first while none is chosen.
const tabStop = computed(() =>
  Math.max(
    0,
    props.tiles.findIndex((tile) => tile.id === props.modelValue),
  ),
);

// Arrows only move focus; Space or Enter chooses, as on the destination type step.
const onKeydown = (event: KeyboardEvent, index: number) => {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    emit("update:modelValue", props.tiles[index].id);
    return;
  }
  const moves: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  const cards = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>(
    '[role="radio"]',
  );
  cards?.[(index + move + props.tiles.length) % props.tiles.length]?.focus();
};
</script>
