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
  <ODropdown align="end">
    <template #trigger>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="bookmark"
        icon-right="arrow-drop-down"
        data-test="metrics-explorer-views-btn"
      >
        {{ buttonLabel }}
      </OButton>
    </template>

    <ODropdownItem
      v-for="view in views"
      :key="view.view_id"
      :data-test="`metrics-explorer-view-${view.view_id}`"
      @select="applyView(view)"
    >
      {{ view.view_name }}
    </ODropdownItem>
    <ODropdownItem v-if="!views.length" disabled data-test="metrics-explorer-views-none">
      {{ t("metrics.explorer.views.none") }}
    </ODropdownItem>
    <ODropdownSeparator />
    <ODropdownItem
      icon-left="bookmark-add"
      data-test="metrics-explorer-views-save-as"
      @select="saveDialogOpen = true"
    >
      {{ t("metrics.explorer.views.saveAs") }}
    </ODropdownItem>
    <template v-if="activeView">
      <ODropdownItem
        icon-left="save"
        data-test="metrics-explorer-views-update"
        @select="updateActive"
      >
        {{ t("metrics.explorer.views.update", { name: activeView.view_name }) }}
      </ODropdownItem>
      <ODropdownItem
        variant="destructive"
        icon-left="delete"
        data-test="metrics-explorer-views-delete"
        @select="deleteDialogOpen = true"
      >
        {{ t("metrics.explorer.views.delete", { name: activeView.view_name }) }}
      </ODropdownItem>
    </template>
  </ODropdown>

  <ODialog
    v-model:open="saveDialogOpen"
    size="sm"
    form-id="metrics-explorer-view-form"
    :title="t('metrics.explorer.views.saveTitle')"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('common.save')"
    data-test="metrics-explorer-views-save-dialog"
    @click:secondary="saveDialogOpen = false"
  >
    <OForm
      id="metrics-explorer-view-form"
      :schema="viewSchema"
      :default-values="{ viewName: '' }"
      @submit="saveAs"
    >
      <OFormInput
        name="viewName"
        :label="t('metrics.explorer.views.name')"
        required
        data-test="metrics-explorer-views-name"
      />
    </OForm>
  </ODialog>

  <ConfirmDialog
    v-model="deleteDialogOpen"
    :title="t('metrics.explorer.views.deleteTitle')"
    :message="t('metrics.explorer.views.deleteMessage', { name: activeView?.view_name ?? '' })"
    @update:ok="deleteActive"
    @update:cancel="deleteDialogOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import savedViews, { viewTypeOf } from "@/services/saved_views";
import {
  createSavedViewMutation,
  deleteSavedViewMutation,
  savedViewsQuery,
  updateSavedViewMutation,
} from "@/services/saved_views.queries";
import {
  METRICS_EXPLORER_VIEW_TYPE,
  buildExplorerViewData,
  explorerViewToQuery,
  sameExplorerViewState,
  type ExplorerViewState,
} from "@/utils/metrics/explorerSavedView";
import { makeExplorerViewSchema, type ExplorerViewForm } from "./ExplorerSavedViews.schema";
import { toast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

interface ViewSummary {
  view_id: string;
  view_name: string;
  view_type?: string | null;
}

const props = defineProps<{
  /** The grid's current URL slice; only its allow-listed keys are saved. */
  state: Record<string, unknown>;
}>();

const emit = defineEmits<{
  apply: [query: ExplorerViewState];
  saved: [action: "created" | "updated"];
}>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const viewSchema = makeExplorerViewSchema(t);

const viewsList = useQuery(() =>
  Object.assign(savedViewsQuery(orgId.value), { enabled: !!orgId.value }),
);
// The list is shared with the logs page; each page shows only its own type.
const views = computed<ViewSummary[]>(() =>
  (viewsList.data.value ?? []).filter(
    (v: ViewSummary) => viewTypeOf(v) === METRICS_EXPLORER_VIEW_TYPE,
  ),
);

// Parent-owned: this menu unmounts with the grid, and Update/Delete must still find the view.
const activeViewId = defineModel<string | null>("activeViewId", { default: null });
const activeView = computed(() => views.value.find((v) => v.view_id === activeViewId.value));
// What the active view saved, to tell when the grid has moved off it; parent-owned like the id.
const activeViewState = defineModel<ExplorerViewState | null>("activeViewState", {
  default: null,
});
const modified = computed(
  () =>
    !!activeView.value &&
    !!activeViewState.value &&
    !sameExplorerViewState(activeViewState.value, props.state),
);
const buttonLabel = computed(() => {
  if (!activeView.value) return t("metrics.explorer.views.label");
  const name = activeView.value.view_name;
  return modified.value ? t("metrics.explorer.views.modified", { name }) : raw(name);
});

const saveDialogOpen = ref(false);
const deleteDialogOpen = ref(false);

const createView = useMutation(() => createSavedViewMutation(orgId.value));
const updateView = useMutation(() => updateSavedViewMutation(orgId.value));
const deleteView = useMutation(() => deleteSavedViewMutation(orgId.value));

// The server's message is shown as-is: it names the conflict (a duplicate name).
const showError = (err: any, fallback: I18nText) =>
  toast({ variant: "error", message: raw(err?.response?.data?.message) || fallback });

const payload = (viewName: string) => ({
  data: buildExplorerViewData(props.state),
  view_name: viewName,
  view_type: METRICS_EXPLORER_VIEW_TYPE,
});

const saveAs = async (value: ExplorerViewForm) => {
  try {
    const res: any = await createView.mutateAsync(payload(value.viewName));
    activeViewId.value = res?.data?.view_id ?? null;
    activeViewState.value = { ...props.state } as ExplorerViewState;
    saveDialogOpen.value = false;
    toast({ variant: "success", message: t("metrics.explorer.views.saved") });
    emit("saved", "created");
  } catch (err) {
    showError(err, t("metrics.explorer.views.saveFailed"));
  }
};

const updateActive = async () => {
  const view = activeView.value;
  if (!view) return;
  try {
    await updateView.mutateAsync({ viewId: view.view_id, view: payload(view.view_name) });
    activeViewState.value = { ...props.state } as ExplorerViewState;
    toast({ variant: "success", message: t("metrics.explorer.views.updated") });
    emit("saved", "updated");
  } catch (err) {
    showError(err, t("metrics.explorer.views.saveFailed"));
  }
};

const deleteActive = async () => {
  const view = activeView.value;
  if (!view) return;
  try {
    await deleteView.mutateAsync(view.view_id);
    activeViewId.value = null;
    activeViewState.value = null;
    toast({ variant: "success", message: t("metrics.explorer.views.deleted") });
  } catch (err) {
    showError(err, t("metrics.explorer.views.deleteFailed"));
  }
};

const applyView = async (view: ViewSummary) => {
  try {
    // Uncached: a shared view must apply as it is saved now.
    const res: any = await savedViews.getViewDetail(orgId.value, view.view_id);
    const query = explorerViewToQuery(res?.data?.data);
    if (!query) throw new Error("unreadable view");
    activeViewId.value = view.view_id;
    activeViewState.value = query;
    emit("apply", query);
  } catch (err) {
    showError(err, t("metrics.explorer.views.applyFailed"));
  }
};
</script>
