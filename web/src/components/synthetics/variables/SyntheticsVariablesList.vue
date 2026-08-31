<!--
Copyright 2026 OpenObserve Inc.

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

One list serves both scopes: the Variables tab under a Global heading, and an
environment's detail page filtered to that environment. The surrounding page
already says which scope you are in, so there is no Environment column.
-->

<template>
  <div class="flex h-full flex-col">
    <OTable
      :frame="false"
      data-test="synthetics-variables-table"
      :data="visibleRows"
      :columns="columns"
      row-key="id"
      pagination="client"
      :page-size="20"
      :page-size-options="[10, 20, 50, 100]"
      sorting="client"
      filter-mode="client"
      :default-columns="false"
      :enable-column-resize="true"
      :persist-columns="true"
      table-id="synthetics-variables"
      :show-global-filter="false"
      :loading="loading"
    >
      <template #toolbar>
        <OSearchInput
          v-model="filterQuery"
          class="flex-1"
          :placeholder="t('synthetics.variables.searchPlaceholder')"
        />
      </template>
      <template #toolbar-trailing>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="loading"
          data-test="synthetics-variables-refresh-btn"
          @click="$emit('refresh')"
        >
          <OTooltip side="bottom" :content="t('common.refresh')" />
        </OButton>
      </template>

      <template #cell-name="{ row }">
        <span class="font-mono" data-test="synthetics-variable-name">{{ row.name }}</span>
      </template>

      <template #cell-kind="{ row }">
        <OBadge :variant="row.kind === 'secret' ? 'warning' : 'secondary'">
          {{
            row.kind === "secret"
              ? t("synthetics.variables.kindSecret")
              : t("synthetics.variables.kindPlain")
          }}
        </OBadge>
      </template>

      <!-- A secret has no value to show: the server never sends one. The column
           carries presence instead, so "Set" is the strongest claim it makes. -->
      <template #cell-value="{ row }">
        <span
          v-if="row.kind === 'secret'"
          class="text-muted-foreground font-mono"
          data-test="synthetics-variable-secret-value"
        >
          ••••••
          {{ row.has_value ? t("synthetics.variables.set") : t("synthetics.variables.notSet") }}
        </span>
        <span
          v-else
          class="truncate font-mono"
          :title="row.value"
          data-test="synthetics-variable-plain-value"
          >{{ row.value }}</span
        >
      </template>

      <!-- Load-bearing: answers "what breaks if I change this?" and is the
           safety check before a delete. -->
      <template #cell-used_by_checks="{ row }">
        <span data-test="synthetics-variable-usage">
          {{ t("synthetics.variables.usedByChecks", { n: row.used_by_checks }) }}
        </span>
      </template>

      <template #cell-updated_at="{ row }">
        <span>{{ relativeTime(row.updated_at) }}</span>
      </template>

      <template #cell-actions="{ row }">
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="edit"
          data-test="synthetics-variable-edit-btn"
          @click="openEdit(row)"
        />
        <!-- A secret is already scoped by construction and its value is
             write-only, so neither move applies to one. -->
        <OButton
          v-if="environment && row.kind !== 'secret'"
          variant="ghost"
          size="icon-sm"
          icon-left="upgrade"
          data-test="synthetics-variable-promote-btn"
          @click="promote(row)"
        >
          <OTooltip side="bottom" :content="t('synthetics.promote.toGlobal')" />
        </OButton>
        <OButton
          v-if="!environment && environments.length > 0"
          variant="ghost"
          size="icon-sm"
          icon-left="call-split"
          data-test="synthetics-variable-split-btn"
          @click="openSplit(row)"
        >
          <OTooltip side="bottom" :content="t('synthetics.split.action')" />
        </OButton>
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="delete"
          data-test="synthetics-variable-delete-btn"
          @click="removeVariable(row)"
        />
      </template>

      <template #empty>
        <OEmptyState
          :title="t('synthetics.variables.emptyTitle')"
          :description="
            filterQuery
              ? t('synthetics.variables.emptyFiltered')
              : t('synthetics.variables.emptyBody')
          "
          :filtered="Boolean(filterQuery)"
        />
      </template>
    </OTable>

    <SyntheticsSplitVariableDialog
      v-model:open="splitDialog.show"
      :variable="splitDialog.data"
      :environments="environments"
      @done="$emit('refresh')"
    />

    <SyntheticsVariableForm
      v-model:open="drawer.show"
      :is-edit="drawer.isEdit"
      :data="drawer.data"
      :environment="environment"
      @update:list="$emit('refresh')"
    />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from "vue";
import type { PropType } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsVariable } from "@/types/synthetics";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { SyntheticsEnvironment } from "@/types/synthetics";
import SyntheticsVariableForm from "./SyntheticsVariableForm.vue";
import SyntheticsSplitVariableDialog from "./SyntheticsSplitVariableDialog.vue";
import { filterVariables, relativeTime } from "./usage";

export default defineComponent({
  name: "SyntheticsVariablesList",
  components: {
    OTable,
    OButton,
    OBadge,
    OEmptyState,
    OSearchInput,
    OTooltip,
    SyntheticsVariableForm,
    SyntheticsSplitVariableDialog,
  },
  emits: ["refresh"],
  props: {
    variables: { type: Array as PropType<SyntheticsVariable[]>, default: () => [] },
    loading: { type: Boolean, default: false },
    /** Environment NAME, or null for the unscoped tier. */
    environment: { type: String as PropType<string | null>, default: null },
    /** Split destinations. Empty on the global tab means there is nowhere to split to. */
    environments: { type: Array as PropType<SyntheticsEnvironment[]>, default: () => [] },
  },
  setup(props, { emit, expose }) {
    const { t } = useI18nTyped();
    const store = useStore();
    const { confirm } = useConfirmDialog();
    const filterQuery = ref("");
    const drawer = ref({ show: false, isEdit: false, data: null as SyntheticsVariable | null });
    const splitDialog = ref({ show: false, data: null as SyntheticsVariable | null });

    const columns: OTableColumnDef[] = [
      {
        id: "name",
        header: t("synthetics.variables.name"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "kind",
        header: t("synthetics.variables.kind"),
        accessorKey: "kind",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 110,
        meta: { align: "left" },
      },
      {
        id: "value",
        header: t("synthetics.variables.value"),
        accessorKey: "value",
        sortable: false,
        resizable: true,
        hideable: true,
        size: 220,
        meta: { align: "left" },
      },
      {
        id: "used_by_checks",
        header: t("synthetics.variables.usedBy"),
        accessorKey: "used_by_checks",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 140,
        meta: { align: "left" },
      },
      {
        id: "updated_at",
        header: t("synthetics.variables.lastUpdated"),
        accessorKey: "updated_at",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 140,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: raw(""),
        isAction: true,
        pinned: "right",
        size: 100,
        minSize: 100,
        sortable: false,
        meta: { align: "center" },
      },
    ];

    const visibleRows = computed(() => filterVariables(props.variables, filterQuery.value));

    function openCreate() {
      drawer.value = { show: true, isEdit: false, data: null };
    }
    function openEdit(row: SyntheticsVariable) {
      drawer.value = { show: true, isEdit: true, data: row };
    }

    function openSplit(row: SyntheticsVariable) {
      splitDialog.value = { show: true, data: row };
    }

    async function promote(row: SyntheticsVariable) {
      if (!props.environment) return;
      const org = store.state.selectedOrganization.identifier;
      try {
        await syntheticsService.promoteEnvironmentVariable(org, props.environment, row.id);
        toast.success(t("synthetics.promote.done"));
        emit("refresh");
      } catch (error: any) {
        // The server names the conflicting environments, or explains why a
        // secret cannot leave one — both are written to be shown verbatim.
        toast.error(error?.response?.data?.message ?? t("synthetics.promote.failed"));
      }
    }

    async function removeVariable(row: SyntheticsVariable) {
      const ok = await confirm({
        title: t("synthetics.variables.deleteTitle"),
        // Name the blast radius before asking, not after.
        message:
          row.used_by_checks > 0
            ? t("synthetics.variables.deleteUsed", { name: row.name, n: row.used_by_checks })
            : t("synthetics.variables.deleteConfirm", { name: row.name }),
      });
      if (!ok) return;

      const org = store.state.selectedOrganization.identifier;
      try {
        // The dialog above IS the confirmation the server's guard asks for, so
        // force is set once the user has seen what they are breaking.
        const force = row.used_by_checks > 0;
        await (props.environment
          ? syntheticsService.deleteEnvironmentVariable(org, props.environment, row.id, force)
          : syntheticsService.deleteGlobalVariable(org, row.id, force));
        toast.success(t("synthetics.variables.deleted"));
        emit("refresh");
      } catch (error: any) {
        toast.error(error?.response?.data?.message ?? t("synthetics.variables.deleteFailed"));
      }
    }

    // Exposed so the scope header's "Add Variable" opens this drawer rather
    // than the list growing a second, duplicate one.
    expose({ openCreate });

    return {
      t,
      columns,
      filterQuery,
      visibleRows,
      drawer,
      splitDialog,
      relativeTime,
      openSplit,
      promote,
      openCreate,
      openEdit,
      removeVariable,
    };
  },
});
</script>
