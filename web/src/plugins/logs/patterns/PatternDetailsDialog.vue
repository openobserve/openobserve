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
  <q-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    position="right"
    full-height
    maximized
  >
    <q-card
      v-if="selectedPattern"
      class="column full-height no-wrap detail-table-dialog tw:w-[90vw]! tw:max-w-[90vw]! tw:border-t-4 tw:border-t-[var(--q-primary)] tw:border-solid"
    >
      <!-- Header -->
      <q-card-section class="q-px-md q-pb-sm">
        <div class="row items-center no-wrap">
          <div class="col">
            <div class="text-body1 text-bold">Pattern Details</div>
            <div
              class="text-caption"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              Pattern {{ selectedPattern.index + 1 }} of {{ totalPatterns }}
            </div>
          </div>
          <div class="col-auto">
            <q-btn
              v-close-popup="true"
              round
              flat
              icon="cancel"
              data-test="close-pattern-dialog"
            />
          </div>
        </div>
      </q-card-section>

      <q-separator />

      <!-- Content - Single Scrollable View -->
      <q-card-section
        class="tw:py-[0.375rem] tw:px-[0.625rem] tw:flex-1 tw:overflow-y-auto"
      >
        <!-- Statistics -->
        <div class="tw:mb-[1rem]">
          <div class="text-subtitle2 text-weight-medium tw:mb-[0.375rem]">
            Statistics
          </div>
          <div class="row q-col-gutter-md">
            <div class="col-6">
              <q-card
                flat
                class="tw:bg-[var(--o2-card-bg)] tw:border tw:border-solid tw:border-[var(--o2-border-color)]"
              >
                <q-card-section class="tw:p-[0.375rem]">
                  <div
                    class="text-caption"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-7'
                    "
                  >
                    Occurrences
                  </div>
                  <div
                    class="text-h5 text-weight-bold text-primary q-mt-xs"
                  >
                    {{
                      selectedPattern.pattern.frequency.toLocaleString()
                    }}
                  </div>
                </q-card-section>
              </q-card>
            </div>
            <div class="col-6">
              <q-card flat class="tw:bg-[var(--o2-card-bg)] tw:border tw:border-solid tw:border-[var(--o2-border-color)]">
                <q-card-section class="tw:p-[0.375rem]">
                  <div
                    class="text-caption"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-7'
                    "
                  >
                    Percentage
                  </div>
                  <div
                    class="text-h5 text-weight-bold text-primary q-mt-xs"
                  >
                    {{ selectedPattern.pattern.percentage.toFixed(2) }}%
                  </div>
                </q-card-section>
              </q-card>
            </div>
          </div>
          <div
            v-if="selectedPattern.pattern.is_anomaly"
            class="q-mt-md"
          >
            <q-banner class="bg-negative text-white">
              <template v-slot:avatar>
                <q-icon name="warning" size="md" />
              </template>
              This pattern is detected as an anomaly
            </q-banner>
          </div>
        </div>

        <!-- Variables Summary -->
        <div class="tw:mb-[1rem]">
          <div class="text-subtitle2 text-weight-medium tw:mb-[0.375rem]">
            Variables
          </div>
          <div
            class="tw:px-[0.625rem] tw:py-[0.375rem] tw:rounded tw:border-l-[0.25rem] tw:border-solid tw:border-l-[var(--q-primary)]"
            :class="
              store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'
            "
          >
            {{
              selectedPattern.pattern.examples?.[0]?.variables
                ? Object.keys(selectedPattern.pattern.examples[0].variables).length + " variable(s) detected"
                : "No variables detected"
            }}
          </div>
        </div>

        <!-- Pattern Template -->
        <div class="tw:mb-[1rem]">
          <div class="text-subtitle2 text-weight-medium tw:mb-[0.375rem]">
            Pattern Template
          </div>
          <div
            class="tw:px-[0.625rem] tw:py-[0.375rem] pattern-detail-text tw:text-[0.8125rem] tw:leading-[1.6] tw:rounded tw:border-l-[0.25rem] tw:border-solid tw:border-l-[var(--q-primary)] tw:break-all tw:whitespace-pre-wrap"
            :class="
              store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'
            "
          >
            {{ selectedPattern.pattern.template }}
          </div>
        </div>

        <!-- Variables -->
        <div
          v-if="
            selectedPattern.pattern.variables &&
            selectedPattern.pattern.variables.length > 0
          "
          class="tw:mb-[1rem]"
        >
          <div class="text-subtitle2 text-weight-medium tw:mb-[0.375rem]">
            Variables ({{ selectedPattern.pattern.variables.length }})
          </div>
          <q-table
            :rows="selectedPattern.pattern.variables"
            :columns="variableColumns"
            :row-key="(row: any) => 'var_' + row.index"
            :rows-per-page-options="[0]"
            class="q-table o2-quasar-table o2-row-md tw:w-full tw:border tw:border-solid tw:border-[var(--o2-border-color)]"
            dense
          >
            <template v-slot:body-cell-name="props">
              <q-td
                class="text-left text-weight-bold text-primary"
              >
                {{ props.row.name || "var_" + props.row.index }}
              </q-td>
            </template>

            <template v-slot:body-cell-type="props">
              <q-td class="text-left">
                <q-chip
                  size="sm"
                  :class="
                    store.state.theme === 'dark' ? 'bg-grey-8' : 'bg-grey-3'
                  "
                >
                  {{ props.row.var_type || "unknown" }}
                </q-chip>
              </q-td>
            </template>
          </q-table>
        </div>

        <!-- Example Logs -->
        <div
          v-if="
            selectedPattern.pattern.examples &&
            selectedPattern.pattern.examples.length > 0
          "
          class="tw:mb-[1rem]"
        >
          <div class="text-subtitle2 text-weight-medium tw:mb-[0.375rem]">
            Example Logs ({{ selectedPattern.pattern.examples.length }})
          </div>
          <div
            v-for="(example, exIdx) in selectedPattern.pattern.examples"
            :key="exIdx"
            class="tw:px-[0.625rem] tw:py-[0.375rem] tw:mb-[0.375rem] pattern-detail-text tw:text-[0.75rem] tw:leading-[1.6] tw:rounded tw:break-all tw:whitespace-pre-wrap tw:border-l-[0.1875rem] tw:border-solid"
            :class="[
              store.state.theme === 'dark' ? 'bg-grey-10 tw:border-l-[#3a3a3a]' : 'bg-grey-1 tw:border-l-[#e0e0e0]'
            ]"
          >
            {{ example.log_message }}
          </div>
        </div>
      </q-card-section>

      <!-- Footer Navigation -->
      <q-separator />
      <q-card-section class="tw:px-[0.625rem] tw:py-[0.375rem]">
        <div class="row items-center no-wrap justify-between">
          <div class="col-auto">
            <q-btn
              data-test="pattern-detail-previous-btn"
              class="o2-secondary-button tw:h-[36px]"
              no-caps
              :disabled="selectedPattern.index === 0"
              @click="$emit('navigate', false, true)"
              icon="navigate_before"
              label="Previous"
            />
          </div>
          <div class="col-auto text-center">
            <span class="text-caption text-grey-7">
              {{ selectedPattern.index + 1 }} of {{ totalPatterns }}
            </span>
          </div>
          <div class="col-auto">
            <q-btn
              data-test="pattern-detail-next-btn"
              class="o2-secondary-button tw:h-[36px]"
              no-caps
              :disabled="selectedPattern.index >= totalPatterns - 1"
              @click="$emit('navigate', true, false)"
              icon-right="navigate_next"
              label="Next"
            />
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { useStore } from "vuex";

defineProps<{
  modelValue: boolean;
  selectedPattern: { pattern: any; index: number } | null;
  totalPatterns: number;
}>();

defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "navigate", next: boolean, prev: boolean): void;
}>();

const store = useStore();

const variableColumns = [
  {
    name: "name",
    label: "Variable Name",
    field: "name",
    align: "left",
  },
  {
    name: "type",
    label: "Type",
    field: "var_type",
    align: "left",
  },
];
</script>

<style scoped lang="scss">
.pattern-detail-text {
  font-family: monospace;
}
</style>
