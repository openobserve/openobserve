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

<template>
  <div class="plotlycontainer">
    <div class="drag-allow">
      <PanelHeader
        :panelDataElement="props.data"
        :dashboardId="$route.query.dashboard"
        @clicked="onClickChild"
        @duplicatePanel="duplicatePanel"
        :draggable="props.draggable"
      />
    </div>
    <PanelSchemaRenderer
      :panelSchema="props.data"
      :selectedTimeObj="props.selectedTimeDate"
      :width="props.width"
      :height="props.height"
      :variablesData="props.variablesData"
    ></PanelSchemaRenderer>
  </div>
</template>

<script  lang="ts">
import { defineComponent } from "vue";
import PanelHeader from "./PanelHeader.vue";
import PanelSchemaRenderer from "./PanelSchemaRenderer.vue";

export default defineComponent({
  name: "PanelContainer",
  emits: ["updated:chart", "duplicatePanel"],
  props: ["data", "selectedTimeDate", "draggable","width", "height", "variablesData"],
  components: {
    PanelHeader,
    PanelSchemaRenderer
},
  setup(props) {
    //get props data
    const getPanelDataElement = () => {
      return props.data;
    };
    return {
      props,
      getPanelDataElement,
    };
  },
  methods: {
    getDashboardId() {
      return this.$route.query.dashboard;
    },
    onClickChild(panelDataElementValue: any) {
      this.$emit("updated:chart", panelDataElementValue);
    },
     duplicatePanel(panelDataElementValue: any) {
      // Emits a "duplicatePanel" event with the panelDataElementValue parameter as the payload.
      this.$emit("duplicatePanel", panelDataElementValue);
    }
  },
});
</script>

<style lang="scss" scoped>
.plotlycontainer {
  height: calc(100% - 24px);
}
</style>