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

<script setup lang="ts">
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { horizontalStep } from "./savedViewsKeys";
import type { SavedViewRow } from "./savedViews.types";

const props = defineProps<{
  view: SavedViewRow;
  favorite: boolean;
  applied: boolean;
  dataTestPrefix: string;
  updateReason?: I18nText | null;
}>();

const emit = defineEmits<{
  (e: "apply"): void;
  (e: "update"): void;
  (e: "delete"): void;
  (e: "toggle-favorite"): void;
}>();

const { t } = useI18nTyped();

const viewId = props.view.view_id;

// Arrow keys walk the row's inline actions, so star, edit and delete stay reachable without a mouse.
const onRowKeydown = (event: KeyboardEvent) => {
  const step = horizontalStep(event.key);
  if (!step) return;
  const row = event.currentTarget as HTMLElement;
  const buttons = Array.from(row.querySelectorAll<HTMLElement>("button:not([disabled])"));
  const index = buttons.indexOf(document.activeElement as HTMLElement);
  if (step === "back" && index < 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (step === "back" && index === 0) row.focus();
  else buttons[index + (step === "forward" ? 1 : -1)]?.focus();
};
</script>

<template>
  <ODropdownItem
    :text-value="props.view.view_name"
    :aria-current="props.applied ? 'true' : undefined"
    :class="['py-0.5!', props.applied ? 'bg-select-item-selected-bg' : '']"
    :data-test="`${props.dataTestPrefix}-apply-${viewId}`"
    @select="emit('apply')"
    @keydown="onRowKeydown"
  >
    <template #icon-left>
      <OIcon name="saved-search" size="sm" class="text-text-secondary" />
    </template>
    <OTruncatedText class="min-w-0 flex-1">{{ props.view.view_name }}</OTruncatedText>
    <template #icon-right>
      <span class="ms-auto flex shrink-0 items-center gap-0.5">
        <OIcon
          v-if="props.applied"
          name="check"
          size="md"
          class="text-accent"
          role="img"
          :aria-label="t('search.savedViewApplied')"
          :data-test="`${props.dataTestPrefix}-applied-${viewId}`"
        />
        <OButton
          variant="ghost-neutral"
          size="icon-xs-sq"
          :aria-pressed="props.favorite"
          :aria-label="t('search.favoriteViewNamed', { name: raw(props.view.view_name) })"
          :data-test="`${props.dataTestPrefix}-favorite-${viewId}`"
          @click.stop.prevent="emit('toggle-favorite')"
          @keydown.enter.stop.prevent="emit('toggle-favorite')"
          @keydown.space.stop
        >
          <OIcon
            :name="props.favorite ? 'star' : 'star-outline'"
            size="sm"
            :class="props.favorite ? 'text-favorite' : ''"
          />
          <OTooltip :content="t('search.favoriteViewNamed', { name: raw(props.view.view_name) })" />
        </OButton>
        <OButton
          variant="ghost-neutral"
          size="icon-xs-sq"
          icon-left="edit"
          :aria-label="t('search.overwriteSavedViewNamed', { name: raw(props.view.view_name) })"
          :disabled="!!props.updateReason"
          focusable-unavailable
          :data-test="`${props.dataTestPrefix}-update-${viewId}`"
          @click.stop.prevent="emit('update')"
          @keydown.enter.stop.prevent="emit('update')"
          @keydown.space.stop
        >
          <OTooltip
            :content="t('search.overwriteSavedViewNamed', { name: raw(props.view.view_name) })"
          />
          <template #unavailable-reason>{{ props.updateReason }}</template>
        </OButton>
        <OButton
          variant="ghost-neutral"
          size="icon-xs-sq"
          icon-left="delete"
          :aria-label="t('search.deleteViewNamed', { name: raw(props.view.view_name) })"
          :data-test="`${props.dataTestPrefix}-delete-${viewId}`"
          @click.stop.prevent="emit('delete')"
          @keydown.enter.stop.prevent="emit('delete')"
          @keydown.space.stop
        >
          <OTooltip :content="t('search.deleteViewNamed', { name: raw(props.view.view_name) })" />
        </OButton>
      </span>
    </template>
  </ODropdownItem>
</template>
