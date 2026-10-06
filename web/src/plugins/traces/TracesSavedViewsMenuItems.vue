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
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

interface TracesSavedView {
  view_id: string;
  view_name: string;
}

const props = withDefaults(
  defineProps<{
    views: TracesSavedView[];
    dataTestPrefix: string;
    showDelete?: boolean;
    compact?: boolean;
  }>(),
  { showDelete: false, compact: false },
);

const emit = defineEmits<{
  (e: "apply", view: TracesSavedView): void;
  (e: "update", view: TracesSavedView): void;
  (e: "delete", view: TracesSavedView): void;
}>();

const { t } = useI18nTyped();
</script>

<template>
  <div
    v-if="props.views.length"
    :class="[props.compact ? 'max-h-44' : 'max-h-72', 'overflow-y-auto overscroll-contain']"
  >
    <ODropdownItem
      v-for="view in props.views"
      :key="view.view_id"
      :text-value="view.view_name"
      :data-test="`${props.dataTestPrefix}-apply-${view.view_id}`"
      @select="emit('apply', view)"
    >
      <span class="max-w-56 truncate">{{ view.view_name }}</span>
      <template #icon-right>
        <OButton
          variant="ghost"
          size="icon-xs-sq"
          icon-left="edit"
          class="ms-auto"
          :title="t('search.updateSavedViewWithCurrent')"
          :data-test="`${props.dataTestPrefix}-update-${view.view_id}`"
          @click.stop.prevent="emit('update', view)"
        />
        <OButton
          v-if="props.showDelete"
          variant="ghost"
          size="icon-xs-sq"
          icon-left="delete"
          :title="t('search.deleteSavedView')"
          :data-test="`${props.dataTestPrefix}-delete-${view.view_id}`"
          @click.stop.prevent="emit('delete', view)"
        />
      </template>
    </ODropdownItem>
  </div>
  <ODropdownItem v-else disabled>
    {{ t("search.savedViewsNotFound") }}
  </ODropdownItem>
</template>
