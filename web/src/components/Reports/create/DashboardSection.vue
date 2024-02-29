<template>
  <div class="q-my-sm q-px-sm flex items-center justify-start">
    <div
      data-test="add-report-dashboard-select"
      class="o2-input q-mr-sm"
      style="padding-top: 0; width: 30%"
    >
      <q-select
        v-model="formData.selected_dashboard.folder_id"
        :options="folderOptions"
        :label="t('reports.dashboardFolder') + ' *'"
        :loading="isFetchingFolders"
        :popup-content-style="{ textTransform: 'lowercase' }"
        color="input-border"
        bg-color="input-bg"
        class="q-py-sm showLabelOnTop no-case"
        filled
        stack-label
        dense
        use-input
        hide-selected
        fill-input
        :input-debounce="400"
        @update:model-value="
          onFolderSelection(formData.selected_dashboard.folder_id)
        "
        behavior="menu"
        :rules="[(val: any) => !!val || 'Field is required!']"
        style="min-width: 250px !important; width: 100% !important"
      />
    </div>
    <div
      data-test="add-alert-stream-select"
      class="o2-input q-mr-sm"
      style="padding-top: 0; width: 30%"
    >
      <q-select
        v-model="formData.selected_dashboard.dashboard_id"
        :options="dashboardOptions"
        :label="t('reports.dashboard') + ' *'"
        :loading="isFetchingDashboard"
        :popup-content-style="{ textTransform: 'lowercase' }"
        color="input-border"
        bg-color="input-bg"
        class="q-py-sm showLabelOnTop no-case"
        filled
        stack-label
        dense
        use-input
        hide-selected
        fill-input
        :input-debounce="400"
        @update:model-value="
          onDashboardSelection(formData.selected_dashboard.dashboard_id)
        "
        behavior="menu"
        :rules="[(val: any) => !!val || 'Field is required!']"
        style="min-width: 250px !important; width: 100% !important"
      />
    </div>
    <div
      data-test="add-alert-stream-select"
      class="o2-input"
      style="padding-top: 0; width: 30%"
    >
      <q-select
        v-model="formData.selected_dashboard.tab_id"
        :options="dashboardTabOptions"
        :label="t('reports.dashboardTab') + ' *'"
        :loading="isFetchingDashboard"
        :popup-content-style="{ textTransform: 'lowercase' }"
        color="input-border"
        bg-color="input-bg"
        class="q-py-sm showLabelOnTop no-case"
        filled
        stack-label
        dense
        use-input
        hide-selected
        fill-input
        :input-debounce="400"
        behavior="menu"
        :rules="[(val: any) => !!val || 'Field is required!']"
        style="min-width: 250px !important; width: 100% !important"
      />
    </div>

    <div class="full-width q-mt-sm">
      <div class="q-mb-sm">
        <div style="font-size: 14px" class="text-bold text-grey-8">
          Time Range*
        </div>
        <div style="font-size: 12px">
          Generates report with the data from specified time range
        </div>
      </div>
      <DateTime
        auto-apply
        :default-type="formData.time_range.type"
        :default-absolute-time="{
          startTime: formData.time_range.from,
          endTime: formData.time_range.to,
        }"
        :default-relative-time="formData.time_range.period"
        data-test="logs-search-bar-date-time-dropdown"
        @on:date-change="updateDateTime"
      />
    </div>

    <div class="full-width q-mt-md o2-input">
      <div style="font-size: 14px" class="text-bold text-grey-8">Variables</div>
      <VariablesInput
        :variables="formData.selected_dashboard.variables"
        @add:variable="addDashboardVariable"
        @remove:variable="removeDashboardVariable"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { defineProps } from "vue";
import { formatDate } from "@/utils/dashboard/convertDataIntoUnitValue";

const props = defineProps({
  formData: {
    type: Object,
    default: () => ({}),
  },
});

const { t } = useI18n();

const formData = ref(formData);
</script>
<style scoped></style>
