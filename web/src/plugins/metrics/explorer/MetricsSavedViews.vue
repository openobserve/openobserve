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
  <div class="flex items-center gap-1" data-test="metrics-saved-views">
    <!-- Open the list of saved views -->
    <OButton
      variant="outline"
      size="sm-action"
      icon-left="bookmark-border"
      data-test="metrics-saved-views-list-btn"
      @click="openList"
    >
      {{ t("metrics.explorer.savedViews.button") }}
      <OTag
        v-if="savedViews.views.value.length"
        type="countChip"
        value="primary"
        size="xs"
        class="ml-1"
        data-test="metrics-saved-views-count"
        >{{ savedViews.views.value.length }}</OTag
      >
      <OTooltip :content="t('metrics.explorer.savedViews.listTooltip')" />
    </OButton>

    <!-- Save the current explorer state as a new view -->
    <OButton
      variant="ghost"
      size="icon"
      icon-left="add"
      data-test="metrics-saved-views-create-btn"
      @click="openCreate"
    >
      <OTooltip :content="t('metrics.explorer.savedViews.createTooltip')" />
    </OButton>

    <!-- List dialog: apply or delete a saved view. -->
    <ODialog
      v-model:open="listOpen"
      size="md"
      :title="t('metrics.explorer.savedViews.listTitle')"
      :secondary-button-label="t('confirmDialog.cancel')"
      data-test="metrics-saved-views-list-dialog"
      @click:secondary="listOpen = false"
    >
      <OTable
        :data="savedViews.views.value"
        :columns="listColumns"
        :loading="savedViews.loading.value"
        :frame="false"
        data-test="metrics-saved-views-table"
      >
        <template #cell-actions="{ row }">
          <div class="flex items-center gap-1 justify-end">
            <OButton
              variant="ghost-primary"
              size="xs"
              :data-test="`metrics-saved-views-apply-${row.view_name}`"
              @click="onApply(row)"
            >
              {{ t("metrics.explorer.savedViews.apply") }}
            </OButton>
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="delete"
              :aria-label="
                t('metrics.explorer.savedViews.deleteAria', {
                  name: row.view_name,
                })
              "
              :data-test="`metrics-saved-views-delete-${row.view_name}`"
              @click="askDelete(row)"
            />
          </div>
        </template>
      </OTable>
      <OEmptyState
        v-if="!savedViews.loading.value && !savedViews.views.value.length"
        size="block"
        preset="no-data"
        :title="t('metrics.explorer.savedViews.empty')"
        :description="t('metrics.explorer.savedViews.emptyHint')"
        data-test="metrics-saved-views-empty"
      />
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
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
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
    OTag,
    OTooltip,
    ODialog,
    OTable,
    OForm,
    OFormInput,
    OEmptyState,
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

    const schema = computed(() => makeMetricsSavedViewSchema(t));
    const formDefaults = {
      isSavedViewAction: "create",
      savedViewName: "",
      savedViewSelectedName: "",
    };

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
      formOpen.value = true;
    };

    const onSubmit = async (values: Record<string, any>) => {
      const snapshot = props.buildSnapshot();
      await savedViews.createView(values.savedViewName.trim(), snapshot);
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
      schema,
      formDefaults,
      listColumns,
      openList,
      openCreate,
      onSubmit,
      onApply,
      askDelete,
      confirmDelete,
    };
  },
});
</script>
