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
  <ODialog
    data-test="search-bar-search-scheduler-job-dialog"
    v-model:open="isOpen"
    size="md"
    :title="t('search.scheduleSearchJob')"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    @click:secondary="onCancel"
    @click:primary="onSubmit"
  >
    <div>
      <div class="text-left q-mb-xs">
        {{ t("search.noOfRecords") }}:
        <q-icon name="info" size="17px" class="q-ml-xs cursor-pointer">
          <q-tooltip
            anchor="center right"
            self="center left"
            max-width="300px"
          >
            <span style="font-size: 14px">{{
              t("search.noOfRecordsTooltip")
            }}</span>
          </q-tooltip>
        </q-icon>
      </div>
      <q-input
        type="number"
        data-test="search-scheuduler-max-number-of-records-input"
        v-model="searchObj.meta.jobRecords"
        default-value="100"
        color="input-border"
        bg-color="input-bg"
        class="showLabelOnTop"
        stack-label
        borderless
        dense
        tabindex="0"
        min="100"
      />
    </div>
    <div class="text-left">
      {{ t("search.maxEventsScheduleJob") }}
    </div>
    <div
      style="opacity: 0.8"
      class="text-left mapping-warning-msg q-mt-md"
    >
      <q-icon name="warning" color="red" class="q-mr-sm" />
      <span>{{ t("search.histogramDisabledScheduleJob") }}</span>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import useLogs from "@/composables/useLogs";

const { t } = useI18n();
const $q = useQuasar();
const { searchObj } = useLogs();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  submitted: [];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});

const onCancel = () => {
  searchObj.meta.showSearchScheduler = false;
};

const onSubmit = async () => {
  try {
    if (
      !searchObj.data.stream.selectedStream ||
      searchObj.data.stream.selectedStream.length === 0
    ) {
      $q.notify({
        type: "negative",
        message: "Please select a stream before scheduling a job",
        timeout: 3000,
      });
      return;
    }
    if (searchObj.meta.jobId != "") {
      $q.notify({
        type: "negative",
        message: t("search.jobAlreadyScheduled"),
        timeout: 3000,
      });
      return;
    }
    if (
      searchObj.meta.jobRecords > 100000 ||
      searchObj.meta.jobRecords == 0 ||
      searchObj.meta.jobRecords < 0
    ) {
      $q.notify({
        type: "negative",
        message: t("search.jobSchedulerRange"),
        timeout: 3000,
      });
      return;
    }

    searchObj.meta.showSearchScheduler = false;
    emit("submitted");
  } catch (e: any) {
    if (e.response?.status != 403) {
      $q.notify({
        type: "negative",
        message: t("search.errorAddingJob"),
        timeout: 3000,
      });
    }
  }
};
</script>
