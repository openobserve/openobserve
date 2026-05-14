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
    <q-card>
      <q-card-section>
        {{ t("search.customDownloadMessage") }}
      </q-card-section>

      <q-card-section>
        <q-input
          type="number"
          data-test="logs-custom-download-initial-number-input"
          v-model="downloadCustomInitialNumber"
          :label="t('search.initialNumber')"
          default-value="1"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          tabindex="0"
          min="1"
        />
        <q-select
          data-test="logs-custom-download-range-select"
          v-model="downloadCustomRange"
          :options="downloadCustomRangeOptions"
          :label="t('search.range')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-sm showLabelOnTop"
          stack-label
          outlined
          filled
          dense
        />
        <div class="q-py-sm file-type">
          <label class="q-pr-sm">{{ t("search.fileType") }}</label
          ><br />
          <OButtonGroup
            data-test="logs-custom-download-file-type-button-group"
            class="file-type-button-group q-mt-xs"
          >
            <OButton
              v-for="option in downloadCustomFileTypeOptions"
              :key="option.value"
              :data-test="`logs-custom-download-file-type-${option.value}-btn`"
              :active="downloadCustomFileType === option.value"
              variant="outline"
              size="sm"
              @click="downloadCustomFileType = option.value"
              >{{ option.label }}</OButton
            >
          </OButtonGroup>
        </div>
      </q-card-section>

      <q-card-actions align="right" class="tw:gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          data-test="logs-custom-download-cancel-btn"
          v-close-popup
          >{{ t("confirmDialog.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm-action"
          data-test="logs-custom-download-ok-btn"
          @click="downloadRangeData"
          >{{ t("search.btnDownload") }}</OButton
        >
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import OButton from "@/lib/core/Button/OButton.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import useLogs from "@/composables/useLogs";
import searchService from "@/services/search";
import downloadLogs from "@/utils/logs/downloadLogs";

const { t } = useI18n();
const $q = useQuasar();
const { searchObj } = useLogs();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});

const downloadCustomInitialNumber = ref(1);
const downloadCustomRange = ref(100);
const downloadCustomRangeOptions = [100, 500, 1000, 5000, 10000];
const downloadCustomFileType = ref<"csv" | "json">("csv");
const downloadCustomFileTypeOptions = [
  { label: "CSV", value: "csv" },
  { label: "JSON", value: "json" },
];

const downloadRangeData = () => {
  const initNumber = downloadCustomInitialNumber.value;
  if (initNumber < 0) {
    $q.notify({
      message: "Initial number must be positive number.",
      color: "negative",
      position: "bottom",
      timeout: 2000,
    });
    return;
  }
  if (!searchObj.data?.customDownloadQueryObj?.query) {
    $q.notify({
      message: "Please run a query first before downloading.",
      color: "negative",
      position: "bottom",
      timeout: 2000,
    });
    return;
  }
  searchObj.data.customDownloadQueryObj.query.from =
    initNumber === 0 ? 0 : initNumber - 1;
  searchObj.data.customDownloadQueryObj.query.size =
    downloadCustomRange.value;

  searchService
    .search(
      {
        org_identifier: searchObj.organizationIdentifier,
        query: searchObj.data.customDownloadQueryObj,
        page_type: searchObj.data.stream.streamType,
      },
      "ui",
    )
    .then((res) => {
      isOpen.value = false;
      if (res.data.hits.length > 0) {
        downloadLogs(res.data.hits, downloadCustomFileType.value);
      } else {
        $q.notify({
          message: "No data found to download.",
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });
      }
    })
    .catch((err) => {
      console.error("[CustomDownloadDialog] downloadRangeData error:", err);
    });
};
</script>
