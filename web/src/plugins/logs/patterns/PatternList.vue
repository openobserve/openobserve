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
  <div class="flex flex-col">
    <!-- Patterns Table — hidden during loading so skeleton always shows on re-run -->
    <div v-if="!loading && patterns?.length > 0" class="flex flex-col">
      <!-- Table Header -->
      <div
        class="flex items-center border-b border-[var(--o2-border-color)]"
        style="background: var(--o2-table-header-bg); min-width: 100%"
      >
        <!-- Pattern Column Header -->
        <div
          class="flex-1 min-w-0 px-2 relative table-head text-ellipsis text-left"
        >
          <span
            class="font-bold"
            :class="store.state.theme === 'dark' ? 'text-white' : 'text-gray-500'"
          >
            {{ t("search.patternColumnHeader") }}
          </span>
        </div>

        <!-- Count & Percentage Column Header -->
        <div
          class="w-24 flex-shrink-0 px-2 relative table-head text-ellipsis text-right"
        >
          <span
            class="font-bold"
            :class="store.state.theme === 'dark' ? 'text-white' : 'text-gray-500'"
          >
            {{ t("search.occurrenceColumnHeader") }}
          </span>
        </div>

        <!-- Actions Column - No Header -->
        <div
          class="w-24 flex-shrink-0 px-2 relative table-head"
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
      class="flex flex-col"
      data-test="pattern-list-loading-skeleton"
      aria-busy="true"
      aria-live="polite"
      aria-label="Extracting patterns from logs"
    >
      <!-- Header skeleton -->
      <div
        class="min-h-8 flex items-center border-b border-[var(--o2-border-color)]"
        style="background: var(--o2-table-header-bg); min-width: 100%"
      >
        <div class="flex-1 min-w-0 px-2">
          <span class="pattern-skel-pill inline-block h-3 w-16 rounded-sm" aria-hidden="true" />
        </div>
        <div class="w-24 flex-shrink-0 px-2 flex justify-end">
          <span class="pattern-skel-pill inline-block h-3 w-14 rounded-sm" aria-hidden="true" />
        </div>
        <div class="w-20 flex-shrink-0 px-2" />
      </div>

      <!-- Skeleton rows mimicking PatternCard layout -->
      <div
        v-for="(skeletonWidth, n) in SKELETON_WIDTHS"
        :key="n"
        class="pattern-skel-row flex items-center border-b border-[var(--o2-border-color)] relative opacity-0 h-8 bg-[var(--o2-log-table-row-bg,transparent)]"
        :style="{ animationDelay: `${n * 40}ms` }"
      >
        <!-- Left accent bar -->
        <span class="absolute left-0 inset-y-0 w-1 pattern-skel-pill" aria-hidden="true" />
        <!-- Pattern column -->
        <div class="flex-1 min-w-0 px-2 pl-3">
          <span class="pattern-skel-pill inline-block h-3 rounded-sm" :class="skeletonWidth" aria-hidden="true" />
        </div>
        <!-- Count column -->
        <div class="w-24 flex-shrink-0 px-2 flex flex-col items-end gap-1">
          <span class="pattern-skel-pill inline-block h-3 w-12 rounded-sm" aria-hidden="true" />
          <span class="pattern-skel-pill inline-block h-2 w-10 rounded-sm" aria-hidden="true" />
        </div>
        <!-- Actions column — 3 icon-sized circles -->
        <div class="w-20 flex-shrink-0 px-2 flex items-center justify-center gap-1">
          <span
            v-for="i in 3"
            :key="i"
            class="pattern-skel-pill inline-block w-7 h-7 rounded-full shrink-0"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-else
      class="flex-1 flex flex-col items-center justify-center p-[1.25rem] text-center"
    >
      <div class="text-[3rem] mb-[1rem] opacity-30">📊</div>
      <div
        class="text-xl font-semibold mb-2"
        :class="store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-400'"
      >
        No patterns found
      </div>
      <div
        class="text-sm max-w-[31.25rem]"
        :class="store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-500'"
      >
        <div v-if="totalLogsAnalyzed">
          Only {{ totalLogsAnalyzed }} logs were analyzed.
        </div>
        <div class="mt-2">
          Try increasing the time range or selecting a different stream with
          more log data.
          <br />Pattern extraction works best with at least 1000+ logs.
        </div>
      </div>
    </div>

    <!-- Bottom spacer so the last row isn't flush with the container edge -->
    <div v-if="!loading && patterns?.length > 0" class="h-4" />

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
  "w-3/4",
  "w-2/3",
  "w-11/12",
  "w-1/2",
  "w-5/6",
  "w-7/12",
  "w-4/5",
  "w-2/3",
  "w-3/4",
  "w-9/12",
  "w-1/2",
  "w-5/6",
  "w-7/12",
  "w-11/12",
  "w-3/5",
  "w-4/5",
  "w-2/3",
  "w-3/4",
  "w-1/2",
  "w-5/6",
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

<style>
/* ── Pattern list loading skeleton ────────────────────────────────────────
   Matches the shimmer style used by the logs table (TenstackTable.vue)
   but at the slightly lighter grey-100 / grey-600 palette for visual parity. */

.pattern-skel-row {
  animation: pattern-skel-row-in 320ms ease-out forwards;
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
}

.body--dark .pattern-skel-pill {
  background: linear-gradient(
    90deg,
    var(--color-grey-600) 0%,
    rgba(255, 255, 255, 0.03) 50%,
    var(--color-grey-600) 100%
  );
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
