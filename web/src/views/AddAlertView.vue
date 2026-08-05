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
      @refresh:destinations="refreshDestinations"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import AddAlert from "@/components/alerts/AddAlert.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  fetchDestinations,
  invalidateDestinations,
} from "@/composables/query/queries/alertMeta";
import { alertsListQuery } from "@/composables/query/queries/alerts";
import { useI18nTyped } from "@/types/i18n";

export default defineComponent({
  name: "AddAlertView",
  components: {
    AddAlert,
  },
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();
    const router = useRouter();
    const route = useRoute();
    const destinations = ref([]);
    const isUpdated = ref(false);

    // Explicit refresh from the alert form (a destination was just created or
    // edited) — drop the cached list so this is a real refetch.
    const refreshDestinations = async () => {
      await invalidateDestinations(store.state.selectedOrganization.identifier);
      await getDestinations();
    };

    const getDestinations = async () => {
      try {
        destinations.value = (await fetchDestinations(
          store.state.selectedOrganization.identifier,
          "alert",
        )) as any;
      } catch (error) {
        toast({
          variant: "error",
          message: t("toastMessages.views.errorWhilePullingDestinations"),
        });
      }
    };

    const handleUpdateList = (folderId?: string) => {
      const resolvedFolder = folderId || (route.query.folder as string) || "default";

      // Drop the cached alerts (list and any search) so AlertList refetches on
      // mount instead of rendering the pre-save rows.
      alertsListQuery.invalidateList(store.state.selectedOrganization.identifier);

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
          message: t("toastMessages.views.noDestinationsFoundPleaseCreateA"),
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
      refreshDestinations,
      handleUpdateList,
      handleCancel,
    };
  },
});
</script>
