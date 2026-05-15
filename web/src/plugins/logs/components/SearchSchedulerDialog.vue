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
  <q-dialog v-model="isOpen">
    <q-card style="width: 700px; max-width: 80vw">
      <q-card-section>
        <div class="text-h6">{{ t("search.scheduleSearchJob") }}</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
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
            data-test="logs-search-scheduler-max-records-input"
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
      </q-card-section>

      <q-card-actions align="right" class="tw:gap-2">
        <OButton
          data-test="logs-search-scheduler-cancel-btn"
          variant="outline"
          size="sm-action"
          v-close-popup
          @click="onCancel"
          >{{ t("confirmDialog.cancel") }}</OButton
        >
        <OButton
          data-test="logs-search-scheduler-submit-btn"
          variant="primary"
          size="sm-action"
          @click="onSubmit"
          v-close-popup
          >{{ t("confirmDialog.ok") }}</OButton
        >
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import OButton from "@/lib/core/Button/OButton.vue";
import useLogs from "@/composables/useLogs";
import searchService from "@/services/search";

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
