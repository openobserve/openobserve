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
    <div style="font-size: 14px; padding-bottom: 5px">Data Link :</div>
    <div v-for="(data, index) in dataLink" :key="JSON.stringify(data)">
      <div
        style="
          display: flex;
          justify-content: space-between;
          margin-bottom: 5px;
        "
      >
        <div
          :onclick="onDataLinkClick"
          style="
            cursor: pointer;
            text-decoration: underline;
            padding-left: 20px;
            width: 250px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          "
        >
          {{ data.name }}
        </div>
        <q-icon
          class="q-mr-xs"
          size="20px"
          name="close"
          style="cursor: pointer"
          @click="removeDataLink(index)"
        />
      </div>
    </div>
    <q-btn
      @click="onDataLinkClick"
      style="cursor: pointer; padding: 0px 5px"
      label="+ Add link"
      no-caps
    />
    <q-dialog v-model="showDrilldownPopUp">
      <drilldown-pop-up
        @close="() => (showDrilldownPopUp = false)"
        :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
        :drilldown-data="drilldownData"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import DrilldownPopUp from "./DrilldownPopUp.vue";
import { useStore } from "vuex";

export default defineComponent({
  name: "Drilldown",
  components: { DrilldownPopUp },
  setup() {
    const store = useStore();
    const showDrilldownPopUp = ref(false);
    const dataLink: any = ref([
      {
        name: "Drill down 1 asfdhk dfashsj ewfjklsda;lkewfsd",
      },
      {
        name: "Drill down 2",
      },
      {
        name: "Drill down 3",
      },
    ]);
    const drilldownData: any = ref({
      name: "",
      type: "",
      targetBlank: false,
      findBy: "name",
      data: {
        url: "",
        folder: "",
        dashboard: "",
        tab: "",
        passAllVariables: true,
        variables: [
          {
            name: "",
            value: "",
          },
        ],
      },
    });


    const onDataLinkClick = () => {
      console.log("onDataLinkClick");

      showDrilldownPopUp.value = true;
    };

    const removeDataLink = (index: any) => {
      dataLink.value.splice(index, 1);
    };

    return {
      store,
      dataLink,
      onDataLinkClick,
      showDrilldownPopUp,
      removeDataLink,
      drilldownData,
    };
  },
});
</script>

<style lang="scss" scoped></style>
