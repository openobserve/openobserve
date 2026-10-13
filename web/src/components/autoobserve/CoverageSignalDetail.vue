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
  <div
    class="bg-surface-subtle rounded-default flex flex-col gap-3 p-3"
    data-test="autoobserve-coverage-detail"
  >
    <ODescriptionList dense>
      <ODescriptionItem v-if="cell.detector" stacked :label="t('autoobserve.coverage.detector')">
        <OText variant="mono" class="block">{{ cell.detector }}</OText>
        <span class="text-text-secondary block text-xs">
          {{
            cell.method === "anomaly"
              ? t("autoobserve.coverage.methodAnomaly")
              : t("autoobserve.coverage.methodThreshold")
          }}
        </span>
      </ODescriptionItem>
      <ODescriptionItem v-if="cell.detector" stacked :label="t('autoobserve.coverage.lastFired')">
        <span data-test="autoobserve-coverage-detail-last-fired">{{ lastFired }}</span>
      </ODescriptionItem>
      <ODescriptionItem v-if="cell.library" stacked :label="t('autoobserve.coverage.libraryEntry')">
        <OText variant="mono">{{ cell.library }}</OText>
      </ODescriptionItem>
      <ODescriptionItem v-if="cell.predicate" stacked :label="t('autoobserve.coverage.predicate')">
        {{
          cell.stream
            ? t("autoobserve.coverage.predicateMatched", {
                predicate: raw(cell.predicate),
                stream: raw(cell.stream),
              })
            : t("autoobserve.coverage.predicateUnmatched", { predicate: raw(cell.predicate) })
        }}
      </ODescriptionItem>
      <ODescriptionItem
        v-if="cell.reason && cell.state !== 'gap'"
        stacked
        :label="t('autoobserve.coverage.reason')"
      >
        {{ cell.reason }}
      </ODescriptionItem>
      <ODescriptionItem
        v-if="cell.alsoWatchedBy"
        stacked
        :label="t('autoobserve.coverage.alsoWatchedBy')"
      >
        <div
          v-for="extra in cell.alsoWatchedBy"
          :key="extra.ledgerId"
          class="flex flex-wrap items-center gap-2"
        >
          <OText variant="mono">{{ extra.detector }}</OText>
          <span class="text-text-secondary text-xs">{{ extra.library }}</span>
          <OTag
            v-if="ledgerTag(extra.ledgerId)"
            :variant="ledgerTag(extra.ledgerId)?.variant"
            size="xs"
            :label="ledgerTag(extra.ledgerId)?.label"
          />
        </div>
      </ODescriptionItem>
    </ODescriptionList>
    <div v-if="cell.progress" class="flex flex-col gap-1">
      <OProgressBar :value="cell.progress[0] / cell.progress[1]" size="xs" />
      <span class="text-text-secondary text-xs">{{
        t("autoobserve.coverage.history", { days: cell.progress[0], total: cell.progress[1] })
      }}</span>
    </div>
    <p
      v-if="cell.state === 'learning'"
      class="text-text-secondary flex items-start gap-1 text-xs"
      data-test="autoobserve-coverage-guardrails"
    >
      <OIcon name="shield" size="xs" class="mt-0.5 shrink-0" />{{
        t("autoobserve.coverage.guardrails")
      }}
    </p>
    <div v-if="config" class="flex flex-col gap-1">
      <span class="text-text-secondary text-xs">{{ t("autoobserve.coverage.config") }}</span>
      <OCodeBlock
        :code="config"
        lang="yaml"
        wrap
        :copyable="false"
        data-test="autoobserve-coverage-detail-config"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import { seed } from "./coverageSeries";
import { LEDGER_STATUS, type CoverageCell, type LedgerEntry, type Signal } from "./fixtures";

const props = defineProps<{
  cell: CoverageCell;
  service: string;
  signal: Signal;
  ledger: LedgerEntry[];
}>();

const { t } = useI18nTyped();

const ledgerTag = (id: string) => {
  const entry = props.ledger.find((e) => e.id === id);
  return entry
    ? { variant: LEDGER_STATUS[entry.status].variant, label: t(LEDGER_STATUS[entry.status].key) }
    : null;
};

const lastFired = computed(() => {
  if (props.cell.state !== "watched") return t("autoobserve.coverage.never");
  const n = seed(`${props.service}:${props.signal}:fired`) % 6;
  if (n === 0) return t("autoobserve.coverage.never");
  return n < 3
    ? t("autoobserve.coverage.hoursAgo", { count: n * 3 }, n * 3)
    : t("autoobserve.coverage.daysAgo", { count: n }, n);
});

const config = computed(() => {
  const cell = props.cell;
  if (!cell.detector) return "";
  const baseline =
    cell.state === "learning" && cell.progress
      ? `learning (${cell.progress[0]} of ${cell.progress[1]} days)`
      : "7d, weekday x hour";
  return [
    `detector: ${cell.detector}`,
    `method: ${cell.method}`,
    `library: ${cell.library}`,
    `stream: ${cell.stream}`,
    `applies_when: "${cell.predicate}"`,
    cell.method === "anomaly" ? `baseline: ${baseline}` : "condition: library default",
  ].join("\n");
});
</script>
