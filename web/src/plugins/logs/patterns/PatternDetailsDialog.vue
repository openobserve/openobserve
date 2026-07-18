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
      <div class="flex-1 min-w-0 flex flex-col gap-0.5 overflow-hidden">
        <!-- Row 1: level badge · title · token & slot OBadges (right of title) -->
        <div class="flex items-center gap-2 min-w-0">
          <span
            v-if="patternLevelInfo"
            class="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wide text-white"
            :style="{ backgroundColor: patternLevelInfo.color }"
          >
            {{ patternLevelInfo.level }}
          </span>
          <h4 class="font-semibold text-[var(--o2-text-heading)] truncate min-w-0 text-base leading-tight m-0">
            {{ selectedPattern?.pattern?.description || t('search.patternDetailsTitle') }}
          </h4>
          <template v-if="selectedPattern">
            <OTag type="countChip" value="neutral" class="shrink-0">
              {{ selectedTemplateTokens.length }} {{ selectedTemplateTokens.length === 1 ? t('logs.patternDetailsDialog.token') : t('logs.patternDetailsDialog.tokens') }}
            </OTag>
            <OTag type="countChip" value="neutral" class="shrink-0">
              {{ patternWildcardCount }} {{ patternWildcardCount === 1 ? t('logs.patternDetailsDialog.variableSlot') : t('logs.patternDetailsDialog.variableSlots') }}
            </OTag>
          </template>
        </div>
        <!-- Row 2: full-width module path, truncates at edge -->
        <code
          v-if="selectedPattern && patternPathToken"
          class="block w-full truncate text-[var(--o2-text-code)] font-mono text-[0.6875rem] text-[var(--o2-text-caption)]"
        >{{ patternPathToken }}</code>
      </div>
    </template>
    <div class="px-5 py-3">
    <template v-if="selectedPattern">
        <!-- Statistics -->
        <div class="mb-4">
          <div class="text-sm font-medium mb-1.5">
            {{ t("search.patternStatistics") }}
          </div>
          <div class="flex gap-3">
            <div class="w-1/2">
              <OCard
                class="bg-[var(--o2-card-bg-solid)] border border-solid border-[var(--o2-border-color)]"
              >
                <OCardSection class="p-[0.375rem]">
                  <div
                    class="text-xs"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-gray-400'
                        : 'text-gray-400'
                    "
                  >
                    {{ t("search.patternOccurrences") }}
                  </div>
                  <div
                    class="text-2xl font-semibold text-weight-bold text-primary mt-1"
                  >
                    {{
                      selectedPattern.pattern.frequency.toLocaleString()
                    }}
                  </div>
                </OCardSection>
              </OCard>
            </div>
            <div class="w-1/2">
              <OCard class="bg-[var(--o2-card-bg-solid)] border border-solid border-[var(--o2-border-color)]">
                <OCardSection class="p-[0.375rem]">
                  <div
                    class="text-xs"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-gray-400'
                        : 'text-gray-400'
                    "
                  >
                    {{ t("search.patternPercentage") }}
                  </div>
                  <div
                    class="text-2xl font-semibold text-weight-bold text-primary mt-1"
                  >
                    {{ selectedPattern.pattern.percentage.toFixed(2) }}%
                  </div>
                </OCardSection>
              </OCard>
            </div>
          </div>
          <div
            v-if="selectedPattern.pattern.is_anomaly"
            class="mt-3"
          >
            <div
              class="rounded border border-solid border-[var(--o2-status-error-border)] px-3 py-2 flex gap-3 items-start"
              :class="store.state.theme === 'dark' ? 'bg-gray-800' : 'bg-white'"
            >
              <OIcon name="warning" size="sm" class="mt-0.5 shrink-0" />
              <div>
                <div class="text-weight-bold text-red-500">{{ t("search.patternAnomalyDetected") }}</div>
                <div
                  class="text-xs mt-1"
                  :class="store.state.theme === 'dark' ? 'text-gray-300' : 'text-gray-500'"
                >
                  {{ anomalyExplanationForSelected }}
                </div>
                <div
                  v-if="selectedPattern.pattern.z_score !== undefined && selectedPattern.pattern.z_score < -1.5 && selectedPattern.pattern.avg_frequency"
                  class="text-xs mt-1"
                  :class="store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-400'"
                >
                  {{ t("search.patternZScore", { zScore: selectedPattern.pattern.z_score.toFixed(2), avgFrequency: Math.round(selectedPattern.pattern.avg_frequency).toLocaleString() }) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Variables Summary -->
        <div class="mb-4">
          <div class="text-sm font-medium mb-1.5">
            {{ t("search.patternVariablesHeader") }}
          </div>
          <div
            class="px-2.5 py-1.5 rounded border-l-4 border-solid border-l-[var(--o2-primary-color)]"
            :class="
              store.state.theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'
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
        <div class="mb-4">
          <div class="text-sm font-medium mb-1.5">
            {{ t("search.patternTemplate") }}
          </div>
          <div
            class="px-2.5 py-1.5 font-mono text-[0.8125rem] leading-[1.6] rounded border-l-4 border-solid border-l-[var(--o2-primary-color)] break-all flex flex-wrap items-baseline gap-x-[2px] gap-y-[2px]"
            :class="
              store.state.theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'
            "
          >
            <template v-for="(tok, i) in selectedTemplateTokens" :key="i">
              <span v-if="tok.kind === 'text'" class="whitespace-pre">{{ tok.value }}</span>
              <span
                v-else
                class="inline-flex"
                @mouseenter="onMouseEnter(tok.value, tok.sampleValues, $event)"
                @mouseleave="onMouseLeave"
              >
                <OTag
                  type="wildcardChip"
                  :class="wildcardChipColor(tok.value, tok.sampleValues)"
                >
                  {{ wildcardLabel(tok.value, tok.sampleValues) }}
                </OTag>
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
          class="mb-4"
        >
          <div class="text-sm font-medium mb-1.5">
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
            class="w-full border border-solid border-[var(--o2-border-color)]"
          >
            <template #cell-name="{ row }">
              <div class="text-left text-weight-bold text-primary">
                {{ row.name || "var_" + row.index }}
              </div>
            </template>

            <template #cell-type="{ row }">
              <div class="text-left">
                <OTag
                  type="fieldType"
                  :value="row.var_type"
                  :label="row.var_type || t('logs.patternDetailsDialog.unknown')"
                />
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
          class="mb-[1rem]"
        >
          <div class="text-sm font-medium mb-1.5">
            {{ t("search.patternExampleLogsWithCount", { count: selectedPattern.pattern.examples.length }) }}
          </div>
          <div
            v-for="(example, exIdx) in selectedPattern.pattern.examples"
            :key="exIdx"
            class="px-[0.625rem] py-[0.375rem] mb-[0.375rem] font-mono text-[0.75rem] leading-[1.6] rounded break-all whitespace-pre-wrap border-l-[0.1875rem] border-solid"
            :class="[
              store.state.theme === 'dark' ? 'bg-gray-800 border-l-[#3a3a3a]' : 'bg-gray-50 border-l-[#e0e0e0]'
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
      <div class="flex items-center flex-nowrap justify-between">
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
          <div class="col-auto text-center">
            <span class="text-xs text-gray-400">
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
import OTag from "@/lib/core/Badge/OTag.vue";
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

<style>
@import "@/assets/styles/log-highlighting.css";
</style>
