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
  <!-- Simple field without expansion (FTS keys or fields without values) -->
  <OFieldRow
    v-if="(field.ftsKey && !showFtsFieldValues) || !field.isSchemaField || !field.showValues"
    :title="field.name"
    :data-test="`logs-field-list-item-${field.name}`"
    class="tw:pl-[1.5rem]"
  >
    <OFieldLabel :field="field" :show-type-icon="false" />
    <OIcon
      :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
      v-if="showQuickMode && field.name !== timestampColumn"
      :name="field.isInterestingField ? 'info' : 'info-outline'"
      size="sm"
      :title="
        field.isInterestingField
          ? 'Remove from interesting fields'
          : 'Add to interesting fields'
      "
      class="tw:cursor-pointer tw:flex-shrink-0"
      @click.stop="$emit('toggle-interesting', field, field.isInterestingField)"
    />

    <template v-if="field.name !== timestampColumn" #actions>
      <OButton
        v-if="field.isSchemaField && field.name != timestampColumn"
        variant="ghost-primary"
        size="icon-xs-circle"
        :data-test="`log-search-index-list-filter-${field.name}-field-btn`"
        @click.stop="$emit('add-to-filter', `${field.name}=''`)"
      >
        <OIcon name="add" size="xs" />
      </OButton>
      <OIcon
        :data-test="`log-search-index-list-add-${field.name}-field-btn`"
        v-if="showVisibilityToggle && !isFieldSelected && field.name !== timestampColumn"
        name="visibility"
        size="sm"
        title="Add field to table"
        class="tw:cursor-pointer!"
        @click.stop="$emit('toggle-field', field)"
      />
      <OIcon
        :data-test="`log-search-index-list-remove-${field.name}-field-btn`"
        v-if="showVisibilityToggle && isFieldSelected"
        name="visibility-off"
        size="sm"
        title="Remove field from table"
        class="tw:cursor-pointer!"
        @click.stop="$emit('toggle-field', field)"
      />
    </template>
  </OFieldRow>

  <!-- Field with expansion for values -->
  <slot v-else name="expansion" :field="field"></slot>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFieldRow from "@/lib/lists/FieldList/OFieldRow.vue";
import OFieldLabel from "@/lib/lists/FieldList/OFieldLabel.vue";

interface Props {
  field: any;
  selectedFields: string[];
  timestampColumn: string;
  theme: string;
  showQuickMode: boolean;
  showVisibilityToggle?: boolean;
  showFtsFieldValues?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showVisibilityToggle: true,
  showFtsFieldValues: false,
});

defineEmits<{
  "add-to-filter": [value: string];
  "toggle-field": [field: any];
  "toggle-interesting": [field: any, isInteresting: boolean];
}>();

const isFieldSelected = computed(() =>
  props.selectedFields.includes(props.field.name),
);
</script>

