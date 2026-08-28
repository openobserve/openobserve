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

The list and one environment's detail, without a route of its own: the list
call already returns each environment's variables inline, so opening one costs
no second fetch and back costs nothing at all.
-->

<template>
  <!-- Detail: this environment's variables, with the scope fixed. -->
  <OPageLayout
    v-if="selected"
    :title="selected.name"
    icon="layers"
    :subtitle="selected.description || t('synthetics.environments.detailSubtitle')"
    bleed
  >
    <template #actions>
      <OButton
        variant="outline"
        size="sm"
        icon-left="arrow-back"
        data-test="synthetics-environment-back-btn"
        @click="selectedName = null"
        >{{ t("synthetics.environments.backToList") }}</OButton
      >
    </template>
    <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
      <SyntheticsVariablesList
        :variables="selected.variables"
        :loading="loading"
        :environment="selected.name"
        @refresh="fetchEnvironments"
      />
    </div>
  </OPageLayout>

  <OPageLayout
    v-else
    :title="t('synthetics.environments.title')"
    icon="layers"
    :subtitle="t('synthetics.environments.subtitle')"
    bleed
  >
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        data-test="synthetics-environments-add-btn"
        @click="openCreate"
        >{{ t("synthetics.environments.add") }}</OButton
      >
    </template>

    <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
      <OTable
        :frame="false"
        data-test="synthetics-environments-table"
        :data="environments"
        :columns="columns"
        row-key="id"
        pagination="client"
        :page-size="20"
        sorting="client"
        :show-global-filter="false"
        :loading="loading"
      >
        <template #cell-name="{ row }">
          <button
            class="text-primary hover:underline"
            data-test="synthetics-environment-open"
            @click="selectedName = row.name"
          >
            {{ row.name }}
          </button>
        </template>

        <template #cell-variables="{ row }">
          <span>{{ row.variables.length }}</span>
        </template>

        <template #cell-checks_count="{ row }">
          <span>{{ row.checks_count }}</span>
        </template>

        <template #cell-updated_at="{ row }">
          <span>{{ relativeTime(row.updated_at) }}</span>
        </template>

        <template #cell-actions="{ row }">
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="edit"
            data-test="synthetics-environment-edit-btn"
            @click="openEdit(row)"
          />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="delete"
            data-test="synthetics-environment-delete-btn"
            @click="removeEnvironment(row)"
          />
        </template>

        <template #empty>
          <OEmptyState
            :title="t('synthetics.environments.emptyTitle')"
            :description="t('synthetics.environments.emptyBody')"
          />
        </template>
      </OTable>
    </div>

    <SyntheticsEnvironmentForm
      v-model:open="drawer.show"
      :is-edit="drawer.isEdit"
      :data="drawer.data"
      @update:list="fetchEnvironments"
    />
  </OPageLayout>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsEnvironment } from "@/types/synthetics";
import SyntheticsVariablesList from "./SyntheticsVariablesList.vue";
import SyntheticsEnvironmentForm from "./SyntheticsEnvironmentForm.vue";
import { environmentDeleteBlock, relativeTime } from "./usage";

export default defineComponent({
  name: "SyntheticsEnvironmentsTab",
  components: {
    OPageLayout,
    OTable,
    OButton,
    OEmptyState,
    SyntheticsVariablesList,
    SyntheticsEnvironmentForm,
  },
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();
    const { confirm } = useConfirmDialog();
    const environments = ref<SyntheticsEnvironment[]>([]);
    const loading = ref(false);
    // Held by NAME, not object: a refetch replaces every row, and an id-held
    // reference would keep rendering the pre-refresh variable list.
    const selectedName = ref<string | null>(null);
    const drawer = ref({ show: false, isEdit: false, data: null as SyntheticsEnvironment | null });

    const selected = computed(
      () => environments.value.find((e) => e.name === selectedName.value) ?? null,
    );

    const columns: OTableColumnDef[] = [
      {
        id: "name",
        header: t("synthetics.environments.name"),
        accessorKey: "name",
        sortable: true,
        size: COL.name,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "description",
        header: t("synthetics.environments.description"),
        accessorKey: "description",
        sortable: false,
        size: 260,
        meta: { align: "left" },
      },
      {
        id: "variables",
        header: t("synthetics.environments.variables"),
        accessorKey: "variables",
        sortable: false,
        size: 110,
        meta: { align: "left" },
      },
      {
        id: "checks_count",
        header: t("synthetics.environments.checks"),
        accessorKey: "checks_count",
        sortable: true,
        size: 110,
        meta: { align: "left" },
      },
      {
        id: "updated_at",
        header: t("synthetics.environments.lastUpdated"),
        accessorKey: "updated_at",
        sortable: true,
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

    async function fetchEnvironments() {
      loading.value = true;
      try {
        const org = store.state.selectedOrganization.identifier;
        const res = await syntheticsService.listEnvironments(org);
        environments.value = res.data ?? [];
      } catch (error: any) {
        toast.error(error?.response?.data?.message ?? t("synthetics.environments.loadFailed"));
      } finally {
        loading.value = false;
      }
    }

    function openCreate() {
      drawer.value = { show: true, isEdit: false, data: null };
    }
    function openEdit(row: SyntheticsEnvironment) {
      drawer.value = { show: true, isEdit: true, data: row };
    }

    async function removeEnvironment(row: SyntheticsEnvironment) {
      // Two blocks refuse outright rather than on confirmation, so say so here
      // instead of letting the server 409 after the user has agreed to it.
      const block = environmentDeleteBlock(row.variables, row.checks_count);
      if (block === "checks") {
        toast.error(t("synthetics.environments.deleteBlockedChecks", { n: row.checks_count }));
        return;
      }
      if (block === "secrets") {
        toast.error(t("synthetics.environments.deleteBlockedSecrets"));
        return;
      }

      const ok = await confirm({
        title: t("synthetics.environments.deleteTitle"),
        message:
          row.variables.length > 0
            ? t("synthetics.environments.deleteWithVariables", {
                name: row.name,
                n: row.variables.length,
              })
            : t("synthetics.environments.deleteConfirm", { name: row.name }),
      });
      if (!ok) return;

      try {
        const org = store.state.selectedOrganization.identifier;
        await syntheticsService.deleteEnvironment(org, row.name, row.variables.length > 0);
        toast.success(t("synthetics.environments.deleted"));
        if (selectedName.value === row.name) selectedName.value = null;
        await fetchEnvironments();
      } catch (error: any) {
        toast.error(error?.response?.data?.message ?? t("synthetics.environments.deleteFailed"));
      }
    }

    onMounted(fetchEnvironments);

    return {
      t,
      columns,
      environments,
      loading,
      selectedName,
      selected,
      drawer,
      relativeTime,
      fetchEnvironments,
      openCreate,
      openEdit,
      removeEnvironment,
    };
  },
});
</script>
