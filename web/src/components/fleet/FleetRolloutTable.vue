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
  <OTable
    :data="rows"
    :columns="columns"
    row-key="id"
    :frame="false"
    pagination="client"
    :page-size="10"
    :show-global-filter="false"
    :loading="loading"
    :error="error"
    :forbidden="forbidden"
    :row-rail-tone="railTone"
    @row-click="(row) => emit('open', row)"
  >
    <template #cell-config="{ row }">
      <div class="flex min-w-0 flex-col">
        <span class="truncate font-medium">{{ row.config }}</span>
        <span class="text-text-secondary text-xs">{{ changeText(row) }}</span>
      </div>
    </template>

    <template #cell-fleet="{ row }">
      <span :class="row.fleetName === null ? 'text-text-muted' : ''">{{ fleetLabel(row) }}</span>
    </template>

    <template #cell-status="{ row }">
      <OTag type="fleetRolloutStatus" :value="rolloutTagValue(row)" />
    </template>

    <template #cell-progress="{ row }">
      <div class="flex w-full min-w-0 flex-col gap-1">
        <span class="text-xs tabular-nums">{{ progressText(row) }}</span>
        <OProgressBar
          :value="row.total ? row.running / row.total : 0"
          :variant="barVariant(row)"
          size="xs"
        />
        <span
          v-if="row.status === 'halted' && row.halt"
          class="text-status-error-text truncate text-xs"
          :data-test="`fleet-rollout-table-halt-${row.id}`"
          >{{ haltClassText(row.halt.class) }}</span
        >
      </div>
    </template>

    <template #cell-startedAt="{ row }">
      <span v-if="row.status === 'scheduled' && row.start.kind === 'at'" class="text-xs">{{
        startsText(row.start.at)
      }}</span>
      <OTimeCell v-else :value="row.startedAt" unit="ms" mode="relative" />
    </template>

    <template #empty>
      <div data-test="fleet-rollout-table-empty">
        <OEmptyState size="block" preset="no-data" />
      </div>
    </template>

    <template #error>
      <div data-test="fleet-rollout-table-error">
        <OEmptyState size="block" preset="load-error" @action="emit('retry')" />
      </div>
    </template>
  </OTable>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef, RowRailTone } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRolloutText } from "./rolloutText";
import { rolloutTagValue, type RolloutRow } from "./useFleetApi";

const props = defineProps<{
  rows: RolloutRow[];
  showFleet?: boolean;
  loading?: boolean;
  error?: string | null;
  forbidden?: boolean;
}>();
const emit = defineEmits<{
  open: [row: RolloutRow];
  retry: [];
}>();

const { t } = useI18nTyped();
const { changeText, haltClassText, progressText, startsText } = useRolloutText();

function fleetLabel(r: RolloutRow) {
  return r.fleetName === null ? t("fleet.fleets.deletedFleet") : raw(r.fleetName);
}

const columns = computed<OTableColumnDef<RolloutRow>[]>(() => [
  { id: "config", header: t("fleet.common.configuration"), accessorKey: "config", size: 200 },
  ...(props.showFleet
    ? [
        {
          id: "fleet",
          header: t("fleet.collectors.fleet"),
          accessorFn: (r: RolloutRow) => r.fleetName ?? "",
          size: 150,
        },
      ]
    : []),
  { id: "status", header: t("fleet.common.status"), accessorKey: "status", size: 130 },
  { id: "progress", header: t("fleet.rollouts.progress"), accessorKey: "running", size: 260 },
  { id: "startedAt", header: t("fleet.rollouts.started"), accessorKey: "startedAt", size: 120 },
]);

function railTone(row: RolloutRow): RowRailTone | null {
  if (row.status === "halted") return "error";
  if (row.status === "in_progress") return "primary";
  return null;
}

function barVariant(row: RolloutRow) {
  if (row.status === "halted") return "danger";
  if (row.status === "completed" && row.total > 0) return "success";
  return "default";
}
</script>
