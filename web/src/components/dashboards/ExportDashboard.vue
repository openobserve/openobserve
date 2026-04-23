<!-- Copyright 2026 OpenObserve Inc.

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
  <OButton
  variant="outline"
  size="sm"
  @click="downloadDashboard()"
  data-test="export-dashboard"
  class="dashboard-icons q-px-sm q-ml-sm">
  <template #icon-left><Download class="tw:w-4 tw:h-4" /></template>
  <q-tooltip>{{ t("dashboard.export") }}</q-tooltip>
</OButton>
</template>
<script lang="ts">
// @ts-nocheck
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getDashboard } from "../../utils/commons.ts";
import { useStore } from "vuex";
import { useRoute } from "vue-router";

import OButton from "@/lib/core/Button/Button.vue";

import { Download } from "lucide-vue-next";
export default defineComponent({
  components: {
    OButton,
    Download,
  },
  name: "ExportDashboard",
  props: ["dashboardId"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const route = useRoute();
    const downloadDashboard = async () => {
      // get the dashboard
      const dashboard = await getDashboard(
        store,
        props.dashboardId,
        route.query.folder
      );
      dashboard.owner = "";

      // prepare json and download via a click
      const data =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(dashboard, null, 2));
      const htmlA = document.createElement("a");
      htmlA.setAttribute("href", data);
      const fileName = dashboard.title || "dashboard";
      htmlA.setAttribute("download", fileName + ".dashboard.json");
      htmlA.click();
    };

    return {
      downloadDashboard,
      t,
    };
  },
});
</script>

<style lang="scss" scoped>
.dashboard-icons {
  height: 30px;
}
</style>
