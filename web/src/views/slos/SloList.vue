<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  SLO list (alerts_2.md §6b.10).

  Sorted worst-budget-first, with frozen SLOs LAST rather than first. A frozen
  SLO is not the worst — it is unknown — and putting unknowns at the top of a
  severity-sorted list trains people to ignore the top of the list.

  Every derived column renders an em dash when the backend reports no_data. It
  never falls back to zero: a brand-new SLO showing "0%" reads as a total
  outage, which is the exact misreading coverage gating exists to prevent.
-->
<template>
  <OPageLayout
    :title="t('slos.title')"
    icon="track-changes"
    :subtitle="t('slos.subtitle')"
    title-data-test="slos-slolist-title"
    bleed
  >
    <template #actions>
      <!-- The provider behind the Terraform export, which is otherwise only
           discoverable once the export dialog is already open. -->
      <IacRegistryLinks data-test="slos-slolist-iac-registries" />
      <OButton
        variant="primary"
        size="sm-action"
        icon-left="add"
        data-test="slos-slolist-new"
        @click="goToNew"
      >
        {{ t("slos.new") }}
      </OButton>
    </template>

    <!-- SLOs share the ALERT folder namespace (there is no FolderType::Slos),
         so `type="alerts"` is not a copy-paste slip — it is what makes a
         "payments" folder hold that team's alerts and its SLOs together. -->
    <template #sidebar>
      <FolderList type="alerts" @update:activeFolderId="onFolderChange" />
    </template>

    <OTable
      v-model:selected-ids="selectedIds"
      selection="multiple"
      :data="visibleRows"
      :columns="columns"
      row-key="id"
      :loading="loading"
      :error="error"
      :page-size="25"
      :page-size-options="[25, 50, 100]"
      :show-global-filter="false"
      table-id="slos-list"
      :persist-columns="true"
      :column-visibility="defaultColumnVisibility"
      :enable-column-resize="true"
      data-test="slos-slolist-table"
      @row-click="onRowClick"
    >
      <template #toolbar>
        <div class="flex w-full items-center gap-2">
          <OButton
            v-if="selectedIds.length"
            variant="outline"
            size="sm-action"
            icon-left="drive-file-move"
            data-test="slos-slolist-move-selected"
            @click="openMove(selectedRows)"
          >
            {{ t("slos.moveSelected", { count: selectedIds.length }) }}
          </OButton>
          <OButton
            v-if="selectedIds.length"
            variant="outline"
            size="sm-action"
            icon-left="download"
            :loading="exporting"
            data-test="slos-slolist-export-selected"
            @click="openExport(selectedRows)"
          >
            {{ t("common.export") }}
          </OButton>
          <OToggleGroup v-model="typeFilter" data-test="slos-slolist-type-filter">
            <OToggleGroupItem
              v-for="opt in typeOptions"
              :key="opt.value"
              :value="opt.value"
              size="sm"
              :data-test="`slos-slolist-type-filter-${opt.value}`"
            >
              <template v-if="opt.icon" #icon-left>
                <OIcon :name="opt.icon" size="sm" />
              </template>
              {{ opt.label }}
            </OToggleGroupItem>
          </OToggleGroup>
          <!-- min-w-0 on the wrapper, not flex-1 on the input: a flex child
               will not shrink below its content width without it, which is
               how a long placeholder pushes the toolbar wider than the table.
               Same wrapper the Alerts toolbar uses. -->
          <div class="min-w-0 flex-1">
            <OSearchInput
              v-model="search"
              class="w-full"
              :placeholder="t('slos.searchPlaceholder')"
              clearable
              data-test="slos-slolist-search"
            />
          </div>
        </div>
      </template>

      <!-- Refresh lives in #toolbar-trailing so it lands AFTER the auto-injected
           column-visibility toggle, which is the order every other list uses
           (OTable renders toolbar → column toggle → toolbar-trailing). Inside
           #toolbar it sat before the toggle and the two pages disagreed. -->
      <template #toolbar-trailing>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="loading"
          data-test="slos-slolist-refresh"
          @click="() => load()"
        >
          <OTooltip side="bottom" :content="t('slos.refresh')" />
        </OButton>
      </template>

      <!-- Health tiles sit in #subheader so search and the type filter stay
           ABOVE them, matching the Alerts list: you narrow the set first, then
           read the counts for what you narrowed to. Always rendered (skeleton
           while loading) so data arriving never shifts the rows below. -->
      <template #subheader>
        <div
          class="px-page-edge border-table-row-divider border-b py-1.5"
          data-test="slos-slolist-stats"
        >
          <OStatStrip
            :items="stats"
            :loading="loading"
            selectable
            :selected-key="healthFilter"
            @select="onStatSelect"
          />
        </div>
      </template>

      <template #cell-name="{ row }">
        <div class="flex items-center gap-2">
          <span class="font-medium">{{ row.name }}</span>
          <OTag
            v-if="isGrouped(row)"
            variant="purple-soft"
            icon="layers"
            size="xs"
            :label="raw(String(row.group_by?.length ?? 0))"
          />
          <OTag
            v-if="!row.enabled"
            variant="default-soft"
            icon="pause"
            size="xs"
            :label="t('slos.paused')"
          />
        </div>
      </template>

      <template #cell-health="{ row }">
        <OTag
          :variant="healthVariant(row)"
          :icon="healthIcon(health(row))"
          size="sm"
          :label="t(`slos.health.${health(row)}`)"
        />
      </template>

      <template #cell-sli="{ row }">
        <span v-if="row.status && !row.status.no_data" class="tabular-nums">
          <span class="font-semibold">{{ formatSli(row.status.sli) }}</span>
          <span class="text-text-secondary"> / {{ formatTarget(row.target) }}</span>
        </span>
        <span v-else class="text-text-secondary">{{ ABSENT }}</span>
      </template>

      <template #cell-budget="{ row }">
        <div v-if="hasBudget(row)" class="flex items-center gap-2">
          <OProgressBar :value="budgetBarValue(row)" :tone="budgetTone(row)" class="w-20" />
          <span class="font-semibold tabular-nums" :class="budgetTextClass(row)">
            {{ formatBudget(row.status?.error_budget_remaining) }}
          </span>
        </div>
        <span v-else class="text-text-secondary">{{ ABSENT }}</span>
      </template>

      <template #cell-burn="{ row }">
        <span
          v-if="row.status && !row.status.no_data"
          class="tabular-nums"
          :class="(row.status.burn_rate ?? 0) > 1 ? 'text-negative font-semibold' : ''"
        >
          {{ formatBurn(row.status.burn_rate) }}
        </span>
        <span v-else class="text-text-secondary">{{ ABSENT }}</span>
      </template>

      <template #cell-coverage="{ row }">
        <span class="tabular-nums" :class="isLowCoverage(row) ? 'text-warning font-semibold' : ''">
          {{ formatCoverage(row.status?.coverage) }}
        </span>
      </template>

      <template #cell-window="{ row }">
        <span class="tabular-nums">{{ formatWindow(row.window_secs) }}</span>
        <span class="text-text-secondary text-compact ml-1">{{ t("slos.rolling") }}</span>
      </template>

      <template #cell-tags="{ row }">
        <div class="flex flex-wrap gap-1">
          <OTag
            v-for="tag in (row.tags || []).slice(0, 2)"
            :key="tag"
            variant="default-soft"
            size="xs"
            :label="raw(tag)"
          />
          <span v-if="(row.tags || []).length > 2" class="text-text-secondary">…</span>
        </div>
      </template>

      <template #cell-folder="{ row }">
        <span class="text-text-secondary">{{ folderName(row.folder_id) }}</span>
      </template>

      <template #cell-actions="{ row }">
        <div class="flex items-center gap-1" @click.stop>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="edit"
            :title="t('slos.edit')"
            :data-test="`slos-slolist-edit-${row.name}`"
            @click="goToEdit(row)"
          />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="drive-file-move"
            :title="t('slos.move')"
            :data-test="`slos-slolist-move-${row.name}`"
            @click="openMove([row])"
          />
          <OButton
            variant="ghost"
            size="icon-sm"
            :icon-left="row.enabled ? 'pause' : 'play-arrow'"
            :title="row.enabled ? t('slos.pause') : t('slos.resume')"
            :data-test="`slos-slolist-toggle-${row.name}`"
            @click="toggleEnabled(row)"
          />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="download"
            :title="t('common.export')"
            :data-test="`slos-slolist-export-${row.name}`"
            @click="openExport([row])"
          />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="delete"
            :title="t('slos.delete')"
            :data-test="`slos-slolist-delete-${row.name}`"
            @click="confirmDelete(row)"
          />
        </div>
      </template>

      <template #empty>
        <OEmptyState
          icon="track-changes"
          :title="t('slos.empty.title')"
          :description="t('slos.empty.description')"
        >
          <OButton variant="primary" size="sm-action" icon-left="add" @click="goToNew">
            {{ t("slos.new") }}
          </OButton>
        </OEmptyState>
      </template>
    </OTable>

    <!-- `v-model:open`, not `v-model` — ODialog's controlled prop is `open`,
         and a plain v-model binds `modelValue`, which it ignores. The dialog
         then simply never appears, with no error anywhere. -->
    <ODialog
      v-model:open="deleteDialog"
      :title="t('slos.deleteConfirmTitle')"
      data-test="slos-slolist-delete-dialog"
    >
      <p>{{ t("slos.deleteConfirmBody", { name: pendingDelete?.name }) }}</p>
      <!-- The cascade, which is the irreversible part. Deleting an SLO deletes
           every alert attached to it, and until this said so the dialog warned
           only about disk. Three states, all distinct: still checking, a known
           count, and "we could not find out" — silence is reserved for the one
           case where it truly means nothing happens (zero attached). -->
      <OBanner
        v-if="alertCountState === 'loading'"
        variant="info"
        class="mt-3"
        data-test="slos-slolist-delete-alert-count-loading"
      >
        {{ t("slos.deleteAlertsChecking") }}
      </OBanner>
      <OBanner
        v-else-if="alertCountState === 'ready' && alertCount > 0"
        variant="warning"
        class="mt-3"
        data-test="slos-slolist-delete-alert-count"
      >
        {{ t("slos.deleteAlertsNote", { count: alertCount }, alertCount) }}
      </OBanner>
      <OBanner
        v-else-if="alertCountState === 'unknown'"
        variant="warning"
        class="mt-3"
        data-test="slos-slolist-delete-alert-count-unknown"
      >
        {{ t("slos.deleteAlertsUnknown") }}
      </OBanner>
      <!-- Not a footnote: deleting an SLO does NOT free the storage its slices
           occupy, and the budget stays charged until they age out (S-14c). -->
      <OBanner variant="info" class="mt-3">
        {{ t("slos.deleteBudgetNote") }}
      </OBanner>
      <template #footer>
        <OButton variant="outline" size="sm-action" @click="deleteDialog = false">
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          variant="destructive"
          size="sm-action"
          data-test="slos-slolist-delete-confirm"
          @click="doDelete"
        >
          {{ t("slos.delete") }}
        </OButton>
      </template>
    </ODialog>

    <ODialog
      v-model:open="moveDialog"
      :title="t('slos.moveTitle', { count: pendingMove.length })"
      data-test="slos-slolist-move-dialog"
    >
      <SelectFolderDropDown
        type="alerts"
        :active-folder-id="moveTarget"
        @folder-selected="onMoveTargetSelected"
      />
      <template #footer>
        <OButton variant="outline" size="sm-action" @click="moveDialog = false">
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="!moveTarget || moveTarget === activeFolderId"
          data-test="slos-slolist-move-confirm"
          @click="doMove"
        >
          {{ t("slos.move") }}
        </OButton>
      </template>
    </ODialog>

    <ExportResourceDialog
      v-model:open="exportDialog"
      :items="slosToExport"
      :terraform="slosTerraform"
      :title="t('slos.exportTitle', { count: slosToExport.length }, slosToExport.length)"
      :sub-title="t('slos.exportSubtitle')"
      file-prefix="slos"
      data-test="slos-slolist-export-dialog"
      @download="onExported"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import ExportResourceDialog from "@/components/common/ExportResourceDialog.vue";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import IacRegistryLinks from "@/components/common/IacRegistryLinks.vue";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { SloListItem } from "@/ts/interfaces/slo";
import { toast } from "@/lib/feedback/Toast/useToast";
import sloService from "@/services/slos";
import alertsService from "@/services/alerts";
import { sloDetailRoute } from "@/utils/alerts/sloAlertRouting";
import { slosToTerraform } from "@/utils/slos/sloTerraform";
import {
  ABSENT,
  compareByUrgency,
  formatBudget,
  formatBurn,
  formatCoverage,
  formatSli,
  formatTarget,
  formatWindow,
  healthIcon,
  sloHealth,
  type SloHealth,
} from "@/composables/useSloFormat";

const { t } = useI18nTyped();
const router = useRouter();
const route = useRoute();
const store = useStore();

const rows = ref<SloListItem[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const search = ref("");
const typeFilter = ref("all");
const healthFilter = ref<string | null>(null);
const deleteDialog = ref(false);
const pendingDelete = ref<SloListItem | null>(null);
const selectedIds = ref<string[]>([]);
const moveDialog = ref(false);
const moveTarget = ref("");
const pendingMove = ref<SloListItem[]>([]);

// The route is the source of truth for the active folder, so a reload or a
// shared link lands on the same folder the rail is showing.
const activeFolderId = computed(() => (route.query.folder as string) || "default");

const org = computed(() => store.state.selectedOrganization?.identifier);

const selectedRows = computed(() => rows.value.filter((r) => selectedIds.value.includes(r.id)));

// ── Export ──────────────────────────────────────────────────────────────────
// The list rows carry measurement status rather than the full definition, so an
// export re-reads each SLO and shows it as JSON or as an openobserve_slo
// Terraform resource.
const exportDialog = ref(false);
const exporting = ref(false);
const slosToExport = ref<Record<string, unknown>[]>([]);
const slosTerraform = computed(() =>
  slosToTerraform(slosToExport.value, { folderId: activeFolderId.value }),
);

async function fetchSloForExport(id: string): Promise<Record<string, unknown> | null> {
  const res = await sloService.get(org.value, id);
  const body = (res.data ?? {}) as Record<string, unknown>;
  if (!body.name) return null;
  // The endpoint flattens the definition alongside `status`, its live
  // measurement, and carries counters the server assigns. None of that describes
  // the SLO, and the id belongs to the one this was read from rather than the one
  // a configuration creates, so an export keeps only the definition.
  const {
    id: _id,
    status: _status,
    definition_generation: _generation,
    groups_estimate: _estimate,
    groups_reserved: _reserved,
    ...definition
  } = body;
  return definition;
}

async function openExport(items: SloListItem[]) {
  if (exporting.value || !items.length) return;
  exporting.value = true;
  try {
    const fetched = await Promise.all(items.map((item) => fetchSloForExport(item.id)));
    const usable = fetched.filter((slo): slo is Record<string, unknown> => slo !== null);
    if (!usable.length) throw new Error("empty export payload");
    slosToExport.value = usable;
    exportDialog.value = true;

    // A definition that came back empty is a gap in the export. Dropping it
    // quietly would leave the success toast reporting the smaller count as
    // though everything had been exported.
    const missing = items.filter((_, i) => fetched[i] === null).map((item) => item.name);
    if (missing.length) {
      toast({
        variant: "warning",
        message: t("slos.exportPartial", { names: missing.join(", ") }),
      });
    }
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message) || t("slos.exportFailed"),
    });
  } finally {
    exporting.value = false;
  }
}

function onExported({ count }: { format: string; count: number }) {
  toast({ variant: "success", message: t("slos.exportSucceeded", { count }, count) });
  selectedIds.value = [];
}

/** Folder ids are opaque; the rail and this column show the human name. */
function folderName(folderId: string): string {
  const folders = store.state.organizationData?.foldersByType?.alerts ?? [];
  return folders.find((f: any) => f.folderId === folderId)?.name || folderId;
}

const typeOptions = computed(() => [
  { value: "all", label: t("slos.type.all"), icon: "format_list_bulleted" },
  { value: "count", label: t("slos.type.count"), icon: "functions" },
  { value: "time_slice", label: t("slos.type.timeSlice"), icon: "timelapse" },
  { value: "alert", label: t("slos.type.alert"), icon: "gpp_maybe" },
]);

const columns = computed<OTableColumnDef<SloListItem>[]>(() => [
  {
    id: "name",
    header: t("slos.column.name"),
    accessor: (r: any) => r.name,
    sortable: true,
    size: 260,
  },
  { id: "health", header: t("slos.column.status"), accessor: (r: any) => health(r), size: 130 },
  {
    id: "sli",
    header: t("slos.column.statusVsTarget"),
    accessor: (r: any) => r.status?.sli ?? -1,
    sortable: true,
    size: 170,
  },
  {
    id: "budget",
    header: t("slos.column.budgetRemaining"),
    // Frozen SLOs sort to the end via the null branch in compareByUrgency.
    accessor: (r: any) => r.status?.error_budget_remaining ?? null,
    sortable: true,
    size: 190,
  },
  {
    id: "burn",
    header: t("slos.column.burnRate"),
    accessor: (r: any) => r.status?.burn_rate ?? -1,
    sortable: true,
    size: 110,
  },
  {
    id: "coverage",
    header: t("slos.column.coverage"),
    accessor: (r: any) => r.status?.coverage ?? 0,
    sortable: true,
    size: 100,
  },
  { id: "window", header: t("slos.column.window"), accessor: (r: any) => r.window_secs, size: 100 },
  {
    id: "tags",
    header: t("slos.column.tags"),
    accessor: (r: any) => (r.tags || []).join(","),
    size: 180,
  },
  {
    id: "folder",
    header: t("slos.column.folder"),
    accessor: (r: any) => r.folder_id,
    sortable: true,
    hideable: true,
    size: 140,
  },
  // No hardcoded `size`: OTable derives an action column's width from
  // `actionCount` (4 × 32px button + 3 × 4px gap + padding), but only when
  // `isAction` marks it as one. Without the flag it fell through to the
  // generic size and clipped the last two buttons.
  {
    id: "actions",
    header: t("slos.column.actions"),
    accessor: () => "",
    sortable: false,
    isAction: true,
    meta: { align: "center", actionCount: 4 },
  },
]);

// The list is folder-scoped, so every row shows the same folder — the column
// is only worth its width after a move, or when checking where something
// landed. Available via the column toggle, off by default.
const defaultColumnVisibility = { folder: false };

function health(row: SloListItem): SloHealth {
  return sloHealth(row.status);
}

function healthVariant(row: SloListItem): BadgeVariant {
  switch (health(row)) {
    case "budget_blown":
      return "error-soft";
    case "at_risk":
      return "warning-soft";
    case "meeting":
      return "success-soft";
    default:
      return "default-soft";
  }
}

function isGrouped(row: SloListItem): boolean {
  return !!row.group_by && row.group_by.length > 0;
}

function hasBudget(row: SloListItem): boolean {
  return (
    !!row.status &&
    !row.status.no_data &&
    row.status.error_budget_remaining !== null &&
    Number.isFinite(row.status.error_budget_remaining)
  );
}

/** The bar fills to the budget REMAINING, clamped at zero.
 *
 *  Clamped only for the bar's geometry — the number beside it stays signed, so
 *  an overspent budget still reads "-38.0%" rather than being flattened to 0. */
function budgetBarValue(row: SloListItem): number {
  const v = row.status?.error_budget_remaining ?? 0;
  return Math.max(0, Math.min(100, v));
}

function budgetTone(row: SloListItem): string {
  const v = row.status?.error_budget_remaining ?? 0;
  if (v <= 0) return "error";
  if (v < 25) return "warning";
  return "success";
}

function budgetTextClass(row: SloListItem): string {
  const v = row.status?.error_budget_remaining ?? 0;
  return v <= 0 ? "text-negative" : "";
}

function isLowCoverage(row: SloListItem): boolean {
  return !!row.status && row.status.no_data;
}

const stats = computed<StatItem[]>(() => {
  const counts: Record<SloHealth, number> = {
    budget_blown: 0,
    at_risk: 0,
    meeting: 0,
    no_data: 0,
  };
  for (const r of rows.value) counts[health(r)] += 1;
  const total = rows.value.length;
  return [
    {
      key: "budget_blown",
      dataTest: "slos-slolist-stat-budget_blown",
      label: t("slos.health.budget_blown"),
      value: counts.budget_blown,
      icon: "local-fire-department",
      tone: "error",
      max: total,
    },
    {
      key: "at_risk",
      dataTest: "slos-slolist-stat-at_risk",
      label: t("slos.health.at_risk"),
      value: counts.at_risk,
      icon: "trending-down",
      tone: "warning",
      max: total,
    },
    {
      key: "meeting",
      dataTest: "slos-slolist-stat-meeting",
      label: t("slos.health.meeting"),
      value: counts.meeting,
      icon: "check-circle",
      tone: "success",
      max: total,
    },
    {
      key: "no_data",
      dataTest: "slos-slolist-stat-no_data",
      label: t("slos.health.no_data"),
      value: counts.no_data,
      icon: "help-outline",
      tone: "neutral",
      max: total,
    },
    {
      key: "total",
      dataTest: "slos-slolist-stat-total",
      label: t("slos.totalSlos"),
      value: total,
      tone: "primary",
      selectable: true,
    },
  ];
});

const visibleRows = computed(() => {
  const term = search.value.trim().toLowerCase();
  return rows.value
    .filter((r) => typeFilter.value === "all" || r.sli_type === typeFilter.value)
    .filter((r) => !healthFilter.value || health(r) === healthFilter.value)
    .filter(
      (r) =>
        !term ||
        r.name.toLowerCase().includes(term) ||
        (r.tags || []).some((tag) => tag.toLowerCase().includes(term)),
    )
    .sort((a, b) => compareByUrgency(a.status, b.status));
});

function onStatSelect(key: string | null) {
  healthFilter.value = key === "total" ? null : key;
}

// Both optional: refresh calls `load()` bare and falls back to the current org
// and active folder — the folder-change path is the only caller that passes a
// folder the refs have not caught up with yet.
async function load(orgId?: string | null, folderId?: string) {
  if (!org.value) return;
  loading.value = true;
  error.value = null;
  // sometimes the folder id might not be updated so passed via
  // query params.
  const currentOrg = orgId ?? org.value;
  const folder = folderId ?? activeFolderId.value;
  try {
    const res = await sloService.list(currentOrg, folder);
    rows.value = res.data?.list ?? [];
    // Selection is per-folder; carrying ids across a folder switch would let a
    // bulk move act on rows no longer on screen.
    selectedIds.value = [];
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || t("slos.loadFailed");
  } finally {
    loading.value = false;
  }
}

function onFolderChange(folderId: string) {
  if (folderId === activeFolderId.value) return;
  router.push({
    name: "sloList",
    query: { ...route.query, org_identifier: org.value, folder: folderId },
  });
  load(org.value, folderId);
}

function openMove(targets: SloListItem[]) {
  if (!targets.length) return;
  pendingMove.value = targets;
  moveTarget.value = "";
  moveDialog.value = true;
}

function onMoveTargetSelected(folder: any) {
  moveTarget.value = folder?.folderId ?? folder?.value ?? "";
}

async function doMove() {
  const targets = pendingMove.value;
  const dst = moveTarget.value;
  moveDialog.value = false;
  if (!targets.length || !dst) return;
  try {
    await sloService.move(
      org.value,
      targets.map((r) => r.id),
      dst,
    );
    // They left the folder being shown, so drop them rather than re-fetching.
    const moved = new Set(targets.map((r) => r.id));
    rows.value = rows.value.filter((r) => !moved.has(r.id));
    selectedIds.value = selectedIds.value.filter((id) => !moved.has(id));
    toast({
      variant: "success",
      message: t("slos.moved", { count: targets.length, folder: folderName(dst) }),
    });
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message || t("slos.moveFailed") });
  }
}

function goToNew() {
  router.push({ name: "addSlo", query: { org_identifier: org.value } });
}

function goToEdit(row: SloListItem) {
  router.push({
    name: "editSlo",
    params: { slo_id: row.id },
    query: { org_identifier: org.value },
  });
}

function onRowClick(row: SloListItem) {
  router.push(sloDetailRoute(row.id, org.value));
}

async function toggleEnabled(row: SloListItem) {
  try {
    await sloService.setEnabled(org.value, row.id, !row.enabled);
    row.enabled = !row.enabled;
    toast({
      variant: "success",
      message: row.enabled ? t("slos.resumed") : t("slos.pausedNotice"),
    });
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message || t("slos.updateFailed") });
  }
}

// How many alerts this delete would take with it (B2). Fetched LAZILY, here,
// rather than per row while building the list: the count matters only at the
// moment of confirming, and resolving it up front would put an N+1 on a page
// that renders perfectly well without it.
const alertCount = ref(0);
const alertCountState = ref<"loading" | "ready" | "unknown">("loading");
// Only the newest lookup may write. Without this, a slow answer for the SLO the
// user opened first can land after they moved on and label THIS delete with
// that SLO's count — and the number is the entire point of the banner.
let alertCountToken = 0;

function confirmDelete(row: SloListItem) {
  pendingDelete.value = row;
  deleteDialog.value = true;

  alertCount.value = 0;
  alertCountState.value = "loading";
  const token = ++alertCountToken;
  alertsService
    .list_by_slo(org.value, row.id)
    .then((res: any) => {
      if (token !== alertCountToken) return;
      alertCount.value = res?.data?.list?.length ?? 0;
      alertCountState.value = "ready";
    })
    .catch(() => {
      if (token !== alertCountToken) return;
      // Never fall back to "ready, 0": that reads as "nothing else is
      // destroyed", which is the one answer that could be catastrophically
      // wrong here. Say the check failed instead.
      alertCountState.value = "unknown";
    });
}

async function doDelete() {
  const row = pendingDelete.value;
  deleteDialog.value = false;
  if (!row) return;
  try {
    await sloService.delete(org.value, row.id);
    rows.value = rows.value.filter((r) => r.id !== row.id);
    toast({ variant: "success", message: t("slos.deleted") });
  } catch (e: any) {
    toast({ variant: "error", message: e?.response?.data?.message || t("slos.deleteFailed") });
  }
}

onMounted(load);
</script>
