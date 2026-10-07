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
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

interface TracesSavedView {
  view_id: string;
  view_name: string;
}

const props = withDefaults(
  defineProps<{
    views: TracesSavedView[];
    favoriteIds: string[];
    loading?: boolean;
  }>(),
  { loading: false },
);

const emit = defineEmits<{
  (e: "apply", view: TracesSavedView): void;
  (e: "update", view: TracesSavedView): void;
}>();

const { t } = useI18nTyped();

const isFavorite = (view: TracesSavedView) => props.favoriteIds.includes(view.view_id);
</script>

<template>
  <div
    v-if="props.loading"
    class="text-text-secondary flex items-center gap-2 px-3 py-1.5 text-sm"
    data-test="traces-saved-views-menu-loading"
  >
    <OSpinner size="xs" />
    {{ t("confirmDialog.loading") }}
  </div>
  <div
    v-else-if="props.views.length"
    class="max-h-72 overflow-y-auto overscroll-contain"
    data-test="traces-saved-views-menu-list"
  >
    <ODropdownItem
      v-for="view in props.views"
      :key="view.view_id"
      :text-value="view.view_name"
      :data-test="`traces-saved-view-apply-${view.view_id}`"
      @select="emit('apply', view)"
    >
      <template #icon-left>
        <OIcon
          :name="isFavorite(view) ? 'star' : 'saved-search'"
          size="sm"
          :class="isFavorite(view) ? 'text-favorite' : ''"
          :data-test="`traces-saved-view-icon-${view.view_id}`"
        />
      </template>
      <span class="max-w-56 truncate">{{ view.view_name }}</span>
      <template #icon-right>
        <OButton
          variant="ghost"
          size="icon-xs-sq"
          icon-left="edit"
          class="ms-auto"
          :title="t('search.updateSavedViewWithCurrent')"
          :data-test="`traces-saved-view-update-${view.view_id}`"
          @click.stop.prevent="emit('update', view)"
        />
      </template>
    </ODropdownItem>
  </div>
  <ODropdownItem v-else disabled>
    {{ t("search.savedViewsNotFound") }}
  </ODropdownItem>
</template>
