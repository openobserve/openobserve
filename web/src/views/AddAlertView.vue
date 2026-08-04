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
      v-if="destinations.length > 0 || hasPrefill"
      :isUpdated="isUpdated"
      :destinations="destinations"
      @update:list="handleUpdateList"
      @cancel:hideform="handleCancel"
      @refresh:destinations="getDestinations"
    />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, onBeforeMount, onBeforeUnmount } from "vue";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import AddAlert from "@/components/alerts/AddAlert.vue";
import destinationService from "@/services/alert_destination";
import { toast } from "@/lib/feedback/Toast/useToast";
import { clearAlertPrefill } from "@/utils/alerts/alertPrefillStorage";

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

    // A prefill means the user arrived from another surface carrying work with
    // them (a logs search, a panel, a pattern set). That changes two behaviours
    // below: we must not bounce them off this page, and we own clearing the
    // stashed payload once they leave.
    const hasPrefill = computed(() => !!route.query.prefill);

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

      // The prefill has been consumed into a saved alert — retiring it here
      // stops a later visit to this page inheriting a stale query.
      clearAlertPrefill();

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
      if (destinations.value.length) return;

      // Bouncing a prefilled form would throw away work the user did on another
      // page — they arrived here with a query in hand. Warn and let them
      // continue; the destinations step offers creating one inline.
      if (hasPrefill.value) {
        toast({
          variant: "warning",
          message: "No destinations found. Create one before saving this alert.",
        });
        return;
      }

      toast({
        variant: "warning",
        message: "No destinations found. Please create a destination first.",
      });
      router.push({
        name: "alertList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    // Leaving without saving retires the prefill too — otherwise re-opening the
    // form later would silently inherit the abandoned query.
    onBeforeUnmount(() => {
      clearAlertPrefill();
    });

    return {
      destinations,
      isUpdated,
      hasPrefill,
      getDestinations,
      handleUpdateList,
      handleCancel,
    };
  },
});
</script>
