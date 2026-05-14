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
  <!-- Filter error message (non-blocking) -->
  <div
    v-if="filterErrMsg && !loading"
    data-test="logs-error-filter-error-message"
    class="tw:flex tw:items-center tw:justify-center tw:p-4 tw:rounded-lg tw:bg-[var(--o2-card-background)]"
  >
    <div
      class="tw:text-[var(--o2-text-secondary)] tw:text-[0.875rem] tw:text-center"
    >
      {{ filterErrMsg }}
    </div>
  </div>

  <!-- Main error state -->
  <div
    v-else-if="errorMsg && !loading"
    class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:p-8 tw:h-full"
    data-test="logs-error-main-error-container"
  >
    <!-- Error code 20003: missing stream -->
    <template v-if="errorCode === 20003">
      <div
        class="tw:size-16 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:bg-[var(--o2-warning-background)]"
      >
        <AlertTriangle
          :size="28"
          class="tw:text-[var(--o2-warning-color)]"
        />
      </div>
      <div
        class="tw:text-[var(--o2-text-primary)] tw:text-[1rem] tw:font-medium tw:text-center"
      >
        {{ errorMessage }}
      </div>
      <div
        class="tw:text-[var(--o2-text-secondary)] tw:text-[0.875rem] tw:text-center tw:max-w-[32rem]"
      >
        {{ t("search.streamNotFound") }}
      </div>
    </template>

    <!-- Other errors -->
    <template v-else>
      <div
        class="tw:size-16 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:bg-[var(--o2-error-background)]"
      >
        <CircleX
          :size="28"
          class="tw:text-[var(--o2-error-color)]"
        />
      </div>
      <div
        class="tw:text-[var(--o2-text-primary)] tw:text-[1rem] tw:font-medium tw:text-center tw:max-w-[40rem]"
      >
        {{ errorMessage }}
      </div>
      <div
        v-if="errorDetail"
        class="tw:text-[var(--o2-text-secondary)] tw:text-[0.875rem] tw:text-center tw:max-w-[40rem]"
      >
        {{ errorDetail }}
      </div>
    </template>

    <!-- Actions -->
    <div class="tw:flex tw:items-center tw:gap-3">
      <OButton
        variant="outline"
        size="sm"
        data-test="logs-error-retry-btn"
        @click="emit('retry')"
      >
        {{ t("search.retry") }}
      </OButton>
      <OButton
        v-if="showConfigureStream"
        variant="primary"
        size="sm"
        data-test="logs-error-configure-stream-btn"
        @click="emit('configure-stream')"
      >
        {{ t("search.configureStream") }}
      </OButton>
    </div>
  </div>

  <!-- No stream selected -->
  <div
    v-else-if="!hasStream && !loading"
    class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:p-8 tw:h-full"
    data-test="logs-error-no-stream-container"
  >
    <div
      class="tw:size-16 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:bg-[var(--o2-muted-background)]"
    >
      <Search :size="28" class="tw:text-[var(--o2-text-muted)]" />
    </div>
    <div
      class="tw:text-[var(--o2-text-primary)] tw:text-[1rem] tw:font-medium tw:text-center"
    >
      {{ t("search.noStreamSelected") }}
    </div>
    <div
      class="tw:text-[var(--o2-text-secondary)] tw:text-[0.875rem] tw:text-center"
    >
      {{ t("search.selectStreamToBegin") }}
    </div>
  </div>

  <!-- Search not applied -->
  <div
    v-else-if="!searchApplied && !loading"
    class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:p-8 tw:h-full"
    data-test="logs-error-search-not-applied-container"
  >
    <div
      class="tw:size-16 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:bg-[var(--o2-muted-background)]"
    >
      <Play :size="28" class="tw:text-[var(--o2-text-muted)]" />
    </div>
    <div
      class="tw:text-[var(--o2-text-primary)] tw:text-[1rem] tw:font-medium tw:text-center"
    >
      {{ t("search.applySearchPrompt") }}
    </div>
  </div>

  <!-- No results found -->
  <div
    v-else-if="!hasHits && searchApplied && !loading"
    class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:p-8 tw:h-full"
    data-test="logs-error-no-results-container"
  >
    <div
      class="tw:size-16 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:bg-[var(--o2-muted-background)]"
    >
      <SearchX :size="28" class="tw:text-[var(--o2-text-muted)]" />
    </div>
    <div
      class="tw:text-[var(--o2-text-primary)] tw:text-[1rem] tw:font-medium tw:text-center"
    >
      {{ emptyMessage ?? t("search.noResultsFound") }}
    </div>
    <div
      class="tw:text-[var(--o2-text-secondary)] tw:text-[0.875rem] tw:text-center"
    >
      {{ t("search.tryAdjustingQuery") }}
    </div>
  </div>

  <!-- Patterns not applied -->
  <div
    v-else-if="isPatternMode && !hasPatterns && !loading"
    class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:p-8 tw:h-full"
    data-test="logs-error-patterns-not-applied-container"
  >
    <div
      class="tw:size-16 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:bg-[var(--o2-muted-background)]"
    >
      <ChartNoAxesColumn :size="28" class="tw:text-[var(--o2-text-muted)]" />
    </div>
    <div
      class="tw:text-[var(--o2-text-primary)] tw:text-[1rem] tw:font-medium tw:text-center"
    >
      {{ t("search.noPatternsFound") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import {
  AlertTriangle,
  CircleX,
  Search,
  Play,
  SearchX,
  ChartNoAxesColumn,
} from "lucide-vue-next";

const { t } = useI18n();

const props = defineProps<{
  errorMsg?: string;
  errorCode?: number;
  errorDetail?: string;
  filterErrMsg?: string;
  functionError?: string;
  loading?: boolean;
  searchApplied?: boolean;
  hasStream?: boolean;
  hasHits?: boolean;
  isPatternMode?: boolean;
  hasPatterns?: boolean;
  emptyMessage?: string;
  showConfigureStream?: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  "configure-stream": [];
}>();

const errorMessage = computed(() => {
  return props.functionError || props.errorMsg || "";
});
</script>
