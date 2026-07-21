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
  <div class="h-full max-h-full overflow-hidden">
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
import AddAlert from "@/components/alerts/AddAlert.vue";
import destinationService from "@/services/alert_destination";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "AddAlertView",
  components: {
    AddAlert,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const route = useRoute();
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
        toast({
          variant: "error",
          message: "Error while pulling destinations.",
        });
      }
    };

    const handleUpdateList = (folderId?: string) => {
      const resolvedFolder = folderId || (route.query.folder as string) || "default";

      // Invalidate cached alerts for this folder so the AlertList
      // component fetches fresh data when it mounts.
      const cached = store.state.organizationData.allAlertsListByFolderId;
      if (cached && cached[resolvedFolder]) {
        const { [resolvedFolder]: _, ...rest } = cached;
        store.dispatch("setAllAlertsListByFolderId", rest);
      }

      // Navigate back to alert list after successful save
      router.push({
        name: "alertList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          folder: resolvedFolder,
          tab: route.query.tab || "all",
        },
      });
    };

    const handleCancel = () => {
      // Navigate back on cancel
      router.back();
    };

    onBeforeMount(async () => {
      await getDestinations();
      if (!destinations.value.length) {
        toast({
          variant: "warning",
          message:
            "No destinations found. Please create a destination first.",
        });
        router.push({
          name: "alertList",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
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

