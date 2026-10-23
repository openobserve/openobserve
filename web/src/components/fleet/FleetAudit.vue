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
      :data="rows"
      :columns="auditColumns"
      row-key="id"
      :frame="false"
      pagination="client"
      :page-size="20"
      :show-global-filter="false"
      :loading="auditLoading"
      :forbidden="auditForbidden"
      :error="auditError"
      :empty-message="audit.disabled.value ? t('fleet.settings.auditDisabled') : undefined"
      data-test="fleet-audit-table"
    >
      <template #toolbar>
        <div class="flex min-w-0 flex-1 items-center gap-2 max-md:min-w-40">
          <OSearchInput
            v-model="search"
            class="min-w-0 flex-1"
            size="sm"
            clearable
            :placeholder="t('fleet.audit.search')"
            data-test="fleet-audit-search"
          />
          <OSelect
            v-model="kindFilter"
            width="sm"
            size="sm"
            clearable
            :options="kindOptions"
            :placeholder="t('fleet.audit.allObjects')"
            data-test="fleet-audit-kind-filter"
          />
        </div>
      </template>
      <template #toolbar-trailing>
        <ORefreshButton
          layout="inline"
          variant="outline"
          :last-run-at="audit.lastUpdatedAt.value || null"
          :loading="audit.fetching.value"
          data-test="fleet-audit-refresh"
          @click="audit.refetch()"
        />
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
          :filtered="!!search || !!kindFilter"
          :title="audit.disabled.value ? t('fleet.settings.auditDisabled') : undefined"
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
import OText from "@/lib/core/Typography/OText.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { FleetAuditEvent } from "@/services/fleet";
import { isForbidden, useFleetAudit } from "./useFleetApi";
import { AUDIT_KINDS, auditKind, type AuditKind } from "./auditKind";

const { t, te } = useI18nTyped();

const audit = useFleetAudit();
const search = ref("");
const kindFilter = ref<AuditKind | null>(null);
const auditLoading = audit.loading;
const auditForbidden = computed(() => isForbidden(audit.error.value));
const auditError = computed(() =>
  audit.error.value && !auditForbidden.value && !audit.rows.value.length
    ? String(audit.error.value)
    : null,
);

const actionText = (e: FleetAuditEvent) => (te(e.action) ? t(e.action) : e.action);
const kindLabel = (kind: AuditKind) => t(`fleet.audit.kind.${kind}`);
const kindOptions = computed(() =>
  AUDIT_KINDS.map((kind) => ({ label: kindLabel(kind), value: kind })),
);

function clearFilters() {
  search.value = "";
  kindFilter.value = null;
}

const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  return audit.rows.value.filter((e) => {
    const kind = auditKind(e.action);
    if (kindFilter.value && kind !== kindFilter.value) return false;
    if (!q) return true;
    return [e.actor, kindLabel(kind), actionText(e), e.target ?? ""].some((s) =>
      String(s).toLowerCase().includes(q),
    );
  });
});

const auditColumns = computed<OTableColumnDef<FleetAuditEvent>[]>(() => [
  { id: "at", header: t("fleet.settings.when"), accessorKey: "at", size: 140, sortable: true },
  {
    id: "actor",
    header: t("fleet.settings.actor"),
    accessorKey: "actor",
    size: 220,
    sortable: true,
  },
  {
    id: "kind",
    header: t("fleet.audit.object"),
    accessorFn: (e) => auditKind(e.action),
    size: 140,
    sortable: true,
  },
  { id: "action", header: t("fleet.settings.action"), accessorKey: "action", size: 240 },
  { id: "target", header: t("fleet.settings.target"), accessorKey: "target", size: 320 },
]);
</script>
