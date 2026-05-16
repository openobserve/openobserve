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
    <OButton
      variant="outline"
      size="sm"
      @click="openValueMappingPopUp"
      data-test="dashboard-addpanel-config-value-mapping-add-btn"
    >
      {{
        dashboardPanelData.data.config.mappings.length
          ? t("dashboard.editValueMapping")
          : t("dashboard.addValueMapping")
      }}
    </OButton>
    <ValueMappingPopUp
      :open="showValueMappingPopUp"
      :value-mapping="
        JSON.parse(JSON.stringify(dashboardPanelData.data.config.mappings))
      "
      @close="showValueMappingPopUp = false"
      @save="saveValueMappingConfig"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import ValueMappingPopUp from "./ValueMappingPopUp.vue";
import { onBeforeMount } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";

export default defineComponent({
  name: "ValueMapping",
  components: { ValueMappingPopUp, OButton },
  props: [],
  setup() {
    const { t } = useI18n();
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const showValueMappingPopUp = ref(false);

    const openValueMappingPopUp = () => {
      showValueMappingPopUp.value = true;
    };

    onBeforeMount(() => {
      // Ensure that the drilldown object is initialized in config
      if (!dashboardPanelData.data.config.mappings) {
        dashboardPanelData.data.config.mappings = [];
      }
    });

    const saveValueMappingConfig = (valueMapping: any) => {
      dashboardPanelData.data.config.mappings = valueMapping;
      showValueMappingPopUp.value = false;
    };

    return {
      t,
      dashboardPanelData,
      showValueMappingPopUp,
      openValueMappingPopUp,
      saveValueMappingConfig,
    };
  },
});
</script>

<style lang="scss" scoped></style>
