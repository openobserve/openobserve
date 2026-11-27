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
    pagination="client"
    :page-size="25"
    :frame="false"
    :loading="list.isPending.value"
    :forbidden="forbidden"
    :error="loadError"
    :show-global-filter="false"
    :default-columns="false"
    :persist-columns="true"
    :row-actions="rowActions"
    table-id="autoresolve-saved"
    data-test="autoresolve-saved-table"
    @row-click="openSaved"
  >
    <template #toolbar>
      <OSearchInput
        v-model="search"
        class="min-w-0 flex-1 max-md:min-w-40 md:max-w-96"
        :placeholder="t('autoresolve.saved.list.search')"
        clearable
        data-test="autoresolve-saved-search"
      />
    </template>
    <template #toolbar-trailing>
      <ORefreshButton
        layout="inline"
        variant="outline"
        :last-run-at="list.dataUpdatedAt.value"
        :loading="list.isFetching.value"
        data-test="autoresolve-saved-refresh"
        @click="refresh"
      />
    </template>
    <template #cell-trigger="{ row }">
      <OTag
        v-if="triggerState(row.trigger)"
        type="autoresolveTriggerState"
        :value="triggerState(row.trigger) ?? ''"
        size="sm"
      />
      <span v-else class="text-text-muted">{{ raw("—") }}</span>
    </template>
    <template #cell-created_by="{ row }">
      <OUserCell :value="row.created_by" />
    </template>
    <template #cell-updated_at_us="{ row }">
      <OTimeCell :value="row.updated_at_us" unit="us" :timezone="store.state.timezone" />
    </template>
    <template #empty>
      <OEmptyState
        v-if="!list.isPending.value"
        size="hero"
        preset="no-saved-autoresolve"
        :filtered="!!search.trim()"
        @action="onEmptyAction"
      />
    </template>
    <template #error="{ message }">
      <OEmptyState preset="load-error" :description="raw(message)" @action="refresh" />
    </template>
  </OTable>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import type { OTableColumnDef, OTableRowAction } from "@/lib/core/Table/OTable.types";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  autoresolveErrorMessage,
  isForbidden,
  type AutoResolveSaved,
} from "@/services/autoresolve";
import {
  autoresolveSavedListQuery,
  runAutoResolveSavedMutation,
} from "@/services/autoresolve.queries";
import productAnalytics from "@/services/product_analytics";
import { connectionsSentence, triggerState } from "@/utils/autoresolve/autoresolveText";

const props = defineProps<{ org: string }>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

const search = ref("");

const list = useQuery(() =>
  Object.assign(autoresolveSavedListQuery(props.org), { enabled: !!props.org }),
);

const rows = computed(() => {
  const all = list.data.value ?? [];
  const q = search.value.trim().toLowerCase();
  if (!q) return all;
  return all.filter((a) => a.name.toLowerCase().includes(q) || a.goal.toLowerCase().includes(q));
});
const forbidden = computed(() => isForbidden(list.error.value));
const loadError = computed(() => {
  const e = list.error.value;
  if (!e || forbidden.value) return null;
  return autoresolveErrorMessage(e) ?? t("emptyState.loadError.description");
});

const runsWhen = (row: AutoResolveSaved) => {
  const alert = row.trigger.alert_name ? raw(row.trigger.alert_name) : null;
  switch (row.trigger.kind) {
    case "alert":
      return alert
        ? t("autoresolve.saved.runsWhenAlert", { alert })
        : t("autoresolve.saved.runsWhenAlertGone");
    case "incident":
      return alert
        ? t("autoresolve.saved.runsWhenIncident", { alert })
        : t("autoresolve.saved.runsWhenIncidentGone");
    default:
      return t("autoresolve.saved.kind.person");
  }
};

const savedRoute = (row: AutoResolveSaved) => ({
  name: "autoresolveSaved",
  params: { id: row.id },
  query: { org_identifier: props.org },
});

const columns: OTableColumnDef<AutoResolveSaved>[] = [
  {
    id: "name",
    header: t("autoresolve.saved.list.column.name"),
    accessorKey: "name",
    size: 260,
    minSize: 180,
    meta: { isName: true, link: savedRoute },
  },
  {
    id: "runs_when",
    header: t("autoresolve.saved.list.column.runsWhen"),
    accessorFn: runsWhen,
    size: 260,
  },
  {
    id: "trigger",
    header: t("autoresolve.saved.list.column.trigger"),
    accessorFn: (row) => triggerState(row.trigger) ?? "",
    size: 170,
  },
  {
    id: "connections",
    header: t("autoresolve.saved.list.column.connections"),
    accessorFn: (row) => connectionsSentence(row.connections, t, 2),
    size: 200,
    hideable: true,
  },
  {
    id: "created_by",
    header: t("autoresolve.saved.list.column.savedBy"),
    accessorKey: "created_by",
    size: 180,
    hideable: true,
  },
  {
    id: "updated_at_us",
    header: t("autoresolve.saved.list.column.updated"),
    accessorKey: "updated_at_us",
    size: 130,
    hideable: true,
  },
  {
    id: "actions",
    header: t("common.actions"),
    accessorKey: "actions",
    sortable: false,
    isAction: true,
  },
];

const openSaved = (row: AutoResolveSaved) => router.push(savedRoute(row));

const runSaved = useMutation(() => runAutoResolveSavedMutation(props.org));
const runningId = ref<string | null>(null);

const rowActions: OTableRowAction<AutoResolveSaved>[] = [
  {
    id: "run",
    label: t("autoresolve.saved.runNow"),
    icon: "play-arrow",
    inline: true,
    loading: (row) => runningId.value === row.id,
    disabled: (row) => !!runningId.value && runningId.value !== row.id,
    dataTest: (row) => `autoresolve-saved-run-${row.id}`,
    onSelect: (row) => {
      runningId.value = row.id;
      runSaved.mutate(row.id, {
        onSuccess: ({ run_id }) => {
          productAnalytics.track("autoresolve_run_started", { source: "saved_list" });
          void router.push({
            name: "autoresolveRun",
            params: { id: run_id },
            query: { org_identifier: props.org },
          });
        },
        onError: (err: unknown) =>
          toast({
            variant: "error",
            message: raw(autoresolveErrorMessage(err)) || t("autoresolve.saved.runFailed"),
          }),
        onSettled: () => (runningId.value = null),
      });
    },
  },
];

const refresh = () => void list.refetch();

const onEmptyAction = (id?: string) => {
  if (id === "clear-filters") search.value = "";
};
</script>
