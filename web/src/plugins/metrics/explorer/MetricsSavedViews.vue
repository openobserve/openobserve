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

<!--
  Metrics Saved Views — the toolbar control + dialogs, mirroring the Logs saved
  views UX (a list button and a create button, a list dialog to apply/delete a
  view, and an OForm + Zod dialog to name a new one).

  A view is a named snapshot of the explorer's filters + pinned metrics. This
  component owns the CRUD (via useMetricsSavedViews) and the dialogs; the parent
  supplies the current snapshot to save (`buildSnapshot`) and applies a restored
  one (`@apply`).
-->
<template>
  <div data-test="metrics-saved-views">
    <!-- Two joined icon buttons — list (saved-search + dropdown arrow) and
         create (save) — exactly like the Logs saved-views control. -->
    <OButtonGroup
      class="p-0 element-box-shadow border border-button-outline-border"
    >
      <OButton
        variant="ghost"
        size="icon-toolbar"
        data-test="metrics-saved-views-list-btn"
        @click="openList"
      >
        <OIcon name="saved-search" size="sm" />
        <OIcon name="arrow-drop-down" size="sm" class="-ml-0.5" />
        <OTooltip :content="t('metrics.explorer.savedViews.listTooltip')" />
      </OButton>
      <OButton
        variant="ghost"
        size="icon-toolbar"
        data-test="metrics-saved-views-create-btn"
        @click="openCreate"
      >
        <OIcon name="save" size="sm" />
        <OTooltip :content="t('metrics.explorer.savedViews.createTooltip')" />
      </OButton>
    </OButtonGroup>

    <!-- List dialog: click a view's NAME to apply it; edit/delete icons on the
         row; a search box filters the list. Header hidden. Mirrors Logs. -->
    <ODialog
      v-model:open="listOpen"
      size="lg"
      :title="t('metrics.explorer.savedViews.listTitle')"
      :secondary-button-label="t('confirmDialog.cancel')"
      data-test="metrics-saved-views-list-dialog"
      @click:secondary="listOpen = false"
    >
      <div class="min-h-[17.5rem]">
        <OTable
          v-model:global-filter="listFilter"
          :data="savedViews.views.value"
          :columns="listColumns"
          :loading="savedViews.loading.value"
          :frame="false"
          class="o2-table-hide-header"
          data-test="metrics-saved-views-table"
        >
          <template #toolbar>
            <div class="px-2 py-2 w-full min-w-0 box-border">
              <OSearchInput
                v-model="listFilter"
                clearable
                :debounce="300"
                class="w-full"
                :placeholder="t('metrics.explorer.savedViews.searchPlaceholder')"
                data-test="metrics-saved-views-search"
              />
            </div>
          </template>

          <template #cell-view_name="{ row, value }">
            <div
              class="truncate cursor-pointer text-sm min-w-0 w-full"
              :title="value"
              :data-test="`metrics-saved-views-apply-${value}`"
              @click.stop="onApply(row)"
            >
              {{ value }}
            </div>
          </template>

          <template #cell-actions="{ row }">
            <div class="flex items-center gap-0.5 justify-end">
              <OButton
                variant="ghost-neutral"
                size="icon-sm"
                :title="t('common.edit')"
                :data-test="`metrics-saved-views-update-${row.view_name}`"
                @click.stop="onUpdate(row)"
              >
                <OIcon name="edit" size="xs" />
              </OButton>
              <OButton
                variant="ghost-neutral"
                size="icon-sm"
                :title="t('common.delete')"
                :data-test="`metrics-saved-views-delete-${row.view_name}`"
                @click.stop="askDelete(row)"
              >
                <OIcon name="delete" size="xs" />
              </OButton>
            </div>
          </template>

          <template #empty>
            <div class="text-center p-2 w-full text-text-secondary">
              {{ t("metrics.explorer.savedViews.empty") }}
            </div>
          </template>
        </OTable>
      </div>
    </ODialog>

    <!-- Create / update dialog: name the view (OForm + Zod). -->
    <ODialog
      v-model:open="formOpen"
      size="md"
      form-id="metrics-saved-view-form"
      :title="t('metrics.explorer.savedViews.saveTitle')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('common.save')"
      data-test="metrics-saved-views-form-dialog"
      @click:secondary="formOpen = false"
    >
      <OForm
        id="metrics-saved-view-form"
        :schema="schema"
        :default-values="formDefaults"
        class="flex flex-col gap-5"
        @submit="onSubmit"
      >
        <p class="text-xs text-text-secondary">
          {{ t("metrics.explorer.savedViews.saveDesc") }}
        </p>
        <OFormInput
          name="savedViewName"
          :label="t('metrics.explorer.savedViews.nameLabel')"
          data-test="metrics-saved-views-name-input"
          required
        />
      </OForm>
    </ODialog>

    <!-- Delete confirm. -->
    <ConfirmDialog
      v-model="confirmDeleteOpen"
      :title="t('metrics.explorer.savedViews.deleteTitle')"
      :message="
        t('metrics.explorer.savedViews.deleteConfirm', {
          name: pendingDelete?.view_name ?? '',
        })
      "
      data-test="metrics-saved-views-delete-confirm"
      @update:ok="confirmDelete"
      @update:cancel="confirmDeleteOpen = false"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useMetricsSavedViews, {
  type MetricsSavedView,
  type MetricsSavedViewSnapshot,
} from "@/composables/metrics/useMetricsSavedViews";
import { makeMetricsSavedViewSchema } from "./MetricsSavedView.schema";

export default defineComponent({
  name: "MetricsSavedViews",
  components: {
    OButton,
    OButtonGroup,
    OIcon,
    OTooltip,
    ODialog,
    OTable,
    OSearchInput,
    OForm,
    OFormInput,
    ConfirmDialog,
  },
  props: {
    /** Returns the snapshot of the CURRENT explorer state to save. Provided by
     *  the parent, which owns the grid/filter state. */
    buildSnapshot: {
      type: Function as PropType<() => MetricsSavedViewSnapshot>,
      required: true,
    },
  },
  emits: ["apply"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const savedViews = useMetricsSavedViews();

    const listOpen = ref(false);
    const formOpen = ref(false);
    const confirmDeleteOpen = ref(false);
    const pendingDelete = ref<MetricsSavedView | null>(null);
    // Text filter for the list dialog (client-side, via OTable's globalFilter).
    const listFilter = ref("");
    // When set, the form dialog is editing THIS view (save overwrites it);
    // otherwise the form creates a new one.
    const pendingUpdate = ref<MetricsSavedView | null>(null);

    const schema = computed(() => makeMetricsSavedViewSchema(t));
    const formDefaults = computed(() => ({
      isSavedViewAction: pendingUpdate.value ? "update" : "create",
      savedViewName: pendingUpdate.value?.view_name ?? "",
      savedViewSelectedName: "",
    }));

    const listColumns = computed(() => [
      {
        id: "view_name",
        header: t("metrics.explorer.savedViews.nameColumn"),
        accessorKey: "view_name",
        align: "left" as const,
        isName: true,
      },
      {
        id: "actions",
        header: "",
        align: "right" as const,
        isAction: true,
      },
    ]);

    onMounted(() => {
      savedViews.listViews();
    });

    const openList = async () => {
      listOpen.value = true;
      await savedViews.listViews();
    };

    const openCreate = () => {
      pendingUpdate.value = null;
      formOpen.value = true;
    };

    // Edit: reopen the name dialog seeded with this view; save overwrites it.
    const onUpdate = (row: MetricsSavedView) => {
      pendingUpdate.value = row;
      formOpen.value = true;
    };

    const onSubmit = async (values: Record<string, any>) => {
      const snapshot = props.buildSnapshot();
      const name = values.savedViewName.trim();
      if (pendingUpdate.value) {
        await savedViews.updateView(pendingUpdate.value.view_id, name, snapshot);
      } else {
        await savedViews.createView(name, snapshot);
      }
      pendingUpdate.value = null;
      formOpen.value = false;
    };

    const onApply = async (row: MetricsSavedView) => {
      const snapshot = await savedViews.getViewSnapshot(row.view_id);
      if (snapshot) {
        savedViews.activeViewId.value = row.view_id;
        emit("apply", snapshot);
      }
      listOpen.value = false;
    };

    const askDelete = (row: MetricsSavedView) => {
      pendingDelete.value = row;
      confirmDeleteOpen.value = true;
    };

    const confirmDelete = async () => {
      if (pendingDelete.value) {
        await savedViews.deleteView(pendingDelete.value.view_id);
      }
      confirmDeleteOpen.value = false;
      pendingDelete.value = null;
    };

    return {
      t,
      savedViews,
      listOpen,
      formOpen,
      confirmDeleteOpen,
      pendingDelete,
      listFilter,
      schema,
      formDefaults,
      listColumns,
      openList,
      openCreate,
      onUpdate,
      onSubmit,
      onApply,
      askDelete,
      confirmDelete,
    };
  },
});
</script>
