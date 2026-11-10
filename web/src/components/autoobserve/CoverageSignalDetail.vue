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
    <InsightBlock
      v-if="insight"
      :parts="insight"
      variant="details"
      flush
      :pending="pending"
      @cta="(cta) => emit('cta', cta)"
      @secondary="(cta) => emit('cta', cta)"
    />
    <ODescriptionList dense>
      <ODescriptionItem v-if="cell.detector" stacked :label="t('autoobserve.coverage.detector')">
        <OText variant="mono" class="block">{{ cell.detector }}</OText>
        <span class="text-text-secondary block text-xs">
          {{
            cell.engine?.detectorKind ??
            (cell.method === "anomaly"
              ? t("autoobserve.coverage.methodAnomaly")
              : t("autoobserve.coverage.methodThreshold"))
          }}
        </span>
      </ODescriptionItem>
      <ODescriptionItem
        v-if="cell.detector && lastFired"
        stacked
        :label="t('autoobserve.coverage.lastFired')"
      >
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
        v-if="!insight && cell.reason && (cell.state !== 'gap' || cell.engine)"
        stacked
        :label="t('autoobserve.coverage.reason')"
      >
        {{ cell.reason }}
      </ODescriptionItem>
      <ODescriptionItem
        v-if="cell.engine && !(added && !cell.engine.monitors.length)"
        stacked
        :label="t('autoobserveLive.drawer.monitors')"
        data-test="autoobserve-coverage-detail-monitors"
      >
        <span v-if="!cell.engine.monitors.length" class="text-text-secondary">{{
          t("autoobserveLive.drawer.noMonitor")
        }}</span>
        <div
          v-for="monitor in cell.engine.monitors"
          :key="`${monitor.id}-${monitor.stateKey}`"
          class="flex flex-col gap-0.5 py-0.5"
        >
          <span class="flex flex-wrap items-center gap-2">
            <OText variant="mono" class="break-all">{{ monitor.name }}</OText>
            <span class="text-text-secondary text-xs">{{
              t("autoobserveLive.drawer.monitorLine", {
                kind: monitor.kind,
                state: monitor.state,
              })
            }}</span>
          </span>
          <span v-if="monitor.predicate" class="text-text-secondary text-xs break-words">{{
            monitor.predicate
          }}</span>
        </div>
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
    <div v-if="config && (!cell.engine || nerd)" class="flex flex-col gap-1">
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
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import { seed } from "./coverageSeries";
import InsightBlock from "./insight/InsightBlock.vue";
import type { InsightCta, InsightParts } from "./insight/insightCopy";
import { useAutoObserveView } from "./v2/useAutoObserveView";
import { LEDGER_STATUS, type CoverageCell, type EngineMonitor, type LedgerEntry } from "./fixtures";

const props = defineProps<{
  cell: CoverageCell;
  service: string;
  signal: string;
  ledger: LedgerEntry[];
  insight?: InsightParts | null;
  pending?: boolean;
  /** When the live cell's alerts last fired, read from the alerts; absent until they are read. */
  lastFired?: I18nText | null;
  /** An alert for this check was just added and isn't counted yet. */
  added?: boolean;
}>();

const emit = defineEmits<{ cta: [cta: InsightCta] }>();

const { t } = useI18nTyped();
// Monitor ids and kind keys are engine detail, so the live config block is for Nerd view only.
const { view } = useAutoObserveView();
const nerd = computed(() => view.value === "nerd");

const ledgerTag = (id: string) => {
  const entry = props.ledger.find((e) => e.id === id);
  return entry
    ? { variant: LEDGER_STATUS[entry.status].variant, label: t(LEDGER_STATUS[entry.status].key) }
    : null;
};

const lastFired = computed(() => {
  if (props.cell.engine) return props.lastFired ?? null;
  if (props.cell.state !== "watched") return t("autoobserve.coverage.never");
  const n = seed(`${props.service}:${props.signal}:fired`) % 6;
  if (n === 0) return t("autoobserve.coverage.never");
  return n < 3
    ? t("autoobserve.coverage.hoursAgo", { count: n * 3 }, n * 3)
    : t("autoobserve.coverage.daysAgo", { count: n }, n);
});

const engineConfig = (monitors: EngineMonitor[]) =>
  monitors
    .map((m) =>
      [
        `- monitor: ${m.name}`,
        `  kind: ${m.kindKey}`,
        `  id: ${m.id}`,
        `  state: ${m.stateKey}`,
        `  matched_by: ${JSON.stringify(m.predicate)}`,
      ].join("\n"),
    )
    .join("\n");

const config = computed(() => {
  const cell = props.cell;
  if (cell.engine) return engineConfig(cell.engine.monitors);
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
