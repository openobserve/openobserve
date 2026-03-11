<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="full-height">
    <AddAnomalyDetection
      :destinations="destinations"
      @refresh:destinations="getDestinations"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import AddAnomalyDetection from "@/components/anomaly_detection/AddAnomalyDetection.vue";
import destinationService from "@/services/alert_destination";

export default defineComponent({
  name: "AddAnomalyDetectionView",

  components: {
    AddAnomalyDetection,
  },

  setup() {
    const store = useStore();
    const $q = useQuasar();
    const destinations = ref<any[]>([]);

    const getDestinations = async () => {
      try {
        const res = await destinationService.list({
          org_identifier: store.state.selectedOrganization.identifier,
          module: "alert",
        });
        destinations.value = res.data;
      } catch {
        $q.notify({
          type: "negative",
          message: "Error while loading destinations.",
          timeout: 2000,
        });
      }
    };

    onBeforeMount(getDestinations);

    return {
      destinations,
      getDestinations,
    };
  },
});
</script>

<style scoped>
.full-height {
  height: 100%;
}
</style>
