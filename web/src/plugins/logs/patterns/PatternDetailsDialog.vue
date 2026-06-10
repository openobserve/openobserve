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
  <div>
    <ODrawer data-test="pattern-details-dialog"
    :open="modelValue"
    @update:open="$emit('update:modelValue', $event)"
    :width="90"
    :title="t('search.patternDetailsTitle')"
    :subTitle="selectedPattern ? t('search.patternXofY', { index: selectedPattern.index + 1, total: totalPatterns }) : undefined"
  >
    <template #header>
      <div class="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-0.5 tw:overflow-hidden">
        <!-- Row 1: level badge · title · token & slot OBadges (right of title) -->
        <div class="tw:flex tw:items-center tw:gap-2 tw:min-w-0">
          <span
            v-if="patternLevelInfo"
            class="tw:shrink-0 tw:inline-flex tw:items-center tw:px-1.5 tw:py-0.5 tw:rounded tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wide tw:text-white"
            :style="{ backgroundColor: patternLevelInfo.color }"
          >
            {{ patternLevelInfo.level }}
          </span>
          <h4 class="tw:font-semibold tw:text-[var(--o2-text-heading)] tw:truncate tw:min-w-0 tw:text-base tw:leading-tight tw:m-0">
            {{ selectedPattern?.pattern?.description || t('search.patternDetailsTitle') }}
          </h4>
          <template v-if="selectedPattern">
            <OBadge variant="default-soft" size="sm" class="tw:shrink-0">
              {{ selectedTemplateTokens.length }} {{ selectedTemplateTokens.length === 1 ? 'token' : 'tokens' }}
            </OBadge>
            <OBadge variant="default-soft" size="sm" class="tw:shrink-0">
              {{ patternWildcardCount }} {{ patternWildcardCount === 1 ? 'variable slot' : 'variable slots' }}
            </OBadge>
          </template>
        </div>
        <!-- Row 2: full-width module path, truncates at edge -->
        <code
          v-if="selectedPattern && patternPathToken"
          class="tw:block tw:w-full tw:truncate tw:text-[var(--o2-text-code)] tw:font-mono tw:text-[0.6875rem] tw:text-[var(--o2-text-caption)]"
        >{{ patternPathToken }}</code>
      </div>
    </template>
    <div class="tw:px-5 tw:py-3">
    <template v-if="selectedPattern">
        <!-- Statistics -->
        <div class="tw:mb-4">
          <div class="tw:text-sm tw:font-medium tw:mb-1.5">
            {{ t("search.patternStatistics") }}
          </div>
          <div class="tw:flex tw:gap-3">
            <div class="tw:w-1/2">
              <OCard
                class="tw:bg-[var(--o2-card-bg-solid)] tw:border tw:border-solid tw:border-[var(--o2-border-color)]"
              >
                <OCardSection class="tw:p-[0.375rem]">
                  <div
                    class="tw:text-xs"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:text-gray-400'
                        : 'tw:text-gray-400'
                    "
                  >
                    {{ t("search.patternOccurrences") }}
                  </div>
                  <div
                    class="tw:text-2xl tw:font-semibold text-weight-bold text-primary tw:mt-1"
                  >
                    {{
                      selectedPattern.pattern.frequency.toLocaleString()
                    }}
                  </div>
                </OCardSection>
              </OCard>
            </div>
            <div class="tw:w-1/2">
              <OCard class="tw:bg-[var(--o2-card-bg-solid)] tw:border tw:border-solid tw:border-[var(--o2-border-color)]">
                <OCardSection class="tw:p-[0.375rem]">
                  <div
                    class="tw:text-xs"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:text-gray-400'
                        : 'tw:text-gray-400'
                    "
                  >
                    {{ t("search.patternPercentage") }}
                  </div>
                  <div
                    class="tw:text-2xl tw:font-semibold text-weight-bold text-primary tw:mt-1"
                  >
                    {{ selectedPattern.pattern.percentage.toFixed(2) }}%
                  </div>
                </OCardSection>
              </OCard>
            </div>
          </div>
          <div
            v-if="selectedPattern.pattern.is_anomaly"
            class="tw:mt-3"
          >
            <div
              class="tw:rounded tw:border tw:border-solid tw:border-[var(--o2-status-error-border)] tw:px-3 tw:py-2 tw:flex tw:gap-3 tw:items-start"
              :class="store.state.theme === 'dark' ? 'tw:bg-gray-800' : 'tw:bg-white'"
            >
              <OIcon name="warning" size="sm" class="tw:mt-0.5 tw:shrink-0" />
              <div>
                <div class="text-weight-bold tw:text-red-500">{{ t("search.patternAnomalyDetected") }}</div>
                <div
                  class="tw:text-xs tw:mt-1"
                  :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-500'"
                >
                  {{ anomalyExplanationForSelected }}
                </div>
                <div
                  v-if="selectedPattern.pattern.z_score !== undefined && selectedPattern.pattern.z_score < -1.5 && selectedPattern.pattern.avg_frequency"
                  class="tw:text-xs tw:mt-1"
                  :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-400'"
                >
                  {{ t("search.patternZScore", { zScore: selectedPattern.pattern.z_score.toFixed(2), avgFrequency: Math.round(selectedPattern.pattern.avg_frequency).toLocaleString() }) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Variables Summary -->
        <div class="tw:mb-4">
          <div class="tw:text-sm tw:font-medium tw:mb-1.5">
            {{ t("search.patternVariablesHeader") }}
          </div>
          <div
            class="tw:px-2.5 tw:py-1.5 tw:rounded tw:border-l-4 tw:border-solid tw:border-l-[var(--o2-primary-color)]"
            :class="
              store.state.theme === 'dark' ? 'tw:bg-gray-800' : 'tw:bg-gray-100'
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
        <div class="tw:mb-4">
          <div class="tw:text-sm tw:font-medium tw:mb-1.5">
            {{ t("search.patternTemplate") }}
          </div>
          <div
            class="tw:px-2.5 tw:py-1.5 pattern-detail-text tw:text-[0.8125rem] tw:leading-[1.6] tw:rounded tw:border-l-4 tw:border-solid tw:border-l-[var(--o2-primary-color)] tw:break-all tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-[2px] tw:gap-y-[2px]"
            :class="
              store.state.theme === 'dark' ? 'tw:bg-gray-800' : 'tw:bg-gray-100'
            "
          >
            <template v-for="(tok, i) in selectedTemplateTokens" :key="i">
              <span v-if="tok.kind === 'text'" class="tw:whitespace-pre">{{ tok.value }}</span>
              <span
                v-else
                class="tw:inline-flex"
                @mouseenter="onMouseEnter(tok.value, tok.sampleValues, $event)"
                @mouseleave="onMouseLeave"
              >
                <OBadge
                  size="sm"
                  class="wildcard-chip-detail tw:my-0 tw:mx-0"
                  :class="wildcardChipColor(tok.value, tok.sampleValues)"
                >
                  {{ wildcardLabel(tok.value, tok.sampleValues) }}
                </OBadge>
              </span>
            </template>
          </div>
        </div>

        <!-- Variables -->
        <div
          v-if="
            selectedPattern.pattern.variables &&
            selectedPattern.pattern.variables.length > 0
          "
          class="tw:mb-4"
        >
          <div class="tw:text-sm tw:font-medium tw:mb-1.5">
            {{ t("search.patternVariablesWithCount", { count: selectedPattern.pattern.variables.length }) }}
          </div>
          <OTable
            :data="selectedPattern.pattern.variables"
            :columns="variableColumns"
            row-key="index"
            pagination="none"
            :show-global-filter="false"
            :default-columns="false"
            :max-height="undefined"
            class="tw:w-full tw:border tw:border-solid tw:border-[var(--o2-border-color)]"
          >
            <template #cell-name="{ row }">
              <div class="tw:text-left text-weight-bold text-primary">
                {{ row.name || "var_" + row.index }}
              </div>
            </template>

            <template #cell-type="{ row }">
              <div class="tw:text-left">
                <OBadge
                  size="sm"
                  :class="
                    store.state.theme === 'dark' ? 'tw:bg-gray-600' : 'tw:bg-gray-200'
                  "
                >
                  {{ row.var_type || "unknown" }}
                </OBadge>
              </div>
            </template>
          </OTable>
        </div>

        <!-- Example Logs -->
        <div
          v-if="
            selectedPattern.pattern.examples &&
            selectedPattern.pattern.examples.length > 0
          "
          class="tw:mb-[1rem]"
        >
          <div class="tw:text-sm tw:font-medium tw:mb-1.5">
            {{ t("search.patternExampleLogsWithCount", { count: selectedPattern.pattern.examples.length }) }}
          </div>
          <div
            v-for="(example, exIdx) in selectedPattern.pattern.examples"
            :key="exIdx"
            class="tw:px-[0.625rem] tw:py-[0.375rem] tw:mb-[0.375rem] pattern-detail-text tw:text-[0.75rem] tw:leading-[1.6] tw:rounded tw:break-all tw:whitespace-pre-wrap tw:border-l-[0.1875rem] tw:border-solid"
            :class="[
              store.state.theme === 'dark' ? 'tw:bg-gray-800 tw:border-l-[#3a3a3a]' : 'tw:bg-gray-50 tw:border-l-[#e0e0e0]'
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
      </template>
    </div>

      <!-- Footer Navigation -->
    <template #footer>
      <div class="tw:flex tw:items-center tw:flex-nowrap tw:justify-between">
          <div class="col-auto">
            <OButton
              variant="outline"
              size="sm"
              data-test="pattern-detail-previous-btn"
              :disabled="selectedPattern.index === 0"
              @click="$emit('navigate', false, true)"
              icon-left="chevron-left"
            >
              {{ t('search.patternNavPrevious') }}
            </OButton>
          </div>
          <div class="col-auto tw:text-center">
            <span class="tw:text-xs tw:text-gray-400">
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
              icon-right="chevron-right"
            >
              {{ t('search.patternNavNext') }}
            </OButton>
          </div>
        </div>
    </template>
  </ODrawer>

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

import { computed } from "vue";
import { useStore } from "vuex";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import {
  tokenizeTemplate,
  wildcardChipColor,
  wildcardLabel,
  anomalyExplanation,
} from "@/composables/useLogs/useTemplateTokenizer";
import WildcardValuePopover from "./WildcardValuePopover.vue";
import useWildcardHover from "./useWildcardHover";
import { extractStatusFromTemplate } from "@/utils/logs/statusParser";

const props = defineProps<{
  modelValue: boolean;
  selectedPattern: { pattern: any; index: number } | null;
  totalPatterns: number;
}>();

defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "navigate", next: boolean, prev: boolean): void;
  (e: "filter-value", value: string, action: "include" | "exclude"): void;
}>();

const store = useStore();
const { t } = useI18n();

const {
  hoveredToken,
  onMouseEnter,
  onMouseLeave,
  onPopoverEnter,
  onPopoverLeave,
} = useWildcardHover();

const isDark = computed(() => store.state.theme === "dark");

const selectedTemplateTokens = computed(() =>
  tokenizeTemplate(
    props.selectedPattern?.pattern?.template ?? "",
    props.selectedPattern?.pattern?.wildcard_values ?? [],
  ),
);

const patternLevelInfo = computed(() => {
  const template = props.selectedPattern?.pattern?.template ?? "";
  if (!template) return null;
  const info = extractStatusFromTemplate(template, isDark.value);
  return info.level !== "info" || /\b(info|information)\b/i.test(template) ? info : null;
});

const patternPathToken = computed(() => {
  const tokens = selectedTemplateTokens.value;
  const first = tokens.find((t) => t.kind === "text" && t.value.trim());
  return first?.value?.trim() ?? "";
});

const patternWildcardCount = computed(() =>
  selectedTemplateTokens.value.filter((t) => t.kind !== "text").length,
);

const anomalyExplanationForSelected = computed(() =>
  anomalyExplanation(props.selectedPattern?.pattern ?? {}, t),
);

const variableColumns = computed<OTableColumnDef[]>(() => [
  { id: "name", header: t("search.patternVariableNameColumn"), accessorKey: "name", size: COL.name, meta: { align: "left", autoWidth: true } },
  { id: "type", header: t("search.patternVariableTypeColumn"), accessorKey: "var_type", size: COL.type, meta: { align: "left" } },
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
  font-size: 0.75rem;
  font-weight: bold;
  height: 1.125rem;
  padding: 0 0.3125rem;
  border-radius: 0.1875rem;
  line-height: 1.125rem;
  flex-shrink: 0;
}
</style>
