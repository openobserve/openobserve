<!-- Copyright 2026 OpenObserve Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div>
    <div
      v-for="(,index) in dashboardPanelData.data.config.mark_line"
      :key="index"
    >
      <div
        style="
          display: flex;
          justify-content: space-between;
          margin-bottom: 5px;
          border-bottom: 1px solid gray;
        "
      >
        <div style="width: 90%">
          <q-select
            v-model="dashboardPanelData.data.config.mark_line[index].type"
            :label="t('dashboard.markLineType')"
            :options="markLineTypeOptions"
            input-debounce="0"
            behavior="menu"
            borderless
            dense
            style="width: 100%"
            class="q-py-sm showLabelOnTop"
            stack-label
            emit-value
            :data-test="`dashboard-config-markline-type-${index}`"
            hide-bottom-space
          ></q-select>
          <q-input
            v-model="dashboardPanelData.data.config.mark_line[index].name"
            :label="t('dashboard.markLineLabel')"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop"
            stack-label
            dense
            borderless
            label-slot
            style="width: 100%"
            :data-test="`dashboard-config-markline-name-${index}`"
            hide-bottom-space
          />
          <q-input
            v-if="
              ['xAxis', 'yAxis'].includes(
                dashboardPanelData.data.config.mark_line[index].type,
              )
            "
            v-model="dashboardPanelData.data.config.mark_line[index].value"
            :label="t('dashboard.markLineValue')"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop"
            borderless
            stack-label
            dense
            label-slot
            style="width: 100%"
            :data-test="`dashboard-config-markline-value-${index}`"
            hide-bottom-space
          />
        </div>

        <q-icon
          class="q-mr-xs"
          size="15px"
          name="close"
          style="cursor: pointer"
          @click="removeMarkLineByIndex(index)"
          :data-test="`dashboard-addpanel-config-markline-remove-${index}`"
        />
      </div>
    </div>
    <OButton
      variant="outline"
      size="sm"
      @click="addNewMarkLine"
      data-test="dashboard-addpanel-config-markline-add-btn"
      >{{ t("dashboard.markLineAdd") }}</OButton
    >
  </div>
</template>

<script lang="ts">
import { defineComponent, inject } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import { onBeforeMount } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";

export default defineComponent({
  name: "MarkLineConfig",
  components: { OButton },
  setup() {
    const store = useStore();
    const { t } = useI18n();

    const markLineTypeOptions = [
      { label: t("dashboard.markLineAverage"), value: "average" },
      { label: t("dashboard.markLineMedian"), value: "median" },
      { label: t("dashboard.markLineMin"), value: "min" },
      { label: t("dashboard.markLineMax"), value: "max" },
      { label: t("dashboard.markLineXAxis"), value: "xAxis" },
      { label: t("dashboard.markLineYAxis"), value: "yAxis" },
    ];

    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    onBeforeMount(() => {
      // Ensure that the mark_line object is initialized in config
      if (!dashboardPanelData.data.config.mark_line) {
        dashboardPanelData.data.config.mark_line = [];
      }
    });

    const addNewMarkLine = () => {
      dashboardPanelData.data.config.mark_line.push({
        name: "",
        type: "yAxis",
        value: "",
      });
    };

    const removeMarkLineByIndex = (index: any) => {
      dashboardPanelData.data.config.mark_line.splice(index, 1);
    };

    return {
      t,
      store,
      dashboardPanelData,
      markLineTypeOptions,
      removeMarkLineByIndex,
      addNewMarkLine,
    };
  },
});
</script>

<style lang="scss" scoped></style>
