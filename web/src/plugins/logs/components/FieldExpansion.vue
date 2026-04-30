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
  <q-expansion-item
    dense
    hide-expand-icon
    v-model="isExpanded"
    :label="field.name"
    class="hover:tw:bg-[var(--o2-hover-accent)] tw:rounded-[0.25rem]"
    @before-show="(event: any) => handleBeforeShow(event)"
    @before-hide="() => handleBeforeHide()"
  >
    <template v-slot:header>
      <div
        class="flex content-center ellipsis full-width field-expansion-header"
        :title="field.name"
        :data-test="`log-search-expand-${field.name}-field-btn`"
      >
        <div
          class="field_label full-width"
          :data-test="`logs-field-list-item-${field.name}`"
        >
          <div
            class="ellipsis tw:max-w-[calc(100%-1.5rem)]!"
            style="display: inline-block"
          >
            <span v-if="field.dataType" class="field-type-container">
              <q-icon
                class="field-expand-icon"
                :name="isExpanded ? 'expand_more' : 'chevron_right'"
                size="1rem"
              />
            </span>
            {{ field.name }}
          </div>
          <span class="float-right">
            <q-icon
              :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
              v-if="showQuickMode"
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
        <div class="field_overlay tw:rounded-[0.25rem] tw:overflow-hidden">
          <span v-if="field.isSchemaField" style="margin-right: 0.375rem">
            <OButton
              :data-test="`log-search-index-list-filter-${field.name}-field-btn`"
              variant="ghost"
              size="icon-xs-circle"
              @click.stop="$emit('add-to-filter', `${field.name}=''`)"
            >
              <q-icon :name="outlinedAdd" size="12px" />
            </OButton>
          </span>
          <q-icon
            :data-test="`log-search-index-list-add-${field.name}-field-btn`"
            v-if="!isFieldSelected"
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
            title="Remove field from table"
            size="1.1rem"
            @click.stop="$emit('toggle-field', field)"
          />
          <q-icon
            :data-test="`log-search-index-list-interesting-${field.name}-field-btn`"
            v-if="showQuickMode"
            :name="field.isInterestingField ? 'info' : 'info_outline'"
            size="1.1rem"
            :title="
              field.isInterestingField
                ? 'Remove from interesting fields'
                : 'Add to interesting fields'
            "
            @click.stop="
              $emit('toggle-interesting', field, field.isInterestingField)
            "
          />
        </div>
      </div>
    </template>

    <q-card>
      <q-card-section class="q-pl-md q-pr-xs q-py-xs">
        <FieldValuesPanel
          ref="fieldValuesPanelRef"
          :field-name="field.name"
          :field-values="fieldValues"
          :show-multi-select="selectedStreamsCount == field.streams.length"
          :default-values-count="defaultValuesCount"
          :theme="theme"
          :active-include-values="activeIncludeValues"
          :active-exclude-values="activeExcludeValues"
          @add-search-term="(fn, v, a) => emit('add-search-term', fn, v, a)"
          @add-multiple-search-terms="
            (fn, vs, a) => emit('add-multiple-search-terms', fn, vs, a)
          "
          @remove-field-filter="(fn) => emit('remove-field-filter', fn)"
          @load-more-values="(fn) => emit('load-more-values', fn)"
          @search-field-values="(fn, t) => emit('search-field-values', fn, t)"
        />
      </q-card-section>
    </q-card>
  </q-expansion-item>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  outlinedAdd,
  outlinedVisibility,
  outlinedVisibilityOff,
} from "@quasar/extras/material-icons-outlined";
import FieldValuesPanel from "@/components/common/FieldValuesPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";

interface Props {
  field: any;
  fieldValues?: {
    isLoading: boolean;
    values: { key: string; count: number }[];
    errMsg?: string;
    hasMore?: boolean;
  };
  selectedFields: string[];
  selectedStreamsCount: number;
  theme: string;
  showQuickMode: boolean;
  defaultValuesCount: number;
  activeIncludeValues?: string[];
  activeExcludeValues?: string[];
  expanded?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "add-to-filter": [value: string];
  "toggle-field": [field: any];
  "toggle-interesting": [field: any, isInteresting: boolean];
  "add-search-term": [fieldName: string, value: string, action: string];
  "add-multiple-search-terms": [
    fieldName: string,
    values: string[],
    action: string,
  ];
  "remove-field-filter": [fieldName: string];
  "search-field-values": [fieldName: string, searchTerm: string];
  "load-more-values": [fieldName: string];
  "before-show": [event: any, field: any];
  "before-hide": [field: any];
}>();

const isExpanded = ref(props.expanded ?? false);
const fieldValuesPanelRef = ref();

watch(
  () => props.expanded,
  (val) => {
    if (val !== undefined) isExpanded.value = val;
  },
);

const isFieldSelected = computed(() =>
  props.selectedFields.includes(props.field.name),
);

const handleBeforeShow = (event: any) => {
  emit("before-show", event, props.field);
};

const handleBeforeHide = () => {
  fieldValuesPanelRef.value?.reset();
  emit("before-hide", props.field);
};
</script>

<style scoped lang="scss">
:deep(.q-expansion-item__container .q-item) {
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.field_overlay {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  align-items: center;
  padding: 0 0.25rem;
  background: var(--q-dark);
}

:deep(.q-expansion-item):hover .field_overlay {
  display: flex;
}
</style>
