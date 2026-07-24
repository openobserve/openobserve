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
        :model-value="useUserDefinedSchemas"
        @update:model-value="$emit('toggle-schema', $event as string)"
        :data-test="`${dataTestPrefix}-fields-list-user-defined-schema-toggle`"
        class="schema-field-toggle mt-1 p-0"
      >
        <OToggleGroupItem
          v-for="opt in schemaToggleOptions"
          :key="opt.value"
          :value="opt.value"
          size="sm"
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
            <OTooltip
              :content="t('search.userDefinedSchemaLabel')"
              max-width="18.75rem"
              side="right"
              align="center"
            />
          </template>
          <template v-else-if="opt.slot === 'all_fields_slot'">
            <OIcon name="schema" size="xs" class="text-3xs!"></OIcon>
            <OTooltip max-width="18.75rem" side="right" align="center">
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
            <OTooltip
              :content="t('search.showOnlyInterestingFields')"
              max-width="18.75rem"
              side="right"
              align="center"
            />
          </template>
          <template v-else>{{ opt.label }}</template>
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- Interesting Fields Toggle (when no user defined schema) -->
    <div v-else-if="showQuickMode">
      <OToggleGroup
        :model-value="showOnlyInterestingFields"
        @update:model-value="$emit('toggle-interesting-fields', $event as boolean)"
        :data-test="`${dataTestPrefix}-fields-list-user-defined-schema-toggle`"
        class="schema-field-toggle"
      >
        <OToggleGroupItem
          v-for="opt in interestingFieldsToggleOptions"
          :key="opt.value"
          :value="opt.value"
          size="xs"
          :data-test="
            opt.slot === 'all_fields_slot'
              ? `${dataTestPrefix}-all-fields-btn`
              : `${dataTestPrefix}-interesting-fields-btn`
          "
        >
          <template v-if="opt.slot === 'all_fields_slot'">
            <OIcon name="schema" size="xs" class="text-3xs!"></OIcon>
            <OTooltip max-width="18.75rem" side="right" align="center">
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
            <OTooltip
              :content="t('search.showOnlyInterestingFields')"
              max-width="18.75rem"
              side="right"
              align="center"
            />
          </template>
          <template v-else>{{ opt.label }}</template>
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- Pagination and Reset Controls -->
    <div class="flex items-center justify-end gap-1">
      <!-- Pagination -->
      <div v-if="pagesNumber > 1" class="flex items-center gap-0.5">
        <OTooltip
          :content="'Total Fields: ' + totalFieldsCount"
          max-width="18.75rem"
          side="left"
          align="center"
        />

        <!-- First page button -->
        <OButton
          :data-test="`${dataTestPrefix}-fields-list-pagination-firstpage-button`"
          variant="ghost"
          size="icon-xs-sq"
          :disabled="isFirstPage"
          @click="$emit('first-page')"
          aria-label="First page"
        >
          <OIcon name="fast-rewind" size="xs" />
        </OButton>

        <!-- Page number buttons (3 at a time) -->
        <template v-for="page in visiblePages" :key="page">
          <OButton
            :variant="currentPage === page ? 'primary' : 'ghost'"
            size="icon-xs-sq"
            :data-test="`${dataTestPrefix}-fields-list-pagination-page-${page}-button`"
            @click="$emit('set-page', page)"
          >
            {{ page }}
          </OButton>
        </template>

        <!-- Last page button -->
        <OButton
          :data-test="`${dataTestPrefix}-fields-list-pagination-lastpage-button`"
          variant="ghost"
          size="icon-xs-sq"
          :disabled="isLastPage"
          @click="$emit('last-page')"
          aria-label="Last page"
        >
          <OIcon name="fast-forward" size="xs" />
        </OButton>
      </div>

      <!-- Reset Fields Icon -->
      <div class="flex items-center">
        <OIcon
          name="restart-alt"
          size="sm"
          :data-test="`${dataTestPrefix}-fields-list-reset-icon`"
          class="cursor-pointer text-sm opacity-70 transition-opacity duration-200 hover:opacity-100!"
          @click="$emit('reset-fields')"
        />
        <OTooltip
          :content="t('search.resetFields')"
          max-width="18.75rem"
          side="left"
          align="center"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const { t } = useI18n();

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
  isFirstPage: boolean;
  isLastPage: boolean;
  totalFieldsCount: number;
}

const props = withDefaults(defineProps<Props>(), {
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
  "first-page": [];
  "last-page": [];
  "set-page": [page: number];
  "reset-fields": [];
}>();

// Get page numbers to display (3 at a time)
const visiblePages = computed(() => {
  const pages: number[] = [];
  const { currentPage, pagesNumber } = props;

  if (pagesNumber <= 3) {
    for (let i = 1; i <= pagesNumber; i++) {
      pages.push(i);
    }
  } else {
    let startPage = Math.max(1, currentPage - 1);
    let endPage = Math.min(pagesNumber, startPage + 2);

    if (endPage === pagesNumber) {
      startPage = Math.max(1, endPage - 2);
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }
  }

  return pages;
});
</script>

<style scoped>
/* keep(complex-state): :deep overrides of the child toggle-group's [role=group] internals */
.schema-field-toggle :deep([role="group"]) {
  gap: 0.125rem;
}

.schema-field-toggle :deep([role="group"]) > * {
  gap: 0.25rem;
  height: 1.375rem;
  min-height: unset;
}
</style>
