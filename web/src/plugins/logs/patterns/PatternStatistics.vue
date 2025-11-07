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
  <div class="tw-py-[0.375rem] tw-shrink-0 tw-bg-[var(--o2-hover-accent)]">
    <div class="row q-col-gutter-md !tw-ml-0">
      <!-- Logs Analyzed Card -->
      <div class="col-3 !tw-pl-0">
        <q-card
          flat
          :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-white'"
        >
          <q-card-section class="tw-py-[0.375rem] tw-px-[0.625rem]">
            <div
              class="text-caption"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              Logs Analyzed
            </div>
            <div class="row items-center q-mt-xs q-gutter-xs">
              <!-- View Mode -->
              <div
                v-if="!isEditingScanSize"
                class="row items-center no-wrap tw-m-0 tw-pl-1"
              >
                <div
                  class="tw-text-[1.5rem] tw-leading-[2rem] text-weight-bold text-primary tw-h-fit tw-pr-1"
                >
                  {{ scanSize.toLocaleString() }}
                </div>
                <q-btn
                  flat
                  round
                  dense
                  size="xs"
                  icon="edit"
                  @click="toggleEditScanSize"
                  :class="
                    store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                  "
                >
                  <q-tooltip>Edit scan size</q-tooltip>
                </q-btn>
              </div>

              <!-- Edit Mode -->
              <div
                v-else
                class="row items-center no-wrap logs-analyzed-input"
                style="gap: 0.25rem"
              >
                <q-input
                  v-model.number="localScanSize"
                  type="number"
                  dense
                  outlined
                  :min="100"
                  :max="20000"
                  class="!tw-text-[1.2rem] text-weight-bold"
                  style="max-width: 120px"
                  autofocus
                  @keyup.escape="cancelEditScanSize"
                  @blur="updateScanSize"
                />
              </div>
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Patterns Found Card -->
      <div class="col-3 !tw-pl-[0.375rem]">
        <q-card
          flat
          :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-white'"
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
            <div class="text-h5 text-weight-bold q-mt-xs text-primary">
              {{ statistics?.total_patterns_found || 0 }}
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Coverage Card -->
      <div class="col-3 !tw-pl-[0.375rem]">
        <q-card
          flat
          :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-white'"
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
            <div class="text-h5 text-weight-bold q-mt-xs text-primary">
              {{ (statistics?.coverage_percentage || 0).toFixed(1) }}%
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Processing Time Card -->
      <div class="col-3 !tw-pl-[0.375rem]">
        <q-card
          flat
          :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-white'"
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
            <div class="text-h5 text-weight-bold q-mt-xs text-primary">
              {{ statistics?.extraction_time_ms || 0 }}ms
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useStore } from "vuex";

const props = defineProps<{
  statistics: any;
  scanSize: number;
}>();

const emit = defineEmits<{
  (e: "update:scanSize", value: number): void;
}>();

const store = useStore();
const isEditingScanSize = ref(false);
const localScanSize = ref(props.scanSize);

const toggleEditScanSize = () => {
  isEditingScanSize.value = true;
  localScanSize.value = props.scanSize;
};

const cancelEditScanSize = () => {
  isEditingScanSize.value = false;
  localScanSize.value = props.scanSize;
};

const updateScanSize = () => {
  isEditingScanSize.value = false;
  if (localScanSize.value !== props.scanSize) {
    emit("update:scanSize", localScanSize.value);
  }
};

watch(
  () => props.scanSize,
  (newValue) => {
    localScanSize.value = newValue;
  },
);
</script>

<style scoped lang="scss">
@import "@/styles/logs/search-result.scss";
</style>
