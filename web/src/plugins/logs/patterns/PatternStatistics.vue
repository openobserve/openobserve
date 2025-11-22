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
  <div class="tw-py-[0.375rem] tw-shrink-0 tw-bg-[var(--o2-bg-gray)]" data-test="pattern-statistics">
    <div class="row q-col-gutter-md !tw-mx-[0.375rem]">
      <!-- Total Logs Scanned Card -->
      <div class="col-3 !tw-pl-0">
        <q-card
          flat
          class="tw-bg-[var(--o2-card-bg)]"
          data-test="pattern-stats-logs-scanned-card"
        >
          <q-card-section class="tw-py-[0.375rem] tw-px-[0.625rem]">
            <div
              class="text-caption"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              Total Logs Scanned
            </div>
            <div class="text-h5 text-weight-bold q-mt-xs text-primary" data-test="pattern-stats-logs-scanned-value">
              {{ (statistics?.total_logs_analyzed || 0).toLocaleString() }}
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Patterns Found Card -->
      <div class="col-3 !tw-pl-[0.375rem]">
        <q-card
          flat
          class="tw-bg-[var(--o2-card-bg)]"
          data-test="pattern-stats-patterns-found-card"
        >
          <q-card-section class="tw-py-[0.375rem] tw-px-[0.625rem]">
            <div
              class="text-caption"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              Patterns Found
            </div>
            <div class="text-h5 text-weight-bold q-mt-xs text-primary" data-test="pattern-stats-patterns-found-value">
              {{ statistics?.total_patterns_found || 0 }}
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Coverage Card -->
      <div class="col-3 !tw-pl-[0.375rem]">
        <q-card
          flat
          class="tw-bg-[var(--o2-card-bg)]"
          data-test="pattern-stats-coverage-card"
        >
          <q-card-section class="tw-py-[0.375rem] tw-px-[0.625rem]">
            <div
              class="text-caption"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              Coverage
            </div>
            <div class="text-h5 text-weight-bold q-mt-xs text-primary" data-test="pattern-stats-coverage-value">
              {{ (statistics?.coverage_percentage || 0).toFixed(1) }}%
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Processing Time Card -->
      <div class="col-3 !tw-pl-[0.375rem]">
        <q-card
          flat
          class="tw-bg-[var(--o2-card-bg)]"
          data-test="pattern-stats-processing-time-card"
        >
          <q-card-section class="tw-py-[0.375rem] tw-px-[0.625rem]">
            <div
              class="text-caption"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              Processing Time
            </div>
            <div class="text-h5 text-weight-bold q-mt-xs text-primary" data-test="pattern-stats-processing-time-value">
              {{ statistics?.extraction_time_ms || 0 }}ms
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from "vuex";

defineProps<{
  statistics: any;
}>();

const store = useStore();
</script>

<style scoped lang="scss">
@import "@/styles/logs/search-result.scss";
</style>
