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
  <div>
    <q-bar :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'" dense class="q-px-xs" style="border-top-left-radius: 3px; border-top-right-radius: 3px;">
    <q-icon v-if="draggable" name="drag_indicator" />
      <div :title="renderTitle" class="plotlycontainer">
        {{ renderTitle }}
    </div>
      <q-space />
      <q-btn-dropdown dense flat label="" no-caps >
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
</template>

<script lang="ts">
import { computed, defineComponent } from "vue";
import { toRaw } from 'vue';
import { useRouter, useRoute } from "vue-router";
import { useStore } from "vuex";
import { useQuasar} from "quasar";

export default defineComponent({
  name: "PanelHeader",
  props: ["panelDataElement", "dashboardId", "draggable"],
  panelData: [],

  setup(props, { emit }) {
    const $q = useQuasar();
    const store = useStore();
    const panelDataElementObject = toRaw(props.panelDataElement)
    const dashboardId = props.dashboardId
    const router = useRouter();
    const route = useRoute()

    const renderTitle = computed(() => {
      return props.panelDataElement.title
    })
    //for edit panel
    const addNewPanel = () => {
      return router.push({
        path: "/dashboards/add_panel",
        query: { dashboard: String(route.query.dashboard), panelId:panelDataElementObject.id },
      });
    }

    // for delete panel
    const deletePanel = () => {
        return router.push({
        path: "/dashboards/view",
        query: { org_identifier: store.state.selectedOrganization.identifier, dashboard: String(dashboardId), panelId:panelDataElementObject.id },
      });
    }

    return {
      panelDataElementObject,
      dashboardId,
      addNewPanel,
      deletePanel,
      renderTitle,
      store
    };
  }, methods: {

    onPanelModifyClick(evt: any) {
      if(evt == 'EditPanel'){this.addNewPanel()}
      else if(evt == 'DeletePanel') {
        this.$emit('clicked', this.panelDataElementObject)
      }
      else if (evt == 'DuplicatePanel') {
        this.$emit('duplicatePanel', this.panelDataElementObject)
      }
      else {
      }
      
    },
  },
});
</script>

<style lang="scss" scoped>
.plotlycontainer{
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>