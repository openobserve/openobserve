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
      <q-bar :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'" dense class="q-px-xs" style="border-top-left-radius: 3px; border-top-right-radius: 3px;">
        <q-icon v-if="!viewOnly" name="drag_indicator" />
        <div :title="props.data.title" class="panelHeader">
          {{ props.data.title }}
        </div>
        <q-space />
        <q-btn-dropdown dense flat label="" no-caps v-if="!viewOnly">
          <q-list dense>
            <q-item clickable v-close-popup @click="onPanelModifyClick('EditPanel')">
              <q-item-section>
                <q-item-label class="q-pa-sm">Edit Panel</q-item-label>
              </q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="onPanelModifyClick('DuplicatePanel')">
              <q-item-section>
                <q-item-label class="q-pa-sm">Duplicate</q-item-label>
              </q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="onPanelModifyClick('DeletePanel')">
              <q-item-section>
                <q-item-label class="q-pa-sm">Delete Panel</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
      </q-bar>
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
import PanelSchemaRenderer from "./PanelSchemaRenderer.vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { addPanel } from "@/utils/commons";
import { useQuasar } from "quasar";

export default defineComponent({
  name: "PanelContainer",
  emits: ["onDeletePanel"],
  props: ["data", "selectedTimeDate", "viewOnly","width", "height", "variablesData","dashboardId"],
  components: {
    PanelSchemaRenderer
},
  setup(props) {    
    const store = useStore();
    const router = useRouter();
    const route = useRoute();
    const $q = useQuasar();
    //for edit panel
    const onEditPanel = (data:any) => {
      return router.push({
        path: "/dashboards/add_panel",
        query: { dashboard: String(route.query.dashboard), panelId:data.id },
      });
    }
    //create a duplicate panel
    const onDuplicatePanel = async (data: any): Promise<void> => {
  
      // Show a loading spinner notification.
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });
  
      // Generate a unique panel ID.
      const panelId = "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;
  
      // Duplicate the panel data with the new ID.
      const panelData = JSON.parse(JSON.stringify(data));
      panelData.id = panelId;
  
      try {
        // Add the duplicated panel to the dashboard.
        await addPanel(store, route.query.dashboard, panelData);
  
        // Show a success notification.
        $q.notify({
          type: "positive",
          message: `Panel Duplicated Successfully`,
        });
  
        // Navigate to the new panel.
        router.push({
          path: "/dashboards/add_panel",
          query: { dashboard: String(route.query.dashboard), panelId: panelId }
        });
        return;
      } catch (err:any) {
        // Show an error notification.
        $q.notify({
          type: "negative",
          message: err?.response?.data["error"]
            ? JSON.stringify(err?.response?.data["error"])
            : 'Panel duplication failed',
        });
      }
      // Hide the loading spinner notification.
      dismiss();
    };
    return {
      props,
      onEditPanel,
      onDuplicatePanel,
      store,
    };
  },
  methods: {
    onPanelModifyClick(evt: any) {
      if(evt == 'EditPanel'){
        this.onEditPanel(this.props.data)
      }
      else if(evt == 'DeletePanel') {
        this.$emit('onDeletePanel', this.props.data.id)
      }
      else if (evt == 'DuplicatePanel') {
        this.onDuplicatePanel(this.props.data)
      }
      else {
      }
    }
  }
});
</script>

<style lang="scss" scoped>
.plotlycontainer {
  height: calc(100% - 24px);
}
.panelHeader{
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>