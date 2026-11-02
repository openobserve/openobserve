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
  <div class="flex flex-col gap-2.5">
    <OSelect
      v-show="isOptionVisible('alert-list-folder')"
      v-model="folderModel"
      :options="folderOptions"
      :label="t('dashboard.alertListFolder')"
      :loading="folders.isPending.value"
      data-test="dashboard-config-alert_list_folder"
    />
    <OSelect
      v-show="isOptionVisible('alert-list-state')"
      :model-value="stateModel"
      :options="stateOptions"
      multiple
      :label="t('dashboard.alertListState')"
      :placeholder="defaultHint(t, t('dashboard.alertListStatePlaceholder'))"
      data-test="dashboard-config-alert_list_state"
      @update:model-value="(value: any) => setListConfig('alert_list_state', value)"
    />
    <OSelect
      v-show="isOptionVisible('alert-list-sort')"
      v-model="sortModel"
      :options="sortOptions"
      :label="t('dashboard.alertListSort')"
      data-test="dashboard-config-alert_list_sort"
      :data-test-selected-value="sortModel"
    />
    <OInput
      v-show="isOptionVisible('alert-list-max')"
      :model-value="config.alert_list_max ?? null"
      type="number"
      :min="1"
      :max="ALERT_LIST_MAX_LIMIT"
      :label="t('dashboard.alertListMax')"
      :placeholder="defaultPlaceholder(t, ALERT_LIST_DEFAULT_MAX)"
      data-test="dashboard-config-alert_list_max"
      @update:model-value="(value: any) => setNumberConfig('alert_list_max', value)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { DEFAULT_CHOICE, useHtmlPanelConfig } from "@/composables/dashboard/useHtmlPanelConfig";
import { optionalFoldersQuery } from "@/services/common.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  ALERT_LIST_DEFAULT_MAX,
  ALERT_LIST_MAX_LIMIT,
  ALERT_LIST_SORTS,
  DEFAULT_ALERT_LIST_SORT,
  type AlertListSort,
} from "@/utils/dashboard/alertListPanel";
import {
  defaultHint,
  defaultPlaceholder,
  withDefaultChoice,
} from "@/utils/dashboard/optionDefaults";

withDefaults(defineProps<{ isOptionVisible?: (optionId: string) => boolean }>(), {
  isOptionVisible: () => true,
});

// Not a folder id: picking it clears the key, so the panel lists every folder.
const ALL_FOLDERS = "__all_folders__";

const { t } = useI18nTyped();
const store = useStore();
const pageKey = inject("dashboardPanelDataPageKey", "dashboard");
const { dashboardPanelData } = useDashboardPanelData(pageKey, t);
const { config, setTextConfig, setNumberConfig, setListConfig, listModel, choiceModel } =
  useHtmlPanelConfig(dashboardPanelData);

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const folders = useQuery(() =>
  Object.assign(optionalFoldersQuery(org.value, "alerts"), { enabled: !!org.value }),
);
const folderOptions = computed<{ label: I18nText; value: string }[]>(() => [
  { label: defaultHint(t, t("dashboard.alertListAllFolders")), value: ALL_FOLDERS },
  ...(folders.data.value?.folders ?? []).map((folder) => ({
    label: raw(folder.name),
    value: folder.folderId,
  })),
]);
const folderModel = computed({
  get: () => config.value.alert_list_folder || ALL_FOLDERS,
  set: (value: string) => setTextConfig("alert_list_folder", value === ALL_FOLDERS ? "" : value),
});

const stateModel = listModel("alert_list_state");
const stateOptions = computed<{ label: I18nText; value: string }[]>(() => [
  { label: t("components.badge.alertState.firing"), value: "firing" },
  { label: t("common.error"), value: "error" },
  { label: t("components.badge.alertState.pending"), value: "pending" },
  { label: t("components.badge.alertState.ok"), value: "ok" },
  { label: t("components.badge.alertStatus.paused"), value: "paused" },
]);

const sortModel = choiceModel<AlertListSort>("alert_list_sort", ALERT_LIST_SORTS);
const sortOptions = withDefaultChoice(
  t,
  DEFAULT_CHOICE,
  [
    { label: t("dashboard.alertListSortState"), value: "state" },
    { label: t("dashboard.alertListSortName"), value: "name" },
    { label: t("dashboard.alertListSortTime"), value: "time" },
  ],
  DEFAULT_ALERT_LIST_SORT,
);
</script>
