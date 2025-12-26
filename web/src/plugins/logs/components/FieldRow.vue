<!-- Copyright 2023 OpenObserve Inc.

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
  <!-- Simple field without expansion (FTS keys or fields without values) -->
  <div
    v-if="field.ftsKey || !field.isSchemaField || !field.showValues"
    class="field-container flex content-center ellipsis q-pl-lg full-width hover:tw:bg-[var(--o2-hover-accent)] tw:rounded-[0.25rem]"
    :title="field.name"
  >
    <div
      class="field_label full-width tw:flex! tw:items-center! tw:justify-between!"
      :data-test="`logs-field-list-item-${field.name}`"
    >
      <div
        class="ellipsis tw:flex tw:items-center tw:max-w-[calc(100%-1.5rem)]!"
        style="display: inline-block"
      >
        {{ field.name }}
      </div>
      <span class="float-right">
        <q-icon
          :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
          v-if="showQuickMode && field.name !== timestampColumn"
          :name="field.isInterestingField ? 'info' : 'info_outline'"
          :class="theme === 'dark' ? '' : 'light-dimmed'"
          style="margin-right: 0.375rem"
          size="1.1rem"
          :title="
            field.isInterestingField
              ? 'Remove from interesting fields'
              : 'Add to interesting fields'
          "
        />
      </span>
    </div>
    <div
      class="field_overlay tw:rounded-[0.25rem] tw:overflow-hidden"
      v-if="field.name !== timestampColumn"
    >
      <q-btn
        v-if="field.isSchemaField && field.name != timestampColumn"
        :icon="outlinedAdd"
        :data-test="`log-search-index-list-filter-${field.name}-field-btn`"
        style="margin-right: 0.375rem"
        size="0.4rem"
        class="q-mr-sm"
        @click.stop="$emit('add-to-filter', `${field.name}=''`)"
        round
      />
      <q-icon
        :data-test="`log-search-index-list-add-${field.name}-field-btn`"
        v-if="!isFieldSelected && field.name !== timestampColumn"
        :name="outlinedVisibility"
        style="margin-right: 0.375rem"
        size="1.1rem"
        title="Add field to table"
        @click.stop="$emit('toggle-field', field)"
      />
      <q-icon
        :data-test="`log-search-index-list-remove-${field.name}-field-btn`"
        v-if="isFieldSelected"
        :name="outlinedVisibilityOff"
        style="margin-right: 0.375rem"
        size="1.1rem"
        title="Remove field from table"
        @click.stop="$emit('toggle-field', field)"
      />
      <q-icon
        :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
        v-if="showQuickMode && field.name !== timestampColumn"
        :name="field.isInterestingField ? 'info' : 'info_outline'"
        size="1.1rem"
        :title="
          field.isInterestingField
            ? 'Remove from interesting fields'
            : 'Add to interesting fields'
        "
        @click.stop="$emit('toggle-interesting', field, field.isInterestingField)"
      />
    </div>
  </div>

  <!-- Field with expansion for values -->
  <slot v-else name="expansion" :field="field"></slot>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  outlinedAdd,
  outlinedVisibility,
  outlinedVisibilityOff,
} from "@quasar/extras/material-icons-outlined";

interface Props {
  field: any;
  selectedFields: string[];
  timestampColumn: string;
  theme: string;
  showQuickMode: boolean;
}

const props = defineProps<Props>();

defineEmits<{
  "add-to-filter": [value: string];
  "toggle-field": [field: any];
  "toggle-interesting": [field: any, isInteresting: boolean];
}>();

const isFieldSelected = computed(() =>
  props.selectedFields.includes(props.field.name),
);
</script>

<style scoped lang="scss">
.field-container {
  position: relative;

  .field_overlay {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    display: none;
    align-items: center;
    padding: 0 0.25rem;
    background: var(--q-dark);
  }

  &:hover .field_overlay {
    display: flex;
  }
}

.field_label {
  padding: 0.25rem 0;
}
</style>
