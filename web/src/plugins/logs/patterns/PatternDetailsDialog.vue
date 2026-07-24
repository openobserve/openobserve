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
    <ODrawer
      data-test="pattern-details-dialog"
      bleed
      :open="modelValue"
      @update:open="$emit('update:modelValue', $event)"
      :width="90"
      :title="t('search.patternDetailsTitle')"
      :subTitle="
        selectedPattern
          ? t('search.patternXofY', { index: selectedPattern.index + 1, total: totalPatterns })
          : undefined
      "
    >
      <template #header>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
          <!-- Row 1: level badge · title · token & slot OBadges (right of title) -->
          <div class="flex min-w-0 items-center gap-2">
            <span
              v-if="patternLevelInfo"
              class="rounded-default inline-flex shrink-0 items-center px-1.5 py-0.5 text-xs font-semibold tracking-wide text-white uppercase"
              :style="{ backgroundColor: patternLevelInfo.color }"
            >
              {{ patternLevelInfo.level }}
            </span>
            <h4
              class="text-text-heading m-0 min-w-0 truncate text-base leading-tight font-semibold"
            >
              {{ selectedPattern?.pattern?.description || t("search.patternDetailsTitle") }}
            </h4>
            <template v-if="selectedPattern">
              <OTag type="countChip" value="neutral" class="shrink-0">
                {{ selectedTemplateTokens.length }}
                {{
                  selectedTemplateTokens.length === 1
                    ? t("logs.patternDetailsDialog.token")
                    : t("logs.patternDetailsDialog.tokens")
                }}
              </OTag>
              <OTag type="countChip" value="neutral" class="shrink-0">
                {{ patternWildcardCount }}
                {{
                  patternWildcardCount === 1
                    ? t("logs.patternDetailsDialog.variableSlot")
                    : t("logs.patternDetailsDialog.variableSlots")
                }}
              </OTag>
            </template>
          </div>
          <!-- Row 2: full-width module path, truncates at edge -->
          <code
            v-if="selectedPattern && patternPathToken"
            class="text-text-code text-2xs text-text-secondary block w-full truncate font-mono"
            >{{ patternPathToken }}</code
          >
        </div>
      </template>
      <div class="px-5 py-3">
        <template v-if="selectedPattern">
          <!-- Actions (moved here from each row) — highlighted bar with prominent,
             semantically-colored buttons so they're impossible to miss. -->
          <div
            class="rounded-surface bg-surface-subtle border-card-glass-border mb-4 flex items-center gap-2 border border-solid p-2.5"
            data-test="pattern-detail-actions"
          >
            <span class="text-text-secondary mr-1 text-xs font-medium tracking-wide uppercase">
              {{ t("logs.patternList.actionsLabel") }}
            </span>
            <OButton
              variant="primary"
              size="xs"
              data-test="pattern-detail-include-btn"
              @click="onInclude"
            >
              <template #icon-left><EqualIcon class="size-2.5" /></template>
              {{ t("logs.patternList.includeInQuery") }}
            </OButton>
            <OButton
              variant="outline-destructive"
              size="xs"
              data-test="pattern-detail-exclude-btn"
              @click="onExclude"
            >
              <template #icon-left><NotEqualIcon class="size-2.5" /></template>
              {{ t("logs.patternList.excludeFromQuery") }}
            </OButton>
            <OButton
              variant="warning"
              size="xs"
              icon-left="notifications"
              data-test="pattern-detail-create-alert-btn"
              @click="onCreateAlert"
            >
              {{ t("logs.patternList.createAlertAction") }}
            </OButton>
          </div>

          <!-- Statistics -->
          <div class="mb-4">
            <div class="mb-1.5 text-sm font-medium">
              {{ t("search.patternStatistics") }}
            </div>
            <div class="flex gap-3">
              <div class="w-1/2">
                <OCard class="bg-card-glass-solid border-card-glass-border border border-solid">
                  <OCardSection class="p-1.5">
                    <div class="text-xs" :class="'text-text-secondary'">
                      {{ t("search.patternOccurrences") }}
                    </div>
                    <div
                      class="text-primary mt-1 text-2xl font-bold font-semibold"
                      :title="
                        volumeCount !== null
                          ? t('logs.patternList.exactCountTooltip', {
                              count: volumeCount.toLocaleString(),
                            })
                          : undefined
                      "
                    >
                      {{ occurrencesLabel }}
                    </div>
                  </OCardSection>
                </OCard>
              </div>
              <div class="w-1/2">
                <OCard class="bg-card-glass-solid border-card-glass-border border border-solid">
                  <OCardSection class="p-1.5">
                    <div class="text-xs" :class="'text-text-secondary'">
                      {{ t("search.patternPercentage") }}
                    </div>
                    <div class="text-primary mt-1 text-2xl font-bold font-semibold">
                      {{ selectedPattern.pattern.percentage.toFixed(2) }}%
                    </div>
                  </OCardSection>
                </OCard>
              </div>
            </div>
            <div v-if="selectedPattern.pattern.is_anomaly" class="mt-3">
              <div
                class="rounded-default border-status-error-text bg-surface-base flex items-start gap-3 border border-solid px-3 py-2"
              >
                <OIcon name="warning" size="sm" class="mt-0.5 shrink-0" />
                <div>
                  <div class="text-status-error-text font-bold">
                    {{ t("search.patternAnomalyDetected") }}
                  </div>
                  <div class="text-text-secondary mt-1 text-xs">
                    {{ anomalyExplanationForSelected }}
                  </div>
                  <div
                    v-if="
                      selectedPattern.pattern.z_score !== undefined &&
                      selectedPattern.pattern.z_score < -1.5 &&
                      selectedPattern.pattern.avg_frequency
                    "
                    class="mt-1 text-xs"
                    :class="'text-text-secondary'"
                  >
                    {{
                      t("search.patternZScore", {
                        zScore: selectedPattern.pattern.z_score.toFixed(2),
                        avgFrequency: Math.round(
                          selectedPattern.pattern.avg_frequency,
                        ).toLocaleString(),
                      })
                    }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Variables Summary -->
          <div class="mb-4">
            <div class="mb-1.5 text-sm font-medium">
              {{ t("search.patternVariablesHeader") }}
            </div>
            <div
              class="rounded-default border-l-accent bg-surface-subtle border-l-4 border-solid px-2.5 py-1.5"
            >
              {{
                selectedPattern.pattern.examples?.[0]?.variables
                  ? t("search.patternVariablesDetected", {
                      count: Object.keys(selectedPattern.pattern.examples[0].variables).length,
                    })
                  : t("search.patternNoVariablesDetected")
              }}
            </div>
          </div>

          <!-- Pattern Template -->
          <div class="mb-4">
            <div class="mb-1.5 text-sm font-medium">
              {{ t("search.patternTemplate") }}
            </div>
            <div
              class="text-compact rounded-default border-l-accent bg-surface-subtle border-l-4 border-solid px-2.5 py-1.5 font-mono leading-[1.6] break-all whitespace-pre-wrap"
            >
              <template v-for="(tok, i) in selectedTemplateTokens" :key="i">
                <span v-if="tok.kind === 'text'">{{ tok.value }}</span>
                <span
                  v-else
                  class="rounded-default bg-pattern-var-bg text-pattern-var-text px-0.5"
                  @mouseenter="onMouseEnter(tok.value, tok.sampleValues, $event)"
                  @mouseleave="onMouseLeave"
                  >{{ tok.mask ?? wildcardLabel(tok.value, tok.sampleValues) }}</span
                >
              </template>
            </div>
          </div>

          <!-- Variables -->
          <div
            v-if="selectedPattern.pattern.variables && selectedPattern.pattern.variables.length > 0"
            class="mb-4"
          >
            <div class="mb-1.5 text-sm font-medium">
              {{
                t("search.patternVariablesWithCount", {
                  count: selectedPattern.pattern.variables.length,
                })
              }}
            </div>
            <OTable
              :data="selectedPattern.pattern.variables"
              :columns="variableColumns"
              row-key="index"
              pagination="none"
              :show-global-filter="false"
              :default-columns="false"
              :max-height="undefined"
              class="border-card-glass-border w-full border border-solid"
            >
              <template #cell-name="{ row }">
                <div class="text-primary text-left font-bold">
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
            v-if="selectedPattern.pattern.examples && selectedPattern.pattern.examples.length > 0"
            class="mb-4"
          >
            <div class="mb-1.5 text-sm font-medium">
              {{
                t("search.patternExampleLogsWithCount", {
                  count: selectedPattern.pattern.examples.length,
                })
              }}
            </div>
            <div
              v-for="(example, exIdx) in selectedPattern.pattern.examples"
              :key="exIdx"
              class="rounded-default bg-surface-panel border-l-border-default mb-1.5 border-l-[0.1875rem] border-solid px-2.5 py-1.5 font-mono text-xs leading-[1.6] break-all whitespace-pre-wrap"
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
        <div class="flex flex-nowrap items-center justify-between">
          <div class="col-auto">
            <OButton
              variant="outline"
              size="sm"
              data-test="pattern-detail-previous-btn"
              :disabled="selectedPattern?.index === 0"
              @click="$emit('navigate', false, true)"
              icon-left="chevron-left"
            >
              {{ t("search.patternNavPrevious") }}
            </OButton>
          </div>
          <div class="col-auto text-center">
            <span class="text-text-secondary text-xs">
              {{
                t("search.patternXofYShort", {
                  index: (selectedPattern?.index ?? 0) + 1,
                  total: totalPatterns,
                })
              }}
            </span>
          </div>
          <div class="col-auto">
            <OButton
              variant="outline"
              size="sm"
              data-test="pattern-detail-next-btn"
              :disabled="(selectedPattern?.index ?? 0) >= totalPatterns - 1"
              @click="$emit('navigate', true, false)"
              icon-right="chevron-right"
            >
              {{ t("search.patternNavNext") }}
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
import { computed, inject, watch } from "vue";
import useTheme from "@/composables/useTheme";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import {
  tokenizeTemplate,
  wildcardLabel,
  anomalyExplanation,
} from "@/composables/useLogs/useTemplateTokenizer";
import WildcardValuePopover from "./WildcardValuePopover.vue";
import useWildcardHover from "./useWildcardHover";
import { extractStatusFromTemplate } from "@/utils/logs/statusParser";
import { compactCount } from "./patternUtils";
import { PATTERN_VOLUME_CACHE, type PatternVolumeCache } from "./usePatternVolume";

const props = defineProps<{
  modelValue: boolean;
  selectedPattern: { pattern: any; index: number } | null;
  totalPatterns: number;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "navigate", next: boolean, prev: boolean): void;
  (e: "filter-value", value: string, action: "include" | "exclude"): void;
  (e: "add-to-search", pattern: any, action: "include" | "exclude"): void;
  (e: "create-alert", pattern: any): void;
}>();

const { t } = useI18n();

// Window-wide occurrences for the selected pattern, read from the SAME cache the
// rows use. Opening a row is therefore a cache hit and shows its real count
// immediately — previously this panel ran its own query and displayed the
// extraction-sample figure (a few hundred) until that resolved, so the number
// visibly jumped. Paging to a pattern that was never on screen still has to
// fetch, and shows a placeholder rather than a number we know to be wrong.
const volumeCache = inject<PatternVolumeCache | null>(PATTERN_VOLUME_CACHE, null);

const volumeEntry = computed(() =>
  props.selectedPattern?.pattern ? volumeCache?.get(props.selectedPattern.pattern) : undefined,
);
const volumeCount = computed<number | null>(() => volumeEntry.value?.total ?? null);

// Pull in anything not already cached (Next/Prev past the rendered rows).
watch(
  () => props.selectedPattern?.pattern,
  (pattern) => {
    if (pattern && !volumeEntry.value) volumeCache?.request(pattern);
  },
  { immediate: true },
);

const occurrencesLabel = computed(() =>
  volumeCount.value !== null ? `~${compactCount(volumeCount.value)}` : "…",
);

// Row-level actions now live in this side panel. Each fires the action and
// closes the drawer (include/exclude switch to the logs view; create-alert
// navigates to the alert form).
const onInclude = () => {
  if (!props.selectedPattern) return;
  emit("add-to-search", props.selectedPattern.pattern, "include");
  emit("update:modelValue", false);
};
const onExclude = () => {
  if (!props.selectedPattern) return;
  emit("add-to-search", props.selectedPattern.pattern, "exclude");
  emit("update:modelValue", false);
};
const onCreateAlert = () => {
  if (!props.selectedPattern) return;
  emit("create-alert", props.selectedPattern.pattern);
  emit("update:modelValue", false);
};
const { isDark } = useTheme();

const { hoveredToken, onMouseEnter, onMouseLeave, onPopoverEnter, onPopoverLeave } =
  useWildcardHover();

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

const patternWildcardCount = computed(
  () => selectedTemplateTokens.value.filter((t) => t.kind !== "text").length,
);

const anomalyExplanationForSelected = computed(() =>
  anomalyExplanation(props.selectedPattern?.pattern ?? {}, t),
);

const variableColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "name",
    header: t("search.patternVariableNameColumn"),
    accessorKey: "name",
    size: COL.name,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "type",
    header: t("search.patternVariableTypeColumn"),
    accessorKey: "var_type",
    size: COL.type,
    meta: { align: "left" },
  },
]);
</script>
