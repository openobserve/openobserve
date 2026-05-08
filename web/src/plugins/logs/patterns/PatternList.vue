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
  <div class="tw:flex tw:flex-col">
    <!-- Toolbar: search input, anomaly toggle, export CSV -->
    <div
      v-if="patterns?.length > 0"
      class="tw:flex tw:items-center tw:gap-[0.5rem] tw:mb-[0.75rem] tw:flex-wrap"
    >
      <q-input
        v-model="filterQuery"
        dense
        outlined
        :placeholder="t('search.patternSearchPlaceholder')"
        class="tw:flex-1 tw:min-w-[12rem]"
        data-test="patterns-patternlist-search-input"
        debounce="300"
        clearable
      >
        <template #prepend>
          <q-icon name="search" size="1rem" />
        </template>
      </q-input>
      <OButton
        :variant="showAnomalyOnly ? 'primary' : 'secondary'"
        size="sm"
        @click="showAnomalyOnly = !showAnomalyOnly"
        data-test="patterns-patternlist-anomaly-toggle"
      >
        <template #icon-left>
          <q-icon name="warning" size="0.75rem" />
        </template>
        {{ showAnomalyOnly ? t("search.patternShowAll") : t("search.patternShowAnomalyOnly") }}
      </OButton>
      <OButton
        variant="outline"
        size="sm"
        @click="handleExportCsv"
        data-test="patterns-patternlist-export-csv"
      >
        <template #icon-left>
          <q-icon name="download" size="0.75rem" />
        </template>
        {{ t("search.patternExportCsv") }}
      </OButton>
    </div>

    <!-- Patterns cards -->
    <div v-if="displayPatterns.length > 0" class="tw:flex tw:flex-col">
      <q-virtual-scroll
        :items="displayPatterns"
        virtual-scroll-slice-size="5"
        v-slot="{ item: pattern, index }"
        :scroll-target="scrollTarget ?? undefined"
      >
        <PatternCard
          :pattern="pattern"
          :index="displayIndex(index)"
          :wrap="wrap"
          @click="$emit('open-details', pattern, displayIndex(index))"
          @include="$emit('add-to-search', pattern, 'include')"
          @exclude="$emit('add-to-search', pattern, 'exclude')"
          @create-alert="$emit('create-alert', pattern)"
          @copy-sql="$emit('copy-sql', pattern)"
          @contextmenu="(p: any, e: MouseEvent) => $emit('contextmenu', p, e)"
          @keynav="handleKeyNav"
        />
      </q-virtual-scroll>
    </div>

    <!-- Loading: skeleton -->
    <PatternSkeleton
      v-else-if="loading"
    />

    <!-- Empty state -->
    <div
      v-else
      class="tw:flex-1 tw:flex tw:flex-col tw:items-center tw:justify-center tw:p-[1.25rem] tw:text-center"
    >
      <div class="tw:text-[3rem] tw:mb-[1rem] tw:opacity-30">📊</div>
      <div
        class="text-h6 q-mb-sm"
        :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
      >
        {{ t("search.patternNoPatternsFound") || "No patterns found" }}
      </div>
      <div
        class="text-body2 tw:max-w-[31.25rem] q-mb-md"
        :class="store.state.theme === 'dark' ? 'text-grey-6' : 'text-grey-8'"
      >
        <div v-if="totalLogsAnalyzed">
          {{ t("search.patternOnlyLogsAnalyzed", { count: totalLogsAnalyzed }) }}
        </div>
        <div class="q-mt-sm">
          {{ t("search.patternEmptyGuidance") }}
        </div>
      </div>

      <!-- Inline action buttons for empty state -->
      <div class="tw:flex tw:gap-[0.5rem] tw:flex-wrap tw:justify-center">
        <OButton
          variant="primary"
          size="sm"
          @click="$emit('widen-time-range')"
          data-test="patterns-patternlist-empty-widen-range"
        >
          <template #icon-left>
            <q-icon name="schedule" size="0.75rem" />
          </template>
          {{ t("search.patternWidenTimeRange") }}
        </OButton>
      </div>
    </div>

    <!-- Wildcard hover popover -->
    <WildcardValuePopover
      :visible="!!hoveredToken"
      :token="hoveredToken?.token ?? ''"
      :displayValues="hoveredToken?.displayValues ?? []"
      :anchorEl="hoveredToken?.anchorEl ?? null"
      @popoverEnter="onPopoverEnter"
      @popoverLeave="onPopoverLeave"
      @filter-value="(value: string, action: string) => $emit('filter-value', value, action as 'include' | 'exclude')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import PatternCard from "./PatternCard.vue";
import PatternSkeleton from "./PatternSkeleton.vue";
import WildcardValuePopover from "./WildcardValuePopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { exportPatternsAsCSV } from "./patternUtils";
import useWildcardHover from "./useWildcardHover";

const props = defineProps<{
  patterns: any[];
  loading: boolean;
  totalLogsAnalyzed?: number;
  wrap?: boolean;
  /** External scroll container passed to q-virtual-scroll's scroll-target. */
  scrollTarget?: HTMLElement | null;
}>();

const emit = defineEmits<{
  (e: "open-details", pattern: any, index: number): void;
  (e: "add-to-search", pattern: any, action: "include" | "exclude"): void;
  (e: "create-alert", pattern: any): void;
  (e: "filter-value", value: string, action: "include" | "exclude"): void;
  (e: "copy-sql", pattern: any): void;
  (e: "contextmenu", pattern: any, event: MouseEvent): void;
  (e: "widen-time-range"): void;
  (e: "keynav", direction: string, index: number): void;
}>();

const store = useStore();
const { t } = useI18n();
const $q = useQuasar();

const {
  hoveredToken,
  onPopoverEnter,
  onPopoverLeave,
} = useWildcardHover();

// Search/filter
const filterQuery = ref("");

// Anomaly toggle
const showAnomalyOnly = ref(false);

// Filter patterns by search query and anomaly toggle
const filteredPatterns = computed(() => {
  let result = props.patterns || [];

  if (showAnomalyOnly.value) {
    result = result.filter((p: any) => p.is_anomaly);
  }

  if (filterQuery.value.trim()) {
    const q = filterQuery.value.trim().toLowerCase();
    result = result.filter((p: any) =>
      (p.template ?? "").toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q),
    );
  }

  return result;
});

// Display patterns — maintain original index for event forwarding
const displayPatterns = computed(() => filteredPatterns.value);

const originalIndexMap = computed(() => {
  const map = new Map<number, number>();
  displayPatterns.value.forEach((p: any, i: number) => {
    const origIdx = props.patterns?.indexOf(p) ?? i;
    map.set(i, origIdx);
  });
  return map;
});

const displayIndex = (idx: number): number => {
  return originalIndexMap.value.get(idx) ?? idx;
};

const handleExportCsv = () => {
  try {
    const csv = exportPatternsAsCSV(filteredPatterns.value);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `log-patterns-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch {
    $q.notify({
      type: "negative",
      message: t("search.patternExportFailed") || "Failed to export patterns",
      timeout: 2000,
    });
  }
};

const handleKeyNav = (direction: string, index: number) => {
  emit("keynav", direction, index);
};
</script>
