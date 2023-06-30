<template>
  <q-btn class="q-ml-sm" outline padding="xs" no-caps icon="download" @click="downloadDashboard()">
  </q-btn>
</template>
<script lang="ts">
// @ts-nocheck
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getDashboard } from "../../utils/commons.ts";
import { useStore } from "vuex";

export default defineComponent({
  name: "ExportDashboard",
  props: ["dashboardId"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore()
    const downloadDashboard = async () => {
      // get the dashboard
      const dashboard = await getDashboard(store, props.dashboardId)

      // prepare json and download via a click
      const data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dashboard));
      const htmlA = document.createElement('a');
      htmlA.setAttribute("href", data);
      const fileName = dashboard.title || "dashboard"
      htmlA.setAttribute("download", fileName + ".dashboard.json");
      htmlA.click();
    }

    return {
      downloadDashboard
    }
  }
})
</script>
