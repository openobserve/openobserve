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
            <div class="text-body1 text-bold">{{ t("search.patternDetailsTitle") }}</div>
            <div
              class="text-caption"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              {{ t("search.patternXofY", { index: selectedPattern.index + 1, total: totalPatterns }) }}
            </div>
          </div>
          <div class="col-auto">
            <OButton
              variant="ghost"
              size="icon-circle"
              data-test="close-pattern-dialog"
              @click="$emit('update:modelValue', false)"
            >
              <q-icon name="cancel" />
            </OButton>
          </div>
        </div>
      </q-card-section>

      <q-separator />

      <!-- Content - Single Scrollable View -->
      <q-card-section
        class="tw:py-[0.375rem] tw:px-[0.625rem] tw:flex-1 tw:overflow-y-auto"
      >
        <!-- Statistics -->
        <div class="tw-mb-[1rem]">
          <div class="text-subtitle2 text-weight-medium tw-mb-[0.375rem]">
            {{ t("search.patternStatistics") }}
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
                    {{ t("search.patternOccurrences") }}
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
                    {{ t("search.patternPercentage") }}
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
            <div
              class="tw-rounded tw-border tw-border-solid tw-border-negative tw-px-3 tw-py-2 tw-flex tw-gap-3 tw-items-start"
              :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-white'"
            >
              <q-icon name="warning" color="negative" size="sm" class="tw-mt-[2px] tw-flex-shrink-0" />
              <div>
                <div class="text-weight-bold text-negative">{{ t("search.patternAnomalyDetected") }}</div>
                <div
                  class="text-caption q-mt-xs"
                  :class="store.state.theme === 'dark' ? 'text-grey-4' : 'text-grey-8'"
                >
                  {{ anomalyExplanationForSelected }}
                </div>
                <div
                  v-if="selectedPattern.pattern.z_score !== undefined && selectedPattern.pattern.z_score < -1.5 && selectedPattern.pattern.avg_frequency"
                  class="text-caption q-mt-xs"
                  :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                >
                  {{ t("search.patternZScore", { zScore: selectedPattern.pattern.z_score.toFixed(2), avgFrequency: Math.round(selectedPattern.pattern.avg_frequency).toLocaleString() }) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Variables Summary -->
        <div class="tw-mb-[1rem]">
          <div class="text-subtitle2 text-weight-medium tw-mb-[0.375rem]">
            {{ t("search.patternVariablesHeader") }}
          </div>
          <div
            class="tw:px-[0.625rem] tw:py-[0.375rem] tw:rounded tw:border-l-[0.25rem] tw:border-solid tw:border-l-[var(--q-primary)]"
            :class="
              store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'
            "
          >
            {{
              selectedPattern.pattern.examples?.[0]?.variables
                ? t("search.patternVariablesDetected", { count: Object.keys(selectedPattern.pattern.examples[0].variables).length })
                : t("search.patternNoVariablesDetected")
            }}
          </div>
        </div>

        <!-- Pattern Template -->
        <div class="tw-mb-[1rem]">
          <div class="text-subtitle2 text-weight-medium tw-mb-[0.375rem]">
            {{ t("search.patternTemplate") }}
          </div>
          <div
            class="tw-px-[0.625rem] tw-py-[0.375rem] pattern-detail-text tw-text-[0.8125rem] tw-leading-[1.6] tw-rounded tw-border-l-[0.25rem] tw-border-solid tw-border-l-[var(--q-primary)] tw-break-all tw-flex tw-flex-wrap tw-items-baseline tw-gap-x-[2px] tw-gap-y-[2px]"
            :class="
              store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'
            "
          >
            <template v-for="(tok, i) in selectedTemplateTokens" :key="i">
              <span v-if="tok.kind === 'text'" class="tw-whitespace-pre">{{ tok.value }}</span>
              <q-chip
                v-else
                dense
                size="xs"
                class="wildcard-chip-detail q-my-none q-mx-none"
                :class="wildcardChipColor(tok.value)"
              >
                {{ tok.value }}
                <q-tooltip
                  v-if="tok.sampleValues.length > 0"
                  anchor="bottom middle"
                  self="top middle"
                  :delay="300"
                >
                  <div class="tw-font-mono tw-text-xs">
                    <div class="tw-font-semibold tw-mb-1">{{ t("search.patternWildcardSampleValues") }}</div>
                    <div
                      v-for="(val, vi) in tok.sampleValues.slice(0, 10)"
                      :key="vi"
                      class="tw-truncate tw-max-w-[26rem]"
                    >
                      {{ val }}
                    </div>
                  </div>
                </q-tooltip>
              </q-chip>
            </template>
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
          <div class="text-subtitle2 text-weight-medium tw-mb-[0.375rem]">
            {{ t("search.patternVariablesWithCount", { count: selectedPattern.pattern.variables.length }) }}
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
          <div class="text-subtitle2 text-weight-medium tw-mb-[0.375rem]">
            {{ t("search.patternExampleLogsWithCount", { count: selectedPattern.pattern.examples.length }) }}
          </div>
          <div
            v-for="(example, exIdx) in selectedPattern.pattern.examples"
            :key="exIdx"
            class="tw:px-[0.625rem] tw:py-[0.375rem] tw:mb-[0.375rem] pattern-detail-text tw:text-[0.75rem] tw:leading-[1.6] tw:rounded tw:break-all tw:whitespace-pre-wrap tw:border-l-[0.1875rem] tw:border-solid"
            :class="[
              store.state.theme === 'dark' ? 'bg-grey-10 tw:border-l-[#3a3a3a]' : 'bg-grey-1 tw:border-l-[#e0e0e0]'
            ]"
          >
            <LogsHighLighting
              :data="example.log_message"
              :show-braces="false"
              :show-quotes="false"
              :query-string="''"
              :simple-mode="false"
            />
          </div>
        </div>
      </q-card-section>

      <!-- Footer Navigation -->
      <q-separator />
      <q-card-section class="tw:px-[0.625rem] tw:py-[0.375rem]">
        <div class="row items-center no-wrap justify-between">
          <div class="col-auto">
            <OButton
              variant="outline"
              size="sm"
              data-test="pattern-detail-previous-btn"
              :disabled="selectedPattern.index === 0"
              @click="$emit('navigate', false, true)"
            >
              <template #icon-left><q-icon name="navigate_before" /></template>
              {{ t('search.patternNavPrevious') }}
            </OButton>
          </div>
          <div class="col-auto text-center">
            <span class="text-caption text-grey-7">
              {{ t("search.patternXofYShort", { index: selectedPattern.index + 1, total: totalPatterns }) }}
            </span>
          </div>
          <div class="col-auto">
            <OButton
              variant="outline"
              size="sm"
              data-test="pattern-detail-next-btn"
              :disabled="selectedPattern.index >= totalPatterns - 1"
              @click="$emit('navigate', true, false)"
            >
              {{ t('search.patternNavNext') }}
              <template #icon-right><q-icon name="navigate_next" /></template>
            </OButton>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">

import { computed } from "vue";
import { useStore } from "vuex";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import {
  tokenizeTemplate,
  wildcardChipColor,
  anomalyExplanation,
} from "@/composables/useLogs/useTemplateTokenizer";

const props = defineProps<{
  modelValue: boolean;
  selectedPattern: { pattern: any; index: number } | null;
  totalPatterns: number;
}>();

defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "navigate", next: boolean, prev: boolean): void;
}>();

const store = useStore();
const { t } = useI18n();

const selectedTemplateTokens = computed(() =>
  tokenizeTemplate(
    props.selectedPattern?.pattern?.template ?? "",
    props.selectedPattern?.pattern?.wildcard_values ?? [],
  ),
);

const anomalyExplanationForSelected = computed(() =>
  anomalyExplanation(props.selectedPattern?.pattern ?? {}, t),
);

const variableColumns = computed(() => [
  {
    name: "name",
    label: t("search.patternVariableNameColumn"),
    field: "name",
    align: "left",
  },
  {
    name: "type",
    label: t("search.patternVariableTypeColumn"),
    field: "var_type",
    align: "left",
  },
]);
</script>

<style lang="scss">
@import "@/assets/styles/log-highlighting.css";
</style>

<style scoped lang="scss">
.pattern-detail-text {
  font-family: monospace;
}

.wildcard-chip-detail {
  font-family: monospace;
  font-size: 11px;
  height: 18px;
  padding: 0 5px;
  border-radius: 3px;
  line-height: 18px;
  flex-shrink: 0;
}
</style>
