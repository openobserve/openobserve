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
  <OContent y class="min-h-0 flex-1 overflow-auto" data-test="fleet-audit">
    <div class="flex flex-col gap-4">
      <OFormSection :title="t('fleet.settings.auditTrail')">
        <OTable
          :data="auditRows"
          :columns="auditColumns"
          row-key="id"
          pagination="none"
          :frame="false"
          :loading="auditLoading"
          :forbidden="auditForbidden"
          :error="auditError"
          :empty-message="audit.disabled.value ? t('fleet.settings.auditDisabled') : undefined"
          data-test="fleet-audit-table"
        >
          <template #cell-at="{ row }">
            <OTimeCell :value="row.at" unit="ms" mode="relative" />
          </template>
          <template #cell-action="{ row }">
            {{ te(row.action) ? t(row.action) : raw(row.action) }}
          </template>
          <template #cell-target="{ row }">
            <OText variant="mono">{{ row.target }}</OText>
          </template>
          <template #error>
            <div data-test="fleet-audit-error">
              <OEmptyState size="block" preset="load-error" @action="audit.refetch()" />
            </div>
          </template>
        </OTable>
      </OFormSection>
    </div>
  </OContent>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { FleetAuditEvent } from "@/services/fleet";
import { isForbidden, useFleetAudit } from "./useFleetApi";

const { t, te } = useI18nTyped();

const audit = useFleetAudit();
const auditRows = audit.rows;
const auditLoading = audit.loading;
const auditForbidden = computed(() => isForbidden(audit.error.value));
const auditError = computed(() =>
  audit.error.value && !auditForbidden.value && !auditRows.value.length
    ? String(audit.error.value)
    : null,
);

const auditColumns = computed<OTableColumnDef<FleetAuditEvent>[]>(() => [
  { id: "at", header: t("fleet.settings.when"), accessorKey: "at", size: 120 },
  { id: "actor", header: t("fleet.settings.actor"), accessorKey: "actor", size: 180 },
  { id: "action", header: t("fleet.settings.action"), accessorKey: "action", size: 220 },
  { id: "target", header: t("fleet.settings.target"), accessorKey: "target", size: 240 },
]);
</script>
