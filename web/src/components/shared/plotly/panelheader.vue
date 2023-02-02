<template>
  <div>
    <q-toolbar class="col-5 bg-indigo-1">
      <!-- <q-separator dark vertical inset /> -->
      <q-toolbar-title>
        <div class="text-subtitle1">
          {{ renderTitle }}
        </div>
      </q-toolbar-title>
      <q-separator vertical inset />
      <!-- <q-toolbar-title>{{ panelDataElementObject.title }}</q-toolbar-title>
      <q-separator dark vertical inset /> -->
      <q-btn-dropdown flat label="" no-caps >
        <q-list>
          <q-item clickable v-close-popup @click="onPanelModifyClick('EditPanel')">
            <q-item-section>
              <q-item-label class="q-pa-sm">Edit Panel</q-item-label>
            </q-item-section>
          </q-item>
          <q-item clickable v-close-popup @click="onPanelModifyClick('DeletePanel')">
            <q-item-section>
              <q-item-label class="q-pa-sm">Delete Panel</q-item-label>
            </q-item-section>
          </q-item>
          <!-- <q-item clickable v-close-popup @click="onPanelModifyClick('PrintPanel')">
            <q-item-section>
              <q-item-label class="q-pa-sm">Print Panel</q-item-label>
            </q-item-section>
          </q-item>
          <q-item clickable v-close-popup @click="onPanelModifyClick('SharePanel')">
            <q-item-section>
              <q-item-label class="q-pa-sm">Share Panel</q-item-label>
            </q-item-section>
          </q-item> -->
        </q-list>
      </q-btn-dropdown>
    </q-toolbar>
  </div>
</template>

<script lang="ts">
import { log } from "console";
import { computed, defineComponent } from "vue";
import { toRaw } from 'vue';
import { useRouter } from "vue-router";



export default defineComponent({
  name: "PanelHeader",
  props: ["panelDataElement", "dashboardId"],
  panelData: [],

  setup(props, { emit }) {
    const panelDataElementObject = toRaw(props.panelDataElement)
    const dashboardId = props.dashboardId
    const router = useRouter();

    const renderTitle = computed(() => {
      return props.panelDataElement.title
    })
    const addNewPanel = () => {
      return router.push({
        path: "/editPanel",
        query: { dashboard: String(dashboardId), panelId:panelDataElementObject.id },
      });
    }

    const deletePanel = () => {
      // return router.push({
      //   path: "/viewDashboard",
      //   query: { dashboard: String(dashboardId), panelId:panelDataElementObject.id },
      // });
    }

    return {
      panelDataElementObject,
      dashboardId,
      addNewPanel,
      deletePanel,
      renderTitle
    };
  }, methods: {

    onPanelModifyClick(evt: any) {
      if(evt == 'EditPanel'){this.addNewPanel()}
      else if(evt == 'DeletePanel') {//this.deletePanel()
        this.$emit('clicked', this.panelDataElementObject)
      }
      else {console.log(evt)}
      
    },
  },
});
</script>