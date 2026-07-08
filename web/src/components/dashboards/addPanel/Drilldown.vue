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
      v-for="(data, index) in dashboardPanelData.data.config.drilldown"
      :key="JSON.stringify(data) + index"
    >
      <div
        class="flex justify-between mb-1.25"
      >
        <div
          @click="onDrilldownClick(index)"
          class="cursor-pointer pl-2.5 w-62.5 truncate"
          :data-test="`dashboard-addpanel-config-drilldown-name-${index}`"
        >
          {{ index + 1 }}. {{ data.name }}
        </div>
        <OIcon
          class="mr-1 cursor-pointer"
          size="sm"
          name="close"
          @click="removeDrilldownByIndex(index)"
          :data-test="`dashboard-addpanel-config-drilldown-remove-${index}`"
        />
      </div>
    </div>
    <OButton
      variant="outline"
      size="sm"
      @click="addNewDrilldown"
      data-test="dashboard-addpanel-config-drilldown-add-btn"
    >
      + {{ t('common.add') }}
    </OButton>
    <DrilldownPopUp
      :key="drilldownPopUpKey"
      :open="showDrilldownPopUp"
      :drilldown-data-index="selectedDrilldownIndexToEdit"
      :is-edit-mode="isDrilldownEditMode"
      :variables-data="variablesData"
      @close="saveDrilldownData"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import DrilldownPopUp from "./DrilldownPopUp.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useStore } from "vuex";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import { onBeforeMount } from "vue";

export default defineComponent({
  name: "Drilldown",
  components: { DrilldownPopUp, OButton,
    OIcon,
},
  props: ["variablesData"],
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const showDrilldownPopUp = ref(false);
    const isDrilldownEditMode = ref(false);
    const selectedDrilldownIndexToEdit: any = ref(null);
    // Bumped on every open so the popup remounts fresh each time, ensuring the
    // saved folder/dashboard/tab are loaded into the form on the first edit.
    const drilldownPopUpKey = ref(0);

    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    onBeforeMount(() => {
      // Ensure that the drilldown object is initialized in config
      if (!dashboardPanelData.data.config.drilldown) {
        dashboardPanelData.data.config.drilldown = [];
      }
    });

    const onDrilldownClick = (index: any) => {
      selectedDrilldownIndexToEdit.value = index;
      isDrilldownEditMode.value = true;
      drilldownPopUpKey.value++;
      showDrilldownPopUp.value = true;
    };

    const addNewDrilldown = () => {
      isDrilldownEditMode.value = false;
      selectedDrilldownIndexToEdit.value = null;
      drilldownPopUpKey.value++;
      showDrilldownPopUp.value = true;
    };

    const removeDrilldownByIndex = (index: any) => {
      dashboardPanelData.data.config.drilldown.splice(index, 1);
    };

    const saveDrilldownData = () => {
      showDrilldownPopUp.value = false;
      selectedDrilldownIndexToEdit.value = null;
      isDrilldownEditMode.value = false;
    };

    return {
      t,
      store,
      dashboardPanelData,
      onDrilldownClick,
      showDrilldownPopUp,
      removeDrilldownByIndex,
      selectedDrilldownIndexToEdit,
      saveDrilldownData,
      addNewDrilldown,
      isDrilldownEditMode,
      drilldownPopUpKey,
    };
  },
});
</script>
