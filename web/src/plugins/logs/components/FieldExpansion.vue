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
  <q-expansion-item
    dense
    switch-toggle-side
    :label="field.name"
    expand-icon-class="field-expansion-icon"
    expand-icon="expand_more"
    expanded-icon="expand_less"
    class="hover:tw:bg-[var(--o2-hover-accent)] tw:rounded-[0.25rem]"
    @before-show="(event: any) => handleBeforeShow(event)"
    @before-hide="() => handleBeforeHide()"
  >
    <template v-slot:header>
      <div
        class="flex content-center ellipsis full-width"
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
          <q-btn
            v-if="field.isSchemaField"
            :data-test="`log-search-index-list-filter-${field.name}-field-btn`"
            :icon="outlinedAdd"
            style="margin-right: 0.375rem"
            size="0.4rem"
            class="q-mr-sm"
            @click.stop="$emit('add-to-filter', `${field.name}=''`)"
            round
          />
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
        <div class="filter-values-container">
          <!-- Loading state -->
          <div
            v-show="fieldValues?.isLoading"
            class="q-pl-md q-py-xs"
            style="height: 3.75rem"
          >
            <q-inner-loading
              size="xs"
              :showing="fieldValues?.isLoading"
              label="Fetching values..."
              label-style="font-size: 1.1em"
            />
          </div>

          <!-- No values found -->
          <div
            v-show="!fieldValues?.values?.length && !fieldValues?.isLoading"
            class="q-pl-md q-py-xs text-subtitle2"
          >
            {{ fieldValues?.errMsg || "No values found" }}
          </div>

          <!-- Field values list -->
          <div v-for="value in fieldValues?.values || []" :key="value.key">
            <q-list dense>
              <q-item
                tag="label"
                class="q-pr-none"
                :data-test="`logs-search-subfield-add-${field.name}-${value.key}`"
              >
                <div
                  class="flex row wrap justify-between"
                  :style="
                    selectedStreamsCount == field.streams.length
                      ? 'width: calc(100% - 2.625rem)'
                      : 'width: 100%'
                  "
                >
                  <div
                    :title="value.key"
                    class="ellipsis q-pr-xs"
                    style="width: calc(100% - 3.125rem)"
                  >
                    {{ value.key }}
                  </div>
                  <div
                    :title="value.count.toString()"
                    class="ellipsis text-right q-pr-sm"
                    style="display: contents"
                    :style="
                      selectedStreamsCount == field.streams.length
                        ? 'width: 3.125rem'
                        : ''
                    "
                  >
                    {{ formatLargeNumber(value.count) }}
                  </div>
                </div>

                <!-- Include/Exclude buttons -->
                <div
                  v-if="selectedStreamsCount == field.streams.length"
                  class="flex row tw:ml-[0.125rem]"
                  :class="theme === 'dark' ? 'text-white' : 'text-black'"
                >
                  <q-btn
                    class="o2-custom-button-hover tw:ml-[0.25rem]! tw:mr-[0.25rem]! tw:border! tw:border-solid-[1px]! tw:border-[var(--o2-border-color)]!"
                    size="0.25rem"
                    @click="handleAddSearchTerm(field.name, value.key, 'include')"
                    title="Include Term"
                    round
                    :data-test="`log-search-subfield-list-equal-${field.name}-field-btn`"
                  >
                    <q-icon class="tw:h-[0.5rem]! tw:w-[0.5rem]! tw:m-[0.15rem]!">
                      <EqualIcon></EqualIcon>
                    </q-icon>
                  </q-btn>
                  <q-btn
                    class="o2-custom-button-hover tw:border! tw:border-solid! tw:border-[var(--o2-border-color)]!"
                    size="0.25rem"
                    @click="handleAddSearchTerm(field.name, value.key, 'exclude')"
                    title="Exclude Term"
                    round
                    :data-test="`log-search-subfield-list-not-equal-${field.name}-field-btn`"
                  >
                    <q-icon class="tw:h-[0.5rem]! tw:w-[0.5rem]! tw:m-[0.15rem]!">
                      <NotEqualIcon></NotEqualIcon>
                    </q-icon>
                  </q-btn>
                </div>
              </q-item>
            </q-list>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-expansion-item>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  outlinedAdd,
  outlinedVisibility,
  outlinedVisibilityOff,
} from "@quasar/extras/material-icons-outlined";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { formatLargeNumber } from "@/utils/zincutils";

interface Props {
  field: any;
  fieldValues?: {
    isLoading: boolean;
    values: { key: string; count: number }[];
    errMsg?: string;
  };
  selectedFields: string[];
  selectedStreamsCount: number;
  theme: string;
  showQuickMode: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "add-to-filter": [value: string];
  "toggle-field": [field: any];
  "toggle-interesting": [field: any, isInteresting: boolean];
  "add-search-term": [fieldName: string, value: string, action: string];
  "before-show": [event: any, field: any];
  "before-hide": [field: any];
}>();

const isFieldSelected = computed(() =>
  props.selectedFields.includes(props.field.name),
);

const handleBeforeShow = (event: any) => {
  emit("before-show", event, props.field);
};

const handleBeforeHide = () => {
  emit("before-hide", props.field);
};

const handleAddSearchTerm = (
  fieldName: string,
  value: string,
  action: string,
) => {
  emit("add-search-term", fieldName, value, action);
};
</script>

<style scoped lang="scss">
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

:deep(.q-expansion-item):hover .field_overlay {
  display: flex;
}
</style>
