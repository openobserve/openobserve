<!-- Copyright 2023 Zinc Labs Inc.

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
    <div class="q-mb-sm" style="font-weight: 600">
      <span>Chip columns color</span>
      <q-btn no-caps padding="xs" class="" size="sm" flat icon="info_outline">
        <q-tooltip
          class="bg-grey-8"
          anchor="bottom middle"
          self="top middle"
          max-width="250px"
        >
          Create a chip for any column you set, and define a color by any of its
          value.
        </q-tooltip>
      </q-btn>
    </div>
    <div
      v-for="(data, index) in dashboardPanelData.data.config.chip_column"
      :key="JSON.stringify(data) + index"
    >
      <div
        style="
          display: flex;
          justify-content: space-between;
          margin-bottom: 5px;
        "
      >
        <div
          @click="onChipColumnClick(index)"
          style="
            cursor: pointer;
            padding-left: 10px;
            width: 250px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          "
        >
          {{ index + 1 }}. {{ data.column_name }}
        </div>
        <q-icon
          class="q-mr-xs"
          size="15px"
          name="close"
          style="cursor: pointer"
          @click="removeChipColumnByIndex(index)"
        />
      </div>
    </div>
    <q-btn
      @click="addNewChipColumn"
      style="cursor: pointer; padding: 0px 5px"
      label="+ Add"
      no-caps
    />
    <q-dialog v-model="showChipColumnPopUp">
      <ChipColumnPopUp
        :chip-column-data-index="selectedChipColumnIndexToEdit"
        :is-edit-mode="isChipColumnEditMode"
        :chip-column-data="chipColumnData"
        @close="saveChipColumnData"
        :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, inject, ref } from "vue";
import { useStore } from "vuex";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import { onBeforeMount } from "vue";
import ChipColumnPopUp from "@/components/dashboards/addPanel/ChipColumnPopUp.vue";

export default defineComponent({
  name: "ChipColumn",
  components: { ChipColumnPopUp },
  props: ["chipColumnData"],
  setup() {
    const store = useStore();
    const showChipColumnPopUp = ref(false);
    const isChipColumnEditMode = ref(false);
    const selectedChipColumnIndexToEdit: any = ref(null);

    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    onBeforeMount(() => {
      if (!dashboardPanelData.data.config.chip_column) {
        dashboardPanelData.data.config.chip_column = [];
      }
    });

    const onChipColumnClick = (index: any) => {
      selectedChipColumnIndexToEdit.value = index;
      isChipColumnEditMode.value = true;
      showChipColumnPopUp.value = true;
    };

    const addNewChipColumn = () => {
      isChipColumnEditMode.value = false;
      selectedChipColumnIndexToEdit.value = null;
      showChipColumnPopUp.value = true;
    };

    const removeChipColumnByIndex = (index: any) => {
      dashboardPanelData.data.config.chip_column.splice(index, 1);
    };

    const saveChipColumnData = () => {
      showChipColumnPopUp.value = false;
      selectedChipColumnIndexToEdit.value = null;
      isChipColumnEditMode.value = false;
    };

    return {
      store,
      dashboardPanelData,
      onChipColumnClick,
      showChipColumnPopUp,
      removeChipColumnByIndex,
      saveChipColumnData,
      addNewChipColumn,
      isChipColumnEditMode,
      selectedChipColumnIndexToEdit,
    };
  },
});
</script>
