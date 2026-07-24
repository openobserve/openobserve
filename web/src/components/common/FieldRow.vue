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
    :data-test="`logs-field-list-item-${field.name}`"
    class="pl-6"
    :highlight="isFieldSelected && field.name !== timestampColumn"
  >
    <OFieldLabel :field="field" :show-type-icon="false" />
    <OButton
      :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
      v-if="showQuickMode && field.name !== timestampColumn"
      :name="field.isInterestingField ? 'info-filled' : 'info-outline'"
      variant="ghost-neutral"
      class="gap-0! mr-1"
      size="icon"
      :title="
        field.isInterestingField
          ? 'Remove from interesting fields'
          : 'Add to interesting fields'
      "
      @click.stop="$emit('toggle-interesting', field, field.isInterestingField)"
    >
      <OIcon :name="field.isInterestingField ? 'info-filled' : 'info-outline'" size="sm" />
    </OButton>

    <template v-if="field.name !== timestampColumn" #actions>
      <OButton
        v-if="field.isSchemaField && field.name != timestampColumn"
        variant="ghost-neutral"
        size="icon"
        :data-test="`log-search-index-list-filter-${field.name}-field-btn`"
        @click.stop="$emit('add-to-filter', `${field.name}=''`)"
      >
        <OIcon name="add" size="sm" />
      </OButton>
      <OButton
        :data-test="`log-search-index-list-add-${field.name}-field-btn`"
        v-if="showVisibilityToggle && !isFieldSelected && field.name !== timestampColumn"
        variant="ghost-neutral"
        size="icon"
        class="gap-0!"
        :title="t('search.addFieldToTable')"
        @click.stop="$emit('toggle-field', field)"
      >
        <OIcon name="visibility" size="sm" />
      </OButton>
      <OButton
        :data-test="`log-search-index-list-remove-${field.name}-field-btn`"
        v-if="showVisibilityToggle && isFieldSelected"
        variant="ghost-neutral"
        class="gap-0!"
        size="icon"
        :title="t('search.removeFieldFromTable')"
        @click.stop="$emit('toggle-field', field)"
      >
        <OIcon name="visibility-off" size="sm" />
      </OButton>
      <OButton
        :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
        v-if="showQuickMode && field.name !== timestampColumn"
        variant="ghost-neutral"
        class="gap-0!"
        size="icon"
        :title="
          field.isInterestingField
            ? 'Remove from interesting fields'
            : 'Add to interesting fields'
        "
        @click.stop="$emit('toggle-interesting', field, field.isInterestingField)"
      >
        <OIcon :name="field.isInterestingField ? 'info-filled' : 'info-outline'" size="sm" />
      </OButton>
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
import { useI18n } from "vue-i18n";

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

const { t } = useI18n();

defineEmits<{
  "add-to-filter": [value: string];
  "toggle-field": [field: any];
  "toggle-interesting": [field: any, isInteresting: boolean];
}>();

const isFieldSelected = computed(() =>
  props.selectedFields.includes(props.field.name),
);
</script>

