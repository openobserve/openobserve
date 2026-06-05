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
    <!-- Patterns Table — hidden during loading so skeleton always shows on re-run -->
    <div v-if="!loading && patterns?.length > 0" class="tw:flex tw:flex-col">
      <!-- Table Header -->
      <div
        class="tw:flex tw:items-center tw:border-b tw:border-[var(--o2-border-color)]"
        style="background: var(--o2-table-header-bg); min-width: 100%"
      >
        <!-- Pattern Column Header -->
        <div
          class="tw:flex-1 tw:min-w-0 tw:px-2 tw:relative table-head tw:text-ellipsis tw:text-left"
        >
          <span
            class="tw:font-bold"
            :class="store.state.theme === 'dark' ? 'text-white' : 'tw:text-gray-500'"
          >
            {{ t("search.patternColumnHeader") }}
          </span>
        </div>

        <!-- Count & Percentage Column Header -->
        <div
          class="tw:w-24 tw:flex-shrink-0 tw:px-2 tw:relative table-head tw:text-ellipsis tw:text-right"
        >
          <span
            class="tw:font-bold"
            :class="store.state.theme === 'dark' ? 'text-white' : 'tw:text-gray-500'"
          >
            {{ t("search.occurrenceColumnHeader") }}
          </span>
        </div>

        <!-- Actions Column - No Header -->
        <div
          class="tw:w-24 tw:flex-shrink-0 tw:px-2 tw:relative table-head"
        ></div>
      </div>

      <!-- Patterns List: plain render when wrap is on (variable row heights break virtual scroll) -->
      <template v-if="wrap">
        <PatternCard
          v-for="(pattern, index) in patterns"
          :key="pattern.pattern_id ?? index"
          :pattern="pattern"
          :index="index"
          :wrap="wrap"
          @click="$emit('open-details', pattern, index)"
          @include="$emit('add-to-search', pattern, 'include')"
          @exclude="$emit('add-to-search', pattern, 'exclude')"
          @create-alert="$emit('create-alert', pattern)"
        />
      </template>

      <!-- Patterns List with Virtual Scroll (wrap off) -->
      <OVirtualScroll
        v-else
        :items="patterns"
        :overscan="5"
        :scroll-target="scrollTarget ?? null"
        :dynamic-row-height="true"
      >
        <template #default="{ item: pattern, index }">
          <PatternCard
            :pattern="pattern"
            :index="index"
            :wrap="wrap"
            @click="$emit('open-details', pattern, index)"
            @include="$emit('add-to-search', pattern, 'include')"
            @exclude="$emit('add-to-search', pattern, 'exclude')"
            @create-alert="$emit('create-alert', pattern)"
          />
        </template>
      </OVirtualScroll>
    </div>

    <!-- Loading State — Skeleton Rows (same shimmer style as logs table) -->
    <div
      v-else-if="loading"
      class="tw:flex tw:flex-col"
      data-test="pattern-list-loading-skeleton"
      aria-busy="true"
      aria-live="polite"
      aria-label="Extracting patterns from logs"
    >
      <!-- Header skeleton -->
      <div
        class="pattern-skel-header tw:flex tw:items-center tw:border-b tw:border-[var(--o2-border-color)]"
        style="background: var(--o2-table-header-bg); min-width: 100%"
      >
        <div class="tw:flex-1 tw:min-w-0 tw:px-2">
          <span class="pattern-skel-pill tw:inline-block tw:h-3 tw:w-16 tw:rounded-sm" aria-hidden="true" />
        </div>
        <div class="tw:w-24 tw:flex-shrink-0 tw:px-2 tw:flex tw:justify-end">
          <span class="pattern-skel-pill tw:inline-block tw:h-3 tw:w-14 tw:rounded-sm" aria-hidden="true" />
        </div>
        <div class="tw:w-20 tw:flex-shrink-0 tw:px-2" />
      </div>

      <!-- Skeleton rows mimicking PatternCard layout -->
      <div
        v-for="(skeletonWidth, n) in SKELETON_WIDTHS"
        :key="n"
        class="pattern-skel-row tw:flex tw:items-center tw:border-b tw:border-[var(--o2-border-color)] tw:relative"
        :style="{ animationDelay: `${n * 40}ms` }"
      >
        <!-- Left accent bar -->
        <span class="tw:absolute tw:left-0 tw:inset-y-0 tw:w-1 pattern-skel-pill" aria-hidden="true" />
        <!-- Pattern column -->
        <div class="tw:flex-1 tw:min-w-0 tw:px-2 tw:pl-3">
          <span class="pattern-skel-pill tw:inline-block tw:h-3 tw:rounded-sm" :class="skeletonWidth" aria-hidden="true" />
        </div>
        <!-- Count column -->
        <div class="tw:w-24 tw:flex-shrink-0 tw:px-2 tw:flex tw:flex-col tw:items-end tw:gap-1">
          <span class="pattern-skel-pill tw:inline-block tw:h-3 tw:w-12 tw:rounded-sm" aria-hidden="true" />
          <span class="pattern-skel-pill tw:inline-block tw:h-2 tw:w-10 tw:rounded-sm" aria-hidden="true" />
        </div>
        <!-- Actions column — 3 icon-sized circles -->
        <div class="tw:w-20 tw:flex-shrink-0 tw:px-2 tw:flex tw:items-center tw:justify-center tw:gap-1">
          <span
            v-for="i in 3"
            :key="i"
            class="pattern-skel-pill tw:inline-block tw:w-7 tw:h-7 tw:rounded-full tw:shrink-0"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-else
      class="tw:flex-1 tw:flex tw:flex-col tw:items-center tw:justify-center tw:p-[1.25rem] tw:text-center"
    >
      <div class="tw:text-[3rem] tw:mb-[1rem] tw:opacity-30">📊</div>
      <div
        class="tw:text-xl tw:font-semibold tw:mb-2"
        :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-400'"
      >
        No patterns found
      </div>
      <div
        class="tw:text-sm tw:max-w-[31.25rem]"
        :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
      >
        <div v-if="totalLogsAnalyzed">
          Only {{ totalLogsAnalyzed }} logs were analyzed.
        </div>
        <div class="tw:mt-2">
          Try increasing the time range or selecting a different stream with
          more log data.
          <br />Pattern extraction works best with at least 1000+ logs.
        </div>
      </div>
    </div>

    <!-- Bottom spacer so the last row isn't flush with the container edge -->
    <div v-if="!loading && patterns?.length > 0" class="tw:h-4" />

    <!-- Wildcard hover popover (outside q-virtual-scroll to avoid DOM recycling conflicts) -->
    <WildcardValuePopover
      :visible="!!hoveredToken"
      :token="hoveredToken?.token ?? ''"
      :displayValues="hoveredToken?.displayValues ?? []"
      :anchorEl="hoveredToken?.anchorEl ?? null"
      @popoverEnter="onPopoverEnter"
      @popoverLeave="onPopoverLeave"
      @filter-value="(value, action) => $emit('filter-value', value, action)"
    />
  </div>
</template>

<script setup lang="ts">
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import PatternCard from "./PatternCard.vue";
import WildcardValuePopover from "./WildcardValuePopover.vue";
import useWildcardHover from "./useWildcardHover";
import OVirtualScroll from "@/lib/core/VirtualScroll/OVirtualScroll.vue";

const SKELETON_WIDTHS = [
  "tw:w-3/4",
  "tw:w-2/3",
  "tw:w-11/12",
  "tw:w-1/2",
  "tw:w-5/6",
  "tw:w-7/12",
  "tw:w-4/5",
  "tw:w-2/3",
  "tw:w-3/4",
  "tw:w-9/12",
  "tw:w-1/2",
  "tw:w-5/6",
  "tw:w-7/12",
  "tw:w-11/12",
  "tw:w-3/5",
  "tw:w-4/5",
  "tw:w-2/3",
  "tw:w-3/4",
  "tw:w-1/2",
  "tw:w-5/6",
];

const props = defineProps<{
  patterns: any[];
  loading: boolean;
  totalLogsAnalyzed?: number;
  wrap?: boolean;
  /** External scroll container passed to q-virtual-scroll's scroll-target. */
  scrollTarget?: HTMLElement | null;
}>();

defineEmits<{
  (e: "open-details", pattern: any, index: number): void;
  (e: "add-to-search", pattern: any, action: "include" | "exclude"): void;
  (e: "create-alert", pattern: any): void;
  (e: "filter-value", value: string, action: "include" | "exclude"): void;
}>();

const store = useStore();
const { t } = useI18n();

const {
  hoveredToken,
  onPopoverEnter,
  onPopoverLeave,
} = useWildcardHover();
</script>

<style scoped lang="scss">
// ── Pattern list loading skeleton ────────────────────────────────────────
// Matches the shimmer style used by the logs table (TenstackTable.vue)
// but at the slightly lighter grey-100 / grey-600 palette for visual parity.

.pattern-skel-header {
  min-height: 2rem;
}

.pattern-skel-row {
  opacity: 0;
  height: 2rem;
  animation: pattern-skel-row-in 320ms ease-out forwards;
  background-color: var(--o2-log-table-row-bg, transparent);
}

.pattern-skel-pill {
  background: linear-gradient(
    90deg,
    var(--color-grey-100) 0%,
    rgba(255, 255, 255, 0.65) 50%,
    var(--color-grey-100) 100%
  );
  background-size: 200% 100%;
  animation: pattern-skel-shimmer 1.5s ease-in-out infinite;

  .body--dark & {
    background: linear-gradient(
      90deg,
      var(--color-grey-600) 0%,
      rgba(255, 255, 255, 0.03) 50%,
      var(--color-grey-600) 100%
    );
  }
}

@keyframes pattern-skel-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes pattern-skel-row-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .pattern-skel-row  { opacity: 1; animation: none; }
  .pattern-skel-pill { animation: none; }
}
</style>
