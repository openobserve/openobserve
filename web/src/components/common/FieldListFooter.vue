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
  <div
    class="border-card-glass-border bg-card-glass-bg w-full justify-between border-t px-1 py-px"
    :class="showSchemaToggle || showQuickMode ? 'flex' : ''"
  >
    <!-- Schema Toggle Buttons -->
    <div v-if="showSchemaToggle">
      <OToggleGroup
        size="sm"
        :model-value="useUserDefinedSchemas"
        @update:model-value="$emit('toggle-schema', $event as string)"
        :data-test="`${dataTestPrefix}-fields-list-user-defined-schema-toggle`"
        class="mt-1"
      >
        <OToggleGroupItem
          v-for="opt in schemaToggleOptions"
          :key="opt.value"
          :value="opt.value"
          :data-test="
            opt.slot === 'all_fields_slot'
              ? `${dataTestPrefix}-all-fields-btn`
              : opt.slot === 'interesting_fields_slot'
                ? `${dataTestPrefix}-interesting-fields-btn`
                : `${dataTestPrefix}-user-defined-fields-btn`
          "
        >
          <template v-if="opt.slot === 'user_defined_slot'">
            <OIcon name="person" size="xs" class="text-3xs!"></OIcon>
            <OIcon name="schema" size="xs" class="text-3xs!"></OIcon>
            <OTooltip :content="t('search.userDefinedSchemaLabel')" side="right" />
          </template>
          <template v-else-if="opt.slot === 'all_fields_slot'">
            <OIcon name="schema" size="xs" class="text-3xs!"></OIcon>
            <OTooltip side="right">
              <template #content>
                <span class="font-bold">{{ t("search.allFieldsLabel") }}</span>
                <hr class="my-1 opacity-50" />
                {{ t("search.allFieldsWarningMsg") }}
              </template>
            </OTooltip>
          </template>
          <template v-else-if="opt.slot === 'interesting_fields_slot' && showQuickMode">
            <OIcon name="info-outline" size="xs" class="text-3xs!" />
            <OIcon name="schema" size="xs" class="text-3xs!"></OIcon>
            <OTooltip :content="t('search.showOnlyInterestingFields')" side="right" />
          </template>
          <template v-else>{{ opt.label }}</template>
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- Interesting Fields Toggle (when no user defined schema) -->
    <div v-else-if="showQuickMode">
      <OToggleGroup
        size="sm"
        :model-value="showOnlyInterestingFields"
        @update:model-value="$emit('toggle-interesting-fields', $event as boolean)"
        :data-test="`${dataTestPrefix}-fields-list-user-defined-schema-toggle`"
      >
        <OToggleGroupItem
          v-for="opt in interestingFieldsToggleOptions"
          :key="opt.value"
          :value="opt.value"
          :data-test="
            opt.slot === 'all_fields_slot'
              ? `${dataTestPrefix}-all-fields-btn`
              : `${dataTestPrefix}-interesting-fields-btn`
          "
        >
          <template v-if="opt.slot === 'all_fields_slot'">
            <OIcon name="schema" size="xs" class="text-3xs!"></OIcon>
            <OTooltip side="right">
              <template #content>
                <span class="font-bold">{{ t("search.allFieldsLabel") }}</span>
                <hr class="my-1 opacity-50" />
                {{ t("search.allFieldsWarningMsg") }}
              </template>
            </OTooltip>
          </template>
          <template v-else-if="opt.slot === 'interesting_fields_slot' && showQuickMode">
            <OIcon name="info-outline" size="xs" class="text-3xs!" />
            <OIcon name="schema" size="xs" class="text-3xs!"></OIcon>
            <OTooltip :content="t('search.showOnlyInterestingFields')" side="right" />
          </template>
          <template v-else>{{ opt.label }}</template>
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- Pagination and Reset Controls -->
    <div class="flex items-center justify-end gap-1">
      <!-- One pager, the same as every list's (D5, S8). -->
      <OPagination
        v-if="pagesNumber > 1"
        :page="currentPage"
        :page-count="pagesNumber"
        :data-test="`${dataTestPrefix}-fields-list-pagination`"
        @update:page="$emit('set-page', $event)"
      >
        <template #range="{ text }">
          <span class="text-text-secondary text-xs whitespace-nowrap tabular-nums"
            >{{ text
            }}<OTooltip :content="t('common.totalFields', { count: totalFieldsCount })" side="left"
          /></span>
        </template>
      </OPagination>

      <!-- Reset Fields Icon -->
      <div class="flex items-center">
        <OIcon
          name="restart-alt"
          size="sm"
          :data-test="`${dataTestPrefix}-fields-list-reset-icon`"
          class="cursor-pointer text-sm opacity-70 transition-opacity duration-200 hover:opacity-100!"
          @click="$emit('reset-fields')"
        />
        <OTooltip :content="t('search.resetFields')" side="left" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPagination from "@/lib/navigation/Pagination/OPagination.vue";

const { t } = useI18nTyped();

interface Props {
  dataTestPrefix?: string;
  showSchemaToggle?: boolean;
  showQuickMode?: boolean;
  useUserDefinedSchemas?: string;
  showOnlyInterestingFields?: boolean;
  schemaToggleOptions?: any[];
  interestingFieldsToggleOptions?: any[];
  currentPage: number;
  pagesNumber: number;
  totalFieldsCount: number;
}

withDefaults(defineProps<Props>(), {
  dataTestPrefix: "logs-page",
  showSchemaToggle: false,
  showQuickMode: false,
  useUserDefinedSchemas: "",
  showOnlyInterestingFields: false,
  schemaToggleOptions: () => [],
  interestingFieldsToggleOptions: () => [],
});

defineEmits<{
  "toggle-schema": [value: string];
  "toggle-interesting-fields": [value: boolean];
  "set-page": [page: number];
  "reset-fields": [];
}>();
</script>
