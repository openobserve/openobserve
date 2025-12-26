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
  <div class="tw:flex-1 tw:overflow-hidden">
    <!-- Patterns Table -->
    <div v-if="patterns?.length > 0" class="tw:flex tw:flex-col tw:h-full">
      <!-- Table Header -->
      <div
        class="tw:flex tw:items-center tw:border-b tw:border-[var(--o2-border-color)] tw:sticky tw:top-0 tw:z-10"
        style="background: var(--o2-table-header-bg); min-width: 100%;"
      >
        <!-- Pattern Column Header -->
        <div class="tw:flex-1 tw:min-w-0 tw:px-2 tw:relative table-head tw:text-ellipsis tw:text-left">
          <span
            class="tw:font-bold"
            :class="store.state.theme === 'dark' ? 'text-white' : 'text-grey-8'"
          >
            {{ t("search.patternColumnHeader") }}
          </span>
        </div>

        <!-- Occurrence Column Header -->
        <div class="tw:w-16 tw:flex-shrink-0 tw:px-2 tw:relative table-head tw:text-ellipsis tw:text-right">
          <span
            class="tw:font-bold"
            :class="store.state.theme === 'dark' ? 'text-white' : 'text-grey-8'"
          >
            {{ t("search.occurrenceColumnHeader") }}
          </span>
        </div>

        <!-- Percentage Column Header -->
        <div class="tw:w-14 tw:flex-shrink-0 tw:px-2 tw:relative table-head tw:text-ellipsis tw:text-right">
          <span
            class="tw:font-bold"
            :class="store.state.theme === 'dark' ? 'text-white' : 'text-grey-8'"
          >
            {{ t("search.percentageColumnHeader") }}
          </span>
        </div>

        <!-- Actions Column - No Header -->
        <div class="tw:w-20 tw:flex-shrink-0 tw:px-2 tw:relative table-head">
        </div>
      </div>

      <!-- Patterns List with Virtual Scroll -->
      <q-virtual-scroll
        :items="patterns"
        virtual-scroll-slice-size="5"
        v-slot="{ item: pattern, index }"
        class="tw:flex-1"
      >
        <PatternCard
          :pattern="pattern"
          :index="index"
          @click="$emit('open-details', pattern, index)"
          @include="$emit('add-to-search', pattern, 'include')"
          @exclude="$emit('add-to-search', pattern, 'exclude')"
        />
      </q-virtual-scroll>
    </div>

    <!-- Loading State -->
    <div
      v-else-if="loading"
      class="tw:flex-1 tw:flex tw:flex-col tw:items-center tw:justify-center"
    >
      <q-spinner-hourglass color="primary" size="3.125rem" />
      <div
        class="q-mt-md text-body2"
        :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
      >
        Extracting patterns from logs...
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-else
      class="tw:flex-1 tw:flex tw:flex-col tw:items-center tw:justify-center tw:p-[1.25rem] tw:text-center"
    >
      <div class="tw:text-[3rem] tw:mb-[1rem] tw:opacity-30">📊</div>
      <div
        class="text-h6 q-mb-sm"
        :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
      >
        No patterns found
      </div>
      <div
        class="text-body2 tw:max-w-[31.25rem]"
        :class="store.state.theme === 'dark' ? 'text-grey-6' : 'text-grey-8'"
      >
        <div v-if="totalLogsAnalyzed">
          Only {{ totalLogsAnalyzed }} logs were analyzed.
        </div>
        <div class="q-mt-sm">
          Try increasing the time range or selecting a different stream with
          more log data.
          <br />Pattern extraction works best with at least 1000+ logs.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import PatternCard from "./PatternCard.vue";

defineProps<{
  patterns: any[];
  loading: boolean;
  totalLogsAnalyzed?: number;
}>();

defineEmits<{
  (e: "open-details", pattern: any, index: number): void;
  (e: "add-to-search", pattern: any, action: "include" | "exclude"): void;
}>();

const store = useStore();
const { t} = useI18n();
</script>
