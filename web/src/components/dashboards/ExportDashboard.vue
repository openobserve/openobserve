<template>
  <q-btn class="q-ml-sm" outline padding="xs" color="primary" text-color="black" no-caps icon="download">
    <q-menu style="max-width: 200px;">
      <q-card flat>
        <q-card-section class="">
          <div class="label">Export Dashboard</div>
        </q-card-section>
        <q-separator />
        <q-card-section class="" style="max-width: 400px;">
          <div>
            Download the dashboard data to an external file so that you can import it later or share it with other people.
          </div>
          <q-btn no-caps color="primary" class="q-mt-md" @click="downloadDashboard()">Save as JSON file</q-btn>
        </q-card-section>
      </q-card>
    </q-menu>
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
