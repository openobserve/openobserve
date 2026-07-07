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
  <div class="rounded-md p-0" data-test="alerts-page" style="min-height: inherit">
    <RouterView
      :templates="templates"
      :destinations="destinations"
      @get:destinations="getDestinations"
      @get:templates="getTemplates"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import templateService from "@/services/alert_templates";
import destinationService from "@/services/alert_destination";

export default defineComponent({
  name: "AppAlerts",
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    const activeTab: any = ref("destinations");
    const templates = ref([]);
    const destinations = ref([]);
    const splitterModel = ref(160);

    const getTemplates = () => {
      // if (store.state.selectedOrganization.status == "active") {
      templateService
        .list({
          org_identifier: store.state.selectedOrganization.identifier,
        })
        .then((res) => (templates.value = res.data));
      // }
    };
    const getDestinations = () => {
      // if (store.state.selectedOrganization.status == "active") {
      destinationService
        .list({
          org_identifier: store.state.selectedOrganization.identifier,
          module: "alert",
        })
        .then((res) => (destinations.value = res.data));
      // }
    };

    return {
      activeTab,
      templates,
      destinations,
      splitterModel,
      getTemplates,
      getDestinations,
      t,
      store,
    };
  },
});
</script>
