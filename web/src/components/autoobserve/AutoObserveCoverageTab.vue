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
    class="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-auto"
    data-test="autoobserve-coverage"
  >
    <div class="flex min-h-0 min-w-0 flex-1 flex-col max-lg:min-h-150">
      <OTable
        :data="COVERAGE"
        :columns="columns"
        :frame="false"
        row-key="service"
        pagination="none"
        :show-global-filter="false"
        class="min-h-0 flex-1"
        data-test="autoobserve-coverage-matrix"
      >
        <template #toolbar>
          <div class="flex w-full min-w-0 flex-wrap items-center gap-3">
            <span class="text-text-secondary text-xs">{{
              t("autoobserve.coverage.showing", { shown: COVERAGE.length, total: SERVICES_TOTAL })
            }}</span>
            <div class="ms-auto flex flex-wrap items-center gap-2">
              <OTag
                v-for="s in legend"
                :key="s.state"
                :variant="STATE_VARIANT[s.state]"
                size="xs"
                :label="s.label"
              />
            </div>
          </div>
        </template>
        <template #subheader>
          <div class="px-page-edge border-table-row-divider border-b py-1.5">
            <OStatStrip :items="stats" compact data-test="autoobserve-coverage-stats" />
          </div>
        </template>
        <template #cell-service="{ row }">
          <span class="text-text-heading font-medium">{{ row.service }}</span>
        </template>
        <template v-for="signal in SIGNALS" :key="signal" #[`cell-${signal}`]="{ row }">
          <OTag
            clickable
            :variant="STATE_VARIANT[row.cells[signal].state]"
            size="sm"
            :label="cellLabel(row.cells[signal])"
            :class="isSelected(row.service, signal) ? 'ring-accent ring-2' : ''"
            :data-test="`autoobserve-coverage-cell-${row.service}-${signal}`"
            @click="selected = { service: row.service, signal }"
          />
        </template>
        <template #cell-lastScanned="{ row }">
          <span class="text-text-secondary text-xs">{{ row.lastScanned }}</span>
        </template>
      </OTable>
    </div>

    <aside
      class="border-border-default flex w-96 shrink-0 flex-col gap-4 overflow-auto border-s p-4 max-lg:w-full max-lg:border-s-0 max-lg:border-t [&>*]:shrink-0"
      data-test="autoobserve-coverage-rail"
    >
      <OCard v-if="selectedCell" variant="glass" data-test="autoobserve-coverage-detail">
        <OCardSection role="header" dense>
          <OText variant="panel-title">{{
            t("autoobserve.coverage.cellTitle", {
              service: raw(selected.service),
              signal: t(SIGNAL_LABEL[selected.signal]),
            })
          }}</OText>
          <OTag
            class="ms-auto"
            :variant="STATE_VARIANT[selectedCell.state]"
            size="xs"
            :label="t(STATE_LABEL[selectedCell.state])"
          />
        </OCardSection>
        <OCardSection role="body" dense class="flex flex-col gap-3">
          <ODescriptionList dense>
            <ODescriptionItem
              v-if="selectedCell.detector"
              stacked
              :label="t('autoobserve.coverage.detector')"
            >
              <OText variant="mono" class="block">{{ selectedCell.detector }}</OText>
              <span class="text-text-secondary block text-xs">
                {{
                  selectedCell.method === "anomaly"
                    ? t("autoobserve.coverage.methodAnomaly")
                    : t("autoobserve.coverage.methodThreshold")
                }}
              </span>
            </ODescriptionItem>
            <ODescriptionItem
              v-if="selectedCell.library"
              stacked
              :label="t('autoobserve.coverage.libraryEntry')"
            >
              <OText variant="mono">{{ selectedCell.library }}</OText>
            </ODescriptionItem>
            <ODescriptionItem
              v-if="selectedCell.predicate"
              stacked
              :label="t('autoobserve.coverage.predicate')"
            >
              {{
                selectedCell.stream
                  ? t("autoobserve.coverage.predicateMatched", {
                      predicate: raw(selectedCell.predicate),
                      stream: raw(selectedCell.stream),
                    })
                  : t("autoobserve.coverage.predicateUnmatched", {
                      predicate: raw(selectedCell.predicate),
                    })
              }}
            </ODescriptionItem>
            <ODescriptionItem
              v-if="selectedCell.reason"
              stacked
              :label="t('autoobserve.coverage.reason')"
            >
              {{ selectedCell.reason }}
            </ODescriptionItem>
            <ODescriptionItem
              v-if="selectedCell.alsoWatchedBy"
              stacked
              :label="t('autoobserve.coverage.alsoWatchedBy')"
            >
              <div
                v-for="extra in selectedCell.alsoWatchedBy"
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
          <div v-if="selectedCell.progress" class="flex flex-col gap-1">
            <OProgressBar :value="selectedCell.progress[0] / selectedCell.progress[1]" size="xs" />
            <span class="text-text-secondary text-xs">{{
              t("autoobserve.coverage.history", {
                days: selectedCell.progress[0],
                total: selectedCell.progress[1],
              })
            }}</span>
          </div>
          <p
            v-if="selectedCell.state === 'learning'"
            class="text-text-secondary flex items-start gap-1 text-xs"
            data-test="autoobserve-coverage-guardrails"
          >
            <OIcon name="shield" size="xs" class="mt-0.5 shrink-0" />{{
              t("autoobserve.coverage.guardrails")
            }}
          </p>
        </OCardSection>
      </OCard>

      <OCard variant="glass" data-test="autoobserve-coverage-plan">
        <OCardSection role="header" dense>
          <OText variant="panel-title">{{ t("autoobserve.coverage.plan") }}</OText>
          <span class="text-text-secondary ms-auto text-xs">{{
            t("autoobserve.coverage.pending", { count: pendingCount })
          }}</span>
        </OCardSection>
        <OCardSection role="body" dense>
          <ul class="flex flex-col">
            <li
              v-for="item in plan"
              :key="`${item.service}-${item.signal}`"
              class="border-border-subtle flex flex-col gap-1 border-b py-2 last:border-b-0"
            >
              <div class="flex items-center gap-2">
                <span class="text-text-heading text-sm">{{
                  t("autoobserve.coverage.cellTitle", {
                    service: raw(item.service),
                    signal: t(SIGNAL_LABEL[item.signal]),
                  })
                }}</span>
                <OTag class="ms-auto" :variant="item.variant" size="xs" :label="item.stateLabel" />
              </div>
              <OText variant="mono">{{ item.library }}</OText>
              <span class="text-text-secondary text-xs">{{ item.reason }}</span>
            </li>
          </ul>
        </OCardSection>
      </OCard>

      <OCard variant="glass" data-test="autoobserve-coverage-streams">
        <OCardSection role="header" dense>
          <OText variant="panel-title">{{ t("autoobserve.coverage.streams") }}</OText>
        </OCardSection>
        <OCardSection role="body" dense>
          <ul class="flex flex-col">
            <li
              v-for="s in STREAMS"
              :key="s.stream"
              class="border-border-subtle flex items-center gap-2 border-b py-2 text-sm last:border-b-0"
            >
              <OIcon
                :name="s.lastScanned ? 'check-circle-outline' : 'help-outline'"
                size="sm"
                :class="
                  s.lastScanned ? 'text-icon-chip-success-text' : 'text-icon-chip-warning-text'
                "
              />
              <div class="flex min-w-0 flex-1 flex-col">
                <OText variant="mono">{{ s.stream }}</OText>
                <span v-if="s.lastScanned" class="text-text-secondary text-xs">{{
                  t("autoobserve.coverage.scanned", { time: raw(s.lastScanned), count: s.services })
                }}</span>
                <span v-else class="text-icon-chip-warning-text text-xs">{{
                  t("autoobserve.coverage.notScanned")
                }}</span>
              </div>
            </li>
          </ul>
        </OCardSection>
      </OCard>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import {
  COVERAGE,
  COVERAGE_PLAN,
  LEDGER_STATUS,
  DETECTOR_CEILING,
  SERVICES_TOTAL,
  SIGNAL_LABEL,
  SIGNALS,
  SERVICES_LEARNING,
  STREAMS,
  gapServices,
  type CellState,
  type CoverageCell,
  type CoverageRow,
  type LedgerEntry,
  type Signal,
} from "./fixtures";

const { t } = useI18nTyped();

const STATE_VARIANT: Record<CellState, BadgeVariant> = {
  watched: "success-soft",
  learning: "blue-soft",
  gap: "warning-soft",
  na: "default-soft",
};
const STATE_LABEL: Record<CellState, I18nKey> = {
  watched: "autoobserve.coverage.watched",
  learning: "autoobserve.coverage.learning",
  gap: "autoobserve.coverage.gap",
  na: "autoobserve.coverage.na",
};
const props = defineProps<{ ledger: LedgerEntry[] }>();

const plan = computed(() =>
  COVERAGE_PLAN.map((item) => {
    const entry = item.ledgerId ? props.ledger.find((e) => e.id === item.ledgerId) : undefined;
    return {
      ...item,
      variant: entry ? LEDGER_STATUS[entry.status].variant : ("warning-soft" as BadgeVariant),
      stateLabel: entry
        ? t(LEDGER_STATUS[entry.status].key)
        : t("autoobserve.coverage.planBlocked"),
      done: !!entry && ["auto_applied", "approved", "kept"].includes(entry.status),
    };
  }),
);
const ledgerTag = (id: string) => {
  const entry = props.ledger.find((e) => e.id === id);
  return entry
    ? { variant: LEDGER_STATUS[entry.status].variant, label: t(LEDGER_STATUS[entry.status].key) }
    : null;
};
const pendingCount = computed(() => plan.value.filter((i) => !i.done).length);
const gapServiceCount = gapServices().length;

const selected = ref<{ service: string; signal: Signal }>({
  service: "payments",
  signal: "saturation",
});

const selectedCell = computed(
  () => COVERAGE.find((r) => r.service === selected.value.service)?.cells[selected.value.signal],
);

const isSelected = (service: string, signal: Signal) =>
  selected.value.service === service && selected.value.signal === signal;

const cellLabel = (cell: CoverageCell): I18nText => {
  if (cell.state === "watched")
    return cell.method === "anomaly"
      ? t("autoobserve.coverage.anomaly")
      : t("autoobserve.coverage.threshold");
  if (cell.state === "learning" && cell.progress)
    return t("autoobserve.coverage.days", { days: cell.progress[0], total: cell.progress[1] });
  return t(STATE_LABEL[cell.state]);
};

const legend = computed(() =>
  (["watched", "learning", "gap", "na"] as CellState[]).map((state) => ({
    state,
    label: t(STATE_LABEL[state]),
  })),
);

const stats = computed<StatItem[]>(() => [
  {
    key: "watched",
    label: t("autoobserve.status.servicesWatched"),
    value: SERVICES_TOTAL - SERVICES_LEARNING - gapServiceCount,
    sub: t("autoobserve.status.ofTotal", { total: SERVICES_TOTAL }),
    tone: "success",
  },
  {
    key: "learning",
    label: t("autoobserve.status.learning"),
    value: SERVICES_LEARNING,
    tone: "info",
  },
  {
    key: "gaps",
    label: t("autoobserve.status.gaps"),
    value: gapServiceCount,
    tone: "warning",
  },
  {
    key: "detectors",
    label: t("autoobserve.coverage.detectors"),
    value: t("autoobserve.coverage.ratio", { used: DETECTOR_CEILING, limit: DETECTOR_CEILING }),
    sub: t("autoobserve.coverage.ceilingTip"),
    subIcon: "info-outline",
    tone: "orange",
  },
]);

const columns: OTableColumnDef<CoverageRow>[] = [
  {
    id: "service",
    header: t("autoobserve.coverage.service"),
    accessorKey: "service",
    size: 170,
  },
  ...SIGNALS.map((signal) => ({
    id: signal,
    header: t(SIGNAL_LABEL[signal]),
    accessorFn: (row: CoverageRow) => row.cells[signal].state,
    size: 112,
  })),
  {
    id: "lastScanned",
    header: t("autoobserve.coverage.lastScanned"),
    accessorKey: "lastScanned",
    size: 120,
  },
];
</script>
