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
      class="detail-table-dialog"
      :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
      style="width: 70vw; max-width: 70vw"
    >
      <!-- Header -->
      <q-card-section
        class="q-pa-md"
        :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-1'"
      >
        <div class="row items-center">
          <div class="col">
            <div class="text-h6">Pattern Details</div>
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
              outline
              no-caps
              padding="xs md"
              icon="chevron_left"
              label="Previous"
              @click="$emit('navigate', false, true)"
              :disable="selectedPattern.index === 0"
              :class="
                store.state.theme === 'dark'
                  ? 'text-grey-5 border-grey-5'
                  : 'text-grey-7 border-grey-7'
              "
              class="q-mr-sm"
            />
            <q-btn
              outline
              no-caps
              padding="xs md"
              icon-right="chevron_right"
              label="Next"
              @click="$emit('navigate', true, false)"
              :disable="selectedPattern.index >= totalPatterns - 1"
              :class="
                store.state.theme === 'dark'
                  ? 'text-grey-5 border-grey-5'
                  : 'text-grey-7 border-grey-7'
              "
              class="q-mr-sm"
            />
            <q-btn
              flat
              round
              dense
              icon="close"
              @click="$emit('update:modelValue', false)"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            />
          </div>
        </div>
      </q-card-section>

      <q-separator />

      <!-- Content -->
      <q-card-section
        class="q-pa-md"
        style="height: calc(100vh - 100px); overflow-y: auto"
      >
        <!-- Statistics -->
        <div class="q-mb-lg">
          <div class="text-subtitle2 text-weight-medium q-mb-md">
            Statistics
          </div>
          <div class="row q-col-gutter-md">
            <div class="col-6">
              <q-card
                flat
                bordered
                :class="
                  store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-grey-2'
                "
              >
                <q-card-section class="q-pa-md">
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
                  <div class="text-h5 text-weight-bold text-primary q-mt-xs">
                    {{ selectedPattern.pattern.frequency.toLocaleString() }}
                  </div>
                </q-card-section>
              </q-card>
            </div>
            <div class="col-6">
              <q-card
                flat
                bordered
                :class="
                  store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-grey-2'
                "
              >
                <q-card-section class="q-pa-md">
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
                  <div class="text-h5 text-weight-bold text-primary q-mt-xs">
                    {{ selectedPattern.pattern.percentage.toFixed(2) }}%
                  </div>
                </q-card-section>
              </q-card>
            </div>
          </div>
          <div v-if="selectedPattern.pattern.is_anomaly" class="q-mt-md">
            <q-banner class="bg-negative text-white">
              <template v-slot:avatar>
                <q-icon name="warning" size="md" />
              </template>
              This pattern is detected as an anomaly
            </q-banner>
          </div>
        </div>

        <!-- Template -->
        <div class="q-mb-lg">
          <div class="text-subtitle2 text-weight-medium q-mb-md">
            Pattern Template
          </div>
          <div
            class="q-pa-md"
            :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'"
            style="
              font-family:
                &quot;Monaco&quot;, &quot;Menlo&quot;,
                &quot;Courier New&quot;, monospace;
              font-size: 0.8125rem;
              line-height: 1.6;
              border-radius: 0.25rem;
              border-left: 0.25rem solid;
              word-break: break-all;
              white-space: pre-wrap;
              border-color: var(--q-primary);
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
          class="q-mb-lg"
        >
          <div class="text-subtitle2 text-weight-medium q-mb-md">
            Variables ({{ selectedPattern.pattern.variables.length }})
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem">
            <q-chip
              v-for="variable in selectedPattern.pattern.variables"
              :key="variable.index"
              :class="store.state.theme === 'dark' ? 'bg-grey-8' : 'bg-grey-3'"
            >
              <span class="text-weight-bold text-primary">{{
                variable.name || "var_" + variable.index
              }}</span>
              <span
                class="q-mx-xs"
                :class="
                  store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                "
                >•</span
              >
              <span
                :class="
                  store.state.theme === 'dark' ? 'text-grey-4' : 'text-grey-7'
                "
                >{{ variable.var_type || "unknown" }}</span
              >
            </q-chip>
          </div>
        </div>

        <!-- Example Logs -->
        <div
          v-if="
            selectedPattern.pattern.examples &&
            selectedPattern.pattern.examples.length > 0
          "
          class="q-mb-lg"
        >
          <div class="text-subtitle2 text-weight-medium q-mb-md">
            Example Logs ({{ selectedPattern.pattern.examples.length }})
          </div>
          <div
            v-for="(example, exIdx) in selectedPattern.pattern.examples"
            :key="exIdx"
            class="q-pa-md q-mb-md"
            :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-1'"
            style="
              font-family:
                &quot;Monaco&quot;, &quot;Menlo&quot;,
                &quot;Courier New&quot;, monospace;
              font-size: 0.75rem;
              line-height: 1.6;
              border-radius: 0.25rem;
              word-break: break-all;
              white-space: pre-wrap;
              border-left: 0.1875rem solid;
            "
            :style="{
              borderColor:
                store.state.theme === 'dark' ? '#3a3a3a' : '#e0e0e0',
            }"
          >
            {{ example.log_message }}
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
</script>
