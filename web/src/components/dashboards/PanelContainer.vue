<!-- Copyright 2023 Zinc Labs Inc.

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
  <div
    class="panelcontainer"
    @mouseover="() => (showFullScreenBtn = true)"
    @mouseleave="() => (showFullScreenBtn = false)"
  >
    <div class="drag-allow">
      <q-bar
        :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
        dense
        class="q-px-xs"
        style="border-top-left-radius: 3px; border-top-right-radius: 3px"
      >
        <q-icon v-if="!viewOnly" name="drag_indicator" />
        <div :title="props.data.title" class="panelHeader">
          {{ props.data.title }}
        </div>
        <q-space />
        <q-icon
          v-if="dependentAdHocVariable"
          name="info_outline"
          style="cursor: pointer"
          @click="showViewPanel = true"
        >
          <q-tooltip anchor="bottom right" self="top right" max-width="220px">
            Some dynamic variables are not applied because the field is not
            present in the query's stream. Open Query Inspector to see all the
            details of the variables and queries executed to render this panel
          </q-tooltip>
        </q-icon>
        <q-btn
          v-if="!viewOnly && showFullScreenBtn"
          icon="fullscreen"
          flat
          size="md"
          padding="none"
          @click="onPanelModifyClick('ViewPanel')"
          title="Full screen"
        />
        <q-btn-dropdown dense flat label="" no-caps v-if="!viewOnly">
          <q-list dense>
            <q-item
              clickable
              v-close-popup="true"
              @click="onPanelModifyClick('EditPanel')"
            >
              <q-item-section>
                <q-item-label class="q-pa-sm">Edit Panel</q-item-label>
              </q-item-section>
            </q-item>
            <q-item
              clickable
              v-close-popup="true"
              @click="onPanelModifyClick('DuplicatePanel')"
            >
              <q-item-section>
                <q-item-label class="q-pa-sm">Duplicate</q-item-label>
              </q-item-section>
            </q-item>
            <q-item
              clickable
              v-close-popup="true"
              @click="onPanelModifyClick('DeletePanel')"
            >
              <q-item-section>
                <q-item-label class="q-pa-sm">Delete Panel</q-item-label>
              </q-item-section>
            </q-item>
            <q-item
              clickable
              v-if="metaData && metaData.queries.length > 0"
              v-close-popup="true"
              @click="showViewPanel = true"
            >
              <q-item-section>
                <q-item-label class="q-pa-sm">Query Inspector</q-item-label>
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
      @metadata-update="metaDataValue"
      @updated:data-zoom="$emit('updated:data-zoom', $event)"
    ></PanelSchemaRenderer>
    <q-dialog v-model="showViewPanel">
      <MetaDataDialog :metaData="metaData" :data="props.data"></MetaDataDialog>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import PanelSchemaRenderer from "./PanelSchemaRenderer.vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { addPanel } from "@/utils/commons";
import { useQuasar } from "quasar";
import MetaDataDialog from "@/components/dashboards/MetaDataDialog.vue";
import { ref } from "vue";

export default defineComponent({
  name: "PanelContainer",
  emits: ["onDeletePanel", "onViewPanel", "updated:data-zoom"],
  props: [
    "data",
    "selectedTimeDate",
    "viewOnly",
    "width",
    "height",
    "variablesData",
    "dashboardId",
    "metaData",
  ],
  components: {
    PanelSchemaRenderer,
    MetaDataDialog
  },
  setup(props) {
    const store = useStore();
    const router = useRouter();
    const route = useRoute();
    const $q = useQuasar();
    const metaData = ref();
    const showViewPanel = ref(false);
    const metaDataValue = (metadata: any) => {
      metaData.value = metadata;
    };

    const dependentAdHocVariable = computed(() => {

      if(!metaData.value) return false

      const adhocVariables = props.variablesData.values
        ?.filter((it: any) => it.type === "dynamic_filters")
        ?.map((it: any) => it?.value).flat()
        ?.filter((it: any) => it?.operator && it?.name && it?.value)

      const metaDataDynamic = metaData.value?.queries?.every((it: any) => {
        const vars = it.variables?.filter(
          (it: any) => it.type === "dynamicVariable"
        );
        return vars.length == adhocVariables.length;
      });
      return !metaDataDynamic;
    });

    // for full screen button
    const showFullScreenBtn: any = ref(false);

    //for edit panel
    const onEditPanel = (data:  any) => {
      return router.push({
        path: "/dashboards/add_panel",
        query: {
          dashboard: String(route.query.dashboard),
          panelId: data.id,
          folder: route.query.folder ?? "default",
        },
      });
    };
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
        await addPanel(store, route.query.dashboard, panelData, route.query.folder ?? "default");

        // Show a success notification.
        $q.notify({
          type: "positive",
          message: `Panel Duplicated Successfully`,
        });


        // Navigate to the new panel.
        router.push({
          path: "/dashboards/add_panel",
          query: {
            dashboard: String(route.query.dashboard),
            panelId: panelId,
            folder: route.query.folder ?? "default",
          },
        });
        return;
      } catch (err: any) {
      } catch (err: any) {
        // Show an error notification.
        $q.notify({
          type: "negative",
          message: err?.response?.data["error"]
            ? JSON.stringify(err?.response?.data["error"])
            : "Panel duplication failed",
        });
      }
      // Hide the loading spinner notification.
      dismiss();
    };
    return {
      props,
      onEditPanel,
      onDuplicatePanel,
      showFullScreenBtn,
      store,
      metaDataValue,
      metaData,
      showViewPanel,
      dependentAdHocVariable,
    };
  },
  methods: {
    onPanelModifyClick(evt: any) {
      if  (evt == "ViewPanel") {
        this.$emit("onViewPanel", this.props.data.id);
      } else if (evt == "EditPanel")  {
        this.onEditPanel(this.props.data);
      } else if  (evt == "DeletePanel") {
        this.$emit("onDeletePanel", this.props.data.id);
      } else if (evt == "DuplicatePanel") {
        this.onDuplicatePanel(this.props.data);
      } else {
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.panelcontainer {
  height: calc(100% - 24px);
}

.panelHeader {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
