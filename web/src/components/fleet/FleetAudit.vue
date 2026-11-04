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
  <div class="card-container flex min-h-0 flex-1 flex-col overflow-hidden" data-test="fleet-audit">
    <OTable
      class="min-h-0 flex-1"
      :data="audit.rows.value"
      :columns="auditColumns"
      row-key="id"
      :frame="false"
      pagination="server"
      :current-page="page"
      :page-size="pageSize"
      :total-count="audit.total.value"
      sorting="none"
      :show-global-filter="false"
      :loading="audit.loading.value"
      :forbidden="auditForbidden"
      :error="auditError"
      :empty-message="audit.disabled.value ? t('fleet.settings.auditDisabled') : undefined"
      data-test="fleet-audit-table"
      @pagination-change="onPaginationChange"
    >
      <template #toolbar>
        <div class="flex min-w-0 flex-1 items-center gap-2 max-md:contents">
          <OSearchInput
            :model-value="filters.q"
            class="min-w-0 flex-1"
            size="sm"
            clearable
            :debounce="300"
            :placeholder="t('fleet.audit.search')"
            data-test="fleet-audit-search"
            @update:model-value="(v) => setFilters({ q: v ?? '' })"
          />
          <OSelect
            :model-value="filters.fleet"
            width="sm"
            size="sm"
            clearable
            :options="fleetOptions"
            :placeholder="t('fleet.collectors.allFleets')"
            data-test="fleet-audit-fleet-filter"
            @update:model-value="(v) => setFilters({ fleet: (v as string | null) ?? null })"
          />
          <OSelect
            :model-value="filters.module"
            width="sm"
            size="sm"
            clearable
            :options="moduleOptions"
            :placeholder="t('fleet.audit.allObjects')"
            data-test="fleet-audit-module-filter"
            @update:model-value="
              (v) => setFilters({ module: (v as FleetAuditModule | null) ?? null })
            "
          />
        </div>
      </template>
      <template #toolbar-trailing>
        <div class="flex items-center gap-2" data-test="fleet-audit-toolbar-trailing">
          <OToggleGroup
            :model-value="filters.range"
            mobile-dropdown
            data-test="fleet-audit-range"
            @update:model-value="(v) => v && onRangeChange(v as AuditRange)"
          >
            <OToggleGroupItem
              v-for="option in AUDIT_RANGES"
              :key="option.value"
              :value="option.value"
              size="sm"
              :data-test="`fleet-audit-range-${option.value}`"
            >
              {{ t(option.labelKey) }}
            </OToggleGroupItem>
            <OToggleGroupItem value="custom" size="sm" data-test="fleet-audit-range-custom">
              {{ t("reports.history.rangeCustom") }}
            </OToggleGroupItem>
          </OToggleGroup>
          <DateTime
            v-if="filters.range === 'custom'"
            auto-apply
            default-type="absolute"
            :default-absolute-time="{
              startTime: customRange.from * 1000,
              endTime: customRange.to * 1000,
            }"
            data-test="fleet-audit-date-picker"
            @on:date-change="onCustomRange"
          />
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="audit.lastUpdatedAt.value || null"
            :loading="audit.fetching.value"
            data-test="fleet-audit-refresh"
            @click="audit.refetch()"
          />
        </div>
      </template>
      <template #cell-at="{ row }">
        <OTimeCell :value="row.at" unit="ms" mode="relative" />
      </template>
      <template #cell-kind="{ row }">
        <span :data-test="`fleet-audit-kind-${row.id}`">{{
          kindLabel(auditKind(row.action))
        }}</span>
      </template>
      <template #cell-action="{ row }">
        {{ te(row.action) ? t(row.action) : raw(row.action) }}
      </template>
      <template #cell-target="{ row }">
        <OText variant="mono">{{ row.target }}</OText>
      </template>
      <template #empty>
        <OEmptyState
          size="block"
          preset="no-data"
          :filtered="isFiltered"
          :title="audit.disabled.value ? t('fleet.settings.auditDisabled') : undefined"
          :description="
            audit.disabled.value || isFiltered ? undefined : t('fleet.settings.auditDelayHint')
          "
          @action="clearFilters"
        />
      </template>
      <template #error>
        <div data-test="fleet-audit-error">
          <OEmptyState size="block" preset="load-error" @action="audit.refetch()" />
        </div>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import DateTime from "@/components/DateTime.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef, OTablePaginationParams } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import type { FleetAuditEvent, FleetAuditModule, FleetAuditParams } from "@/services/fleet";
import { isForbidden, useFleetAudit, useFleets } from "./useFleetApi";
import { AUDIT_MODULES, auditKind, type AuditKind } from "./auditKind";

interface AuditFilters {
  q: string;
  fleet: string | null;
  module: FleetAuditModule | null;
  range: AuditRange;
}

const DAY_MS = 86_400_000;
const PAGE_SIZE = 50;

const AUDIT_RANGES = [
  { value: "24h", labelKey: "reports.history.range24h", ms: DAY_MS },
  { value: "7d", labelKey: "reports.history.range7d", ms: 7 * DAY_MS },
  { value: "30d", labelKey: "reports.history.range30d", ms: 30 * DAY_MS },
] as const satisfies readonly { value: string; labelKey: I18nKey; ms: number }[];

type AuditRange = (typeof AUDIT_RANGES)[number]["value"] | "custom";

// The server's default period, so only a different one counts as a filter.
const DEFAULT_RANGE: AuditRange = "30d";

const DEFAULT_FILTERS: AuditFilters = {
  q: "",
  fleet: null,
  module: null,
  range: DEFAULT_RANGE,
};

const { t, te } = useI18nTyped();

const page = ref(1);
const pageSize = ref(PAGE_SIZE);
const filters = ref<AuditFilters>({ ...DEFAULT_FILTERS });
const anchor = ref(Date.now());
const customRange = ref({ from: Date.now() - 30 * DAY_MS, to: Date.now() });

const period = computed((): Pick<FleetAuditParams, "from" | "to"> => {
  if (filters.value.range === "custom") return { ...customRange.value };
  const preset = AUDIT_RANGES.find((r) => r.value === filters.value.range)!;
  // No `to`: the server ends the period at now, so a refetch picks up events newer than the anchor.
  return { from: anchor.value - preset.ms };
});

const params = computed((): FleetAuditParams => ({
  offset: (page.value - 1) * pageSize.value,
  limit: pageSize.value,
  q: filters.value.q.trim() || undefined,
  fleet: filters.value.fleet ?? undefined,
  module: filters.value.module ?? undefined,
  ...period.value,
}));

const audit = useFleetAudit(() => params.value);
const fleets = useFleets();
const auditForbidden = computed(() => isForbidden(audit.error.value));
const auditError = computed(() =>
  audit.error.value && !auditForbidden.value && !audit.rows.value.length
    ? String(audit.error.value)
    : null,
);

const kindLabel = (kind: AuditKind) => t(`fleet.audit.kind.${kind}`);
const moduleOptions = computed(() =>
  Object.entries(AUDIT_MODULES).map(([kind, module]) => ({
    label: kindLabel(kind as AuditKind),
    value: module,
  })),
);
// The server returns an empty page for a fleet the caller may not read.
const fleetOptions = computed(() =>
  fleets.rows.value.filter((f) => f.readable).map((f) => ({ label: raw(f.name), value: f.id })),
);

const isFiltered = computed(
  () =>
    !!filters.value.q.trim() ||
    !!filters.value.fleet ||
    !!filters.value.module ||
    filters.value.range !== DEFAULT_RANGE,
);

function setFilters(patch: Partial<AuditFilters>) {
  filters.value = { ...filters.value, ...patch };
  page.value = 1;
}

function onRangeChange(range: AuditRange) {
  anchor.value = Date.now();
  setFilters({ range });
}

function onCustomRange(value: { startTime: number; endTime: number }) {
  customRange.value = {
    from: Math.floor(value.startTime / 1000),
    to: Math.floor(value.endTime / 1000),
  };
  page.value = 1;
}

function clearFilters() {
  anchor.value = Date.now();
  setFilters({ ...DEFAULT_FILTERS });
}

function onPaginationChange({ page: next, size }: OTablePaginationParams) {
  page.value = size === pageSize.value ? next : 1;
  pageSize.value = size;
}

const auditColumns = computed<OTableColumnDef<FleetAuditEvent>[]>(() => [
  { id: "at", header: t("fleet.settings.when"), accessorKey: "at", size: 140 },
  { id: "actor", header: t("fleet.settings.actor"), accessorKey: "actor", size: 220 },
  {
    id: "kind",
    header: t("fleet.audit.object"),
    accessorFn: (e) => auditKind(e.action),
    size: 140,
  },
  { id: "action", header: t("fleet.settings.action"), accessorKey: "action", size: 240 },
  { id: "target", header: t("fleet.settings.target"), accessorKey: "target", size: 320 },
]);
</script>
