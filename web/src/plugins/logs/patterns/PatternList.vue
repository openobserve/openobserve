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
  <div style="flex: 1; overflow: hidden" class="tw-py-[0.375rem]">
    <!-- Patterns List with Virtual Scroll -->
    <q-virtual-scroll
      v-if="patterns?.length > 0"
      :items="patterns"
        virtual-scroll-slice-size="5"
        v-slot="{ item: pattern, index }"
        style="height: 100%"
        class="tw-pl-[0.375rem] tw-pr-[0.625rem]"
      >
        <PatternCard
          :pattern="pattern"
          :index="index"
          @click="$emit('open-details', pattern, index)"
          @include="$emit('add-to-search', pattern, 'include')"
          @exclude="$emit('add-to-search', pattern, 'exclude')"
        />
      </q-virtual-scroll>

    <!-- Loading State -->
    <div
      v-else-if="loading"
      style="
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      "
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
      style="
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 1.25rem;
        text-align: center;
      "
    >
      <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.3">📊</div>
      <div
        class="text-h6 q-mb-sm"
        :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
      >
        No patterns found
      </div>
      <div
        class="text-body2"
        :class="store.state.theme === 'dark' ? 'text-grey-6' : 'text-grey-8'"
        style="max-width: 31.25rem"
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
</script>
