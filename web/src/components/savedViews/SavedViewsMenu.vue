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
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import SavedViewsMenuRow from "./SavedViewsMenuRow.vue";
import { sortSavedViews } from "./savedViewsSort";
import type { SavedViewRow } from "./savedViews.types";

const props = withDefaults(
  defineProps<{
    views: SavedViewRow[];
    favoriteIds: string[];
    appliedViewId?: string | null;
    loading?: boolean;
    saveReason?: I18nText | null;
    saveNote?: I18nText | null;
    createShortcutId?: string;
    dataTestPrefix: string;
    createTestId?: string;
  }>(),
  {
    appliedViewId: null,
    loading: false,
    saveReason: null,
    saveNote: null,
    createShortcutId: undefined,
    createTestId: undefined,
  },
);

const emit = defineEmits<{
  (e: "apply", view: SavedViewRow): void;
  (e: "update", view: SavedViewRow): void;
  (e: "delete", view: SavedViewRow): void;
  (e: "toggle-favorite", view: SavedViewRow, isFavorite: boolean): void;
  (e: "create"): void;
}>();

const { t } = useI18nTyped();

const root = ref<HTMLElement | null>(null);
const search = ref("");

const isFavorite = (view: SavedViewRow) => props.favoriteIds.includes(view.view_id);

const matching = computed(() => {
  const term = search.value.trim().toLowerCase();
  const sorted = sortSavedViews(props.views, props.favoriteIds);
  if (!term) return sorted;
  return sorted.filter((view) => String(view.view_name).toLowerCase().includes(term));
});

const favorites = computed(() => matching.value.filter(isFavorite));
const others = computed(() => matching.value.filter((view) => !isFavorite(view)));

const focusSearch = () => root.value?.querySelector<HTMLInputElement>("input")?.focus();
const focusFirstRow = () =>
  root.value?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus();

// Keys typed in the search box must not reach the menu, whose typeahead would pull focus onto a row.
const onSearchKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") return;
  event.stopPropagation();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusFirstRow();
  } else if (event.key === "Enter") {
    event.preventDefault();
    root.value?.querySelector<HTMLElement>('[role="menuitem"][data-test*="-apply-"]')?.click();
  }
};

const onToggleFavorite = async (view: SavedViewRow, favorite: boolean) => {
  emit("toggle-favorite", view, favorite);
  await nextTick();
  await nextTick();
  root.value
    ?.querySelector<HTMLElement>(`[data-test="${props.dataTestPrefix}-favorite-${view.view_id}"]`)
    ?.focus();
};

onMounted(() => nextTick(focusSearch));
</script>

<template>
  <div
    ref="root"
    class="flex w-[min(20rem,calc(100vw-2rem))] flex-col"
    :data-test="`${props.dataTestPrefix}-content`"
  >
    <div class="px-1 pt-0.5 pb-0.5" @keydown="onSearchKeydown">
      <OSearchInput
        v-model="search"
        size="sm"
        class="w-full"
        :placeholder="
          props.loading
            ? t('search.savedViewsSearchPlaceholder')
            : t('search.savedViewsSearchCount', { count: props.views.length }, props.views.length)
        "
        :data-test="`${props.dataTestPrefix}-search`"
      />
    </div>
    <div
      v-if="props.loading"
      class="text-text-secondary flex items-center gap-2 px-3 py-1.5 text-sm"
      :data-test="`${props.dataTestPrefix}-loading`"
    >
      <OSpinner size="xs" />
      {{ t("confirmDialog.loading") }}
    </div>
    <div
      v-else-if="matching.length"
      class="max-h-72 overflow-y-auto overscroll-contain"
      :data-test="`${props.dataTestPrefix}-list`"
    >
      <ODropdownGroup
        v-if="favorites.length"
        :label="t('search.savedViewsFavoritesGroup', { count: favorites.length })"
        :data-test="`${props.dataTestPrefix}-favorites-group`"
      >
        <SavedViewsMenuRow
          v-for="view in favorites"
          :key="view.view_id"
          :view="view"
          :favorite="true"
          :applied="view.view_id === props.appliedViewId"
          :update-reason="props.saveReason"
          :data-test-prefix="props.dataTestPrefix"
          @apply="emit('apply', view)"
          @update="emit('update', view)"
          @delete="emit('delete', view)"
          @toggle-favorite="onToggleFavorite(view, true)"
        />
      </ODropdownGroup>
      <ODropdownSeparator v-if="favorites.length && others.length" class="my-0.5!" />
      <ODropdownGroup
        v-if="others.length"
        :label="t('search.savedViewsAllGroup')"
        :data-test="`${props.dataTestPrefix}-all-group`"
      >
        <SavedViewsMenuRow
          v-for="view in others"
          :key="view.view_id"
          :view="view"
          :favorite="false"
          :applied="view.view_id === props.appliedViewId"
          :update-reason="props.saveReason"
          :data-test-prefix="props.dataTestPrefix"
          @apply="emit('apply', view)"
          @update="emit('update', view)"
          @delete="emit('delete', view)"
          @toggle-favorite="onToggleFavorite(view, false)"
        />
      </ODropdownGroup>
    </div>
    <div
      v-else
      class="text-text-secondary px-3 py-1.5 text-sm"
      :data-test="`${props.dataTestPrefix}-empty`"
    >
      {{ props.views.length ? t("search.savedViewsNoMatch") : t("search.savedViewsEmpty") }}
    </div>
    <ODropdownSeparator class="my-0.5!" />
    <ODropdownItem
      class="py-1!"
      :data-test="props.createTestId ?? `${props.dataTestPrefix}-create`"
      :disabled="!!props.saveReason"
      focusable-unavailable
      :description="props.saveReason || props.saveNote"
      :shortcut-id="props.createShortcutId"
      @select="emit('create')"
    >
      <template #icon-left><OIcon name="add" size="sm" /></template>
      {{ t("search.createSavedView") }}
    </ODropdownItem>
  </div>
</template>
