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
    <AddAlert
      v-if="destinations.length > 0"
      :isUpdated="isUpdated"
      :destinations="destinations"
      @update:list="handleUpdateList"
      @cancel:hideform="handleCancel"
      @refresh:destinations="getDestinations"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { useQuasar } from "quasar";
import AddAlert from "@/components/alerts/AddAlert.vue";
import destinationService from "@/services/alert_destination";

export default defineComponent({
  name: "AddAlertView",
  components: {
    AddAlert,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const route = useRoute();
    const $q = useQuasar();
    const destinations = ref([]);
    const isUpdated = ref(false);

    const getDestinations = async () => {
      try {
        const res = await destinationService.list({
          org_identifier: store.state.selectedOrganization.identifier,
          module: "alert",
        });
        destinations.value = res.data;
      } catch (error) {
        $q.notify({
          type: "negative",
          message: "Error while pulling destinations.",
          timeout: 2000,
        });
      }
    };

    const handleUpdateList = () => {
      // Navigate back to alert list after successful save
      router.push({
        name: "alertList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          folder: route.query.folder || "default",
        },
      });
    };

    const handleCancel = () => {
      // Navigate back on cancel
      router.back();
    };

    onBeforeMount(async () => {
      await getDestinations();
    });

    return {
      destinations,
      isUpdated,
      getDestinations,
      handleUpdateList,
      handleCancel,
    };
  },
});
</script>

<style scoped>
.full-height {
  height: 100%;
}
</style>
