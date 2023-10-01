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
  <q-btn class="q-ml-sm" outline padding="xs" no-caps icon="download" @click="downloadDashboard()">
  </q-btn>
</template>
<script lang="ts">
// @ts-nocheck
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getDashboard } from "../../utils/commons.ts";
import { useStore } from "vuex";
import { useRoute } from "vue-router";

export default defineComponent({
  name: "ExportDashboard",
  props: ["dashboardId"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore()
    const route = useRoute();
    const downloadDashboard = async () => {
      // get the dashboard
      const dashboard = await getDashboard(store, props.dashboardId, route.query.folder)
      dashboard.owner = ''

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
