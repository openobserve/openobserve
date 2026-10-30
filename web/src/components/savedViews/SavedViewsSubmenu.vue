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
import { computed, ref, useSlots } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdownSub from "@/lib/overlay/Dropdown/ODropdownSub.vue";
import SavedViewsMenu from "./SavedViewsMenu.vue";
import type { SavedViewRow } from "./savedViews.types";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  views: SavedViewRow[];
  favoriteIds: string[];
  loading?: boolean;
  dataTestPrefix: string;
  triggerTestId: string;
}>();

const emit = defineEmits<{ (e: "open"): void }>();

const { t } = useI18nTyped();
const slots = useSlots();

const root = ref<HTMLElement | null>(null);
const actions = ref<HTMLElement | null>(null);

// The pin sits beside the trigger (a <button>) so no button nests in another; arrows hop between them.
const onRootKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement;
  if (actions.value?.contains(target)) {
    event.stopPropagation();
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    root.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  } else if (
    event.key === "ArrowLeft" &&
    slots.actions &&
    target.getAttribute("role") === "menuitem"
  ) {
    event.preventDefault();
    event.stopPropagation();
    actions.value?.querySelector<HTMLElement>("button")?.focus();
  }
};

const favoriteCount = computed(
  () => props.views.filter((view) => props.favoriteIds.includes(view.view_id)).length,
);

const summary = computed(() => {
  if (props.loading && !props.views.length) return raw("");
  if (!props.views.length) return t("search.savedViewsEmpty");
  const views = t(
    "search.savedViewsSummaryViews",
    { count: props.views.length },
    props.views.length,
  );
  if (!favoriteCount.value) return views;
  const favorites = t(
    "search.savedViewsSummaryFavorites",
    { count: favoriteCount.value },
    favoriteCount.value,
  );
  return t("search.savedViewsSummary", { views, favorites });
});
</script>

<template>
  <div ref="root" class="relative" @keydown="onRootKeydown">
    <ODropdownSub
      :data-test="props.triggerTestId"
      :text-value="t('search.savedViewsRowLabel')"
      :description="summary"
      @update:open="(open: boolean) => open && emit('open')"
    >
      <template #icon-left>
        <span
          class="rounded-default bg-section-header-bg text-text-secondary inline-flex h-7 w-7 shrink-0 items-center justify-center"
        >
          <OIcon name="saved-search" size="sm" />
        </span>
      </template>
      <template #trigger>{{ t("search.savedViewsRowLabel") }}</template>
      <template #icon-right>
        <span class="ms-auto flex items-center gap-1">
          <span v-if="slots.actions" class="w-7 shrink-0" aria-hidden="true" />
          <OIcon name="chevron-right" size="sm" />
        </span>
      </template>
      <SavedViewsMenu
        v-bind="$attrs"
        :views="props.views"
        :favorite-ids="props.favoriteIds"
        :loading="props.loading"
        :data-test-prefix="props.dataTestPrefix"
      />
    </ODropdownSub>
    <span
      v-if="slots.actions"
      ref="actions"
      class="absolute end-9 top-1/2 flex -translate-y-1/2 items-center"
    >
      <slot name="actions" />
    </span>
  </div>
</template>
