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
    class="tw:pt-[0.125rem] tw:justify-between tw:w-full"
    :class="showUserDefinedSchemaToggle || showQuickMode ? 'tw:flex' : ''"
  >
    <!-- Schema Toggle Buttons -->
    <div v-if="showUserDefinedSchemaToggle">
      <OToggleGroup
        :model-value="useUserDefinedSchemas"
        @update:model-value="$emit('toggle-schema', $event)"
        data-test="logs-page-field-list-user-defined-schema-toggle"
        class="schema-field-toggle q-mr-xs tw:p-0"
      >
        <OToggleGroupItem
          v-for="opt in userDefinedSchemaBtnGroupOption"
          :key="opt.value"
          :value="opt.value"
          size="sm"
          data-test="logs-user-defined-fields-btn"
        >
          <template v-if="opt.slot === 'user_defined_slot'">
            <OIcon name="person" size="sm" class="tw:text-[12px]!"></OIcon>
            <OIcon name="schema" size="sm" class="tw:text-[12px]!"></OIcon>
            <OTooltip
              data-test="logs-page-fields-list-user-defined-fields-warning-tooltip"
              :content="t('search.userDefinedSchemaLabel')"
              max-width="18.75rem"
              side="right"
              align="center"
            />
          </template>
          <template v-else-if="opt.slot === 'all_fields_slot'">
            <OIcon name="schema" size="sm" class="tw:text-[12px]!"></OIcon>
            <OTooltip
              data-test="logs-page-fields-list-all-fields-warning-tooltip"
              max-width="18.75rem"
              side="right"
              align="center"
            >
              <template #content>
                <span class="tw:font-bold">{{ t("search.allFieldsLabel") }}</span>
                <hr class="tw:my-1 tw:opacity-50" />
                {{ t("search.allFieldsWarningMsg") }}
              </template>
            </OTooltip>
          </template>
          <template
            v-else-if="opt.slot === 'interesting_fields_slot' && showQuickMode"
          >
            <OIcon name="info-outline" size="sm" class="tw:text-[12px]!" />
            <OIcon name="schema" size="sm" class="tw:text-[12px]!"></OIcon>
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
        @update:model-value="$emit('toggle-interesting-fields', $event)"
        data-test="logs-page-field-list-user-defined-schema-toggle"
        class="schema-field-toggle q-mr-xs"
      >
        <OToggleGroupItem
          v-for="opt in selectedFieldsBtnGroupOption"
          :key="opt.value"
          :value="opt.value"
          size="sm"
          :data-test="opt.slot === 'all_fields_slot' ? 'logs-all-fields-btn' : 'logs-interesting-fields-btn'"
        >
          <template v-if="opt.slot === 'all_fields_slot'">
            <OIcon name="schema" size="sm" class="tw:text-[12px]!"></OIcon>
            <OTooltip
              data-test="logs-page-fields-list-all-fields-warning-tooltip"
              max-width="18.75rem"
              side="right"
              align="center"
            >
              <template #content>
                <span class="tw:font-bold">{{ t("search.allFieldsLabel") }}</span>
                <hr class="tw:my-1 tw:opacity-50" />
                {{ t("search.allFieldsWarningMsg") }}
              </template>
            </OTooltip>
          </template>
          <template
            v-else-if="opt.slot === 'interesting_fields_slot' && showQuickMode"
          >
            <OIcon name="info-outline" size="sm" class="tw:text-[12px]!" />
            <OIcon name="schema" size="sm" class="tw:text-[12px]!"></OIcon>
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
    <div class="tw:flex tw:items-center tw:justify-end tw:gap-2">
      <!-- Pagination -->
      <div v-if="pagesNumber > 1" class="field-list-pagination">
        <OTooltip
          data-test="logs-page-fields-list-pagination-tooltip"
          :content="'Total Fields: ' + totalFieldsCount"
          max-width="18.75rem"
          side="left"
          align="center"
        />

        <!-- First page button -->
        <OButton
          data-test="logs-page-fields-list-pagination-firstpage-button"
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
            size="sm"
            :data-test="`logs-page-fields-list-pagination-page-${page}-button`"
            @click="$emit('set-page', page)"
            >{{ page }}</OButton
          >
        </template>

        <!-- Last page button -->
        <OButton
          data-test="logs-page-fields-list-pagination-lastpage-button"
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
      <div class="field-list-reset">
        <OIcon
          name="restart-alt" size="sm"
          data-test="logs-page-fields-list-reset-icon"
          class="cursor-pointer reset-icon"
          @click="$emit('reset-fields')"
        />
        <OTooltip
          data-test="logs-page-fields-list-reset-tooltip"
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
  showUserDefinedSchemaToggle: boolean;
  showQuickMode: boolean;
  useUserDefinedSchemas: string;
  showOnlyInterestingFields: boolean;
  userDefinedSchemaBtnGroupOption: any[];
  selectedFieldsBtnGroupOption: any[];
  currentPage: number;
  pagesNumber: number;
  isFirstPage: boolean;
  isLastPage: boolean;
  totalFieldsCount: number;
}

const props = defineProps<Props>();

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
    // If 3 or fewer pages, show all
    for (let i = 1; i <= pagesNumber; i++) {
      pages.push(i);
    }
  } else {
    // Show 3 pages centered around current page
    let startPage = Math.max(1, currentPage - 1);
    let endPage = Math.min(pagesNumber, startPage + 2);

    // Adjust if we're near the end
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

<style scoped lang="scss">
.field-list-pagination {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.field-list-reset {
  display: flex;
  align-items: center;
}

.reset-icon {
  font-size: 1.25rem;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.2s;

  &:hover {
    opacity: 1;
  }
}

.schema-field-toggle {
  :deep(.q-btn) {
    padding: 0.25rem 0.5rem;
  }
}
</style>
