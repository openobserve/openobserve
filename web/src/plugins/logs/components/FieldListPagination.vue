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
    class="tw:pt-[0.375rem] tw:justify-between tw:w-full"
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
          data-test="logs-user-defined-fields-btn"
        >
          <template v-if="opt.slot === 'user_defined_slot'">
            <q-icon name="person" class="tw:text-[12px]!"></q-icon>
            <q-icon name="schema" class="tw:text-[12px]!"></q-icon>
            <q-tooltip
              data-test="logs-page-fields-list-user-defined-fields-warning-tooltip"
              anchor="center right"
              self="center left"
              max-width="18.75rem"
              class="text-body2"
            >
              <span class="text-bold" color="white">{{
                t("search.userDefinedSchemaLabel")
              }}</span>
            </q-tooltip>
          </template>
          <template v-else-if="opt.slot === 'all_fields_slot'">
            <q-icon name="schema" class="tw:text-[12px]!"></q-icon>
            <q-tooltip
              data-test="logs-page-fields-list-all-fields-warning-tooltip"
              anchor="center right"
              self="center left"
              max-width="18.75rem"
              class="text-body2"
            >
              <span class="text-bold" color="white">{{
                t("search.allFieldsLabel")
              }}</span>
              <q-separator color="white" class="q-mt-xs q-mb-xs" />
              {{ t("search.allFieldsWarningMsg") }}
            </q-tooltip>
          </template>
          <template
            v-else-if="opt.slot === 'interesting_fields_slot' && showQuickMode"
          >
            <q-icon name="info" class="tw:text-[12px]!" />
            <q-icon name="schema" class="tw:text-[12px]!"></q-icon>
            <q-tooltip
              anchor="center right"
              self="center left"
              max-width="18.75rem"
              class="text-body2"
            >
              <span class="text-bold" color="white">{{
                t("search.showOnlyInterestingFields")
              }}</span>
            </q-tooltip>
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
          :data-test="opt.slot === 'all_fields_slot' ? 'logs-all-fields-btn' : 'logs-interesting-fields-btn'"
        >
          <template v-if="opt.slot === 'all_fields_slot'">
            <q-icon name="schema" class="tw:text-[12px]!"></q-icon>
            <q-tooltip
              data-test="logs-page-fields-list-all-fields-warning-tooltip"
              anchor="center right"
              self="center left"
              max-width="18.75rem"
              class="text-body2"
            >
              <span class="text-bold" color="white">{{
                t("search.allFieldsLabel")
              }}</span>
              <q-separator color="white" class="q-mt-xs q-mb-xs" />
              {{ t("search.allFieldsWarningMsg") }}
            </q-tooltip>
          </template>
          <template
            v-else-if="opt.slot === 'interesting_fields_slot' && showQuickMode"
          >
            <q-icon name="info" class="tw:text-[12px]!" />
            <q-icon name="schema" class="tw:text-[12px]!"></q-icon>
            <q-tooltip
              anchor="center right"
              self="center left"
              max-width="18.75rem"
              class="text-body2"
            >
              <span class="text-bold" color="white">{{
                t("search.showOnlyInterestingFields")
              }}</span>
            </q-tooltip>
          </template>
          <template v-else>{{ opt.label }}</template>
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- Pagination and Reset Controls -->
    <div class="tw:flex tw:items-center tw:justify-end tw:gap-2">
      <!-- Pagination -->
      <div v-if="pagesNumber > 1" class="field-list-pagination">
        <q-tooltip
          data-test="logs-page-fields-list-pagination-tooltip"
          anchor="center left"
          self="center right"
          max-width="18.75rem"
          class="text-body2"
        >
          Total Fields: {{ totalFieldsCount }}
        </q-tooltip>

        <!-- First page button -->
        <OButton
          data-test="logs-page-fields-list-pagination-firstpage-button"
          variant="ghost"
          size="icon-xs-sq"
          :disabled="isFirstPage"
          @click="$emit('first-page')"
          aria-label="First page"
        >
          <q-icon name="fast_rewind" size="14px" />
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
          <q-icon name="fast_forward" size="14px" />
        </OButton>
      </div>

      <!-- Reset Fields Icon -->
      <div class="field-list-reset">
        <q-icon
          name="restart_alt"
          data-test="logs-page-fields-list-reset-icon"
          class="cursor-pointer reset-icon"
          @click="$emit('reset-fields')"
        />
        <q-tooltip
          data-test="logs-page-fields-list-reset-tooltip"
          anchor="center left"
          self="center right"
          max-width="18.75rem"
          class="text-body2"
        >
          <span class="text-bold" color="white">{{
            t("search.resetFields")
          }}</span>
        </q-tooltip>
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
