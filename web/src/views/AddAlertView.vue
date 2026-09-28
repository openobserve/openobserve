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
      v-if="(destinations.length > 0 || hasPrefill || isUpdated) && !isLoadingAlert"
      :modelValue="editedAlert"
      :isUpdated="isUpdated"
      :destinations="destinations"
      @update:list="handleUpdateList"
      @cancel:hideform="handleCancel"
      @refresh:destinations="refreshDestinations"
    />
  </div>
</template>

<script lang="ts">
import { alertDetailQuery } from "@/services/alerts.queries";
import { alertKeys } from "@/services/alerts.querykeys";
import { destinationKeys } from "@/services/alert_destination.querykeys";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { queryClient } from "@/composables/query/queryClient";
import { computed, defineComponent, ref, onBeforeMount, onBeforeUnmount } from "vue";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import AddAlert from "@/components/alerts/AddAlert.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import { clearAlertPrefill } from "@/utils/alerts/alertPrefillStorage";

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

    // A prefill means the user arrived from another surface carrying work with
    // them (a logs search, a panel, a pattern set). That changes two behaviours
    // below: we must not bounce them off this page, and we own clearing the
    // stashed payload once they leave.
    const hasPrefill = computed(() => !!route.query.prefill);

    /**
     * How the user ARRIVED, captured once at setup.
     *
     * `hasPrefill` reads the live route, which stops describing this page the
     * moment the user navigates away. The destinations fetch below is awaited,
     * so on a slow call it can resolve after the user has already left — and
     * re-reading the route then said "no prefill", which sent them to the alert
     * list from whatever page they had moved on to.
     */
    const arrivedWithPrefill = hasPrefill.value;

    /**
     * False once this view is gone. An async continuation that outlives the
     * component must not route the app somewhere on its behalf.
     */
    let isViewActive = true;

    // Edit mode: the alert to seed the form with, fetched here rather than
    // handed over by the list, so editing no longer has to route through it.
    const editedAlert = ref<Record<string, any> | undefined>(undefined);
    const isLoadingAlert = ref(false);

    /**
     * Fetch the alert being edited. The form takes its edit prefill from
     * `modelValue` (the same path the list used to feed), so nothing inside
     * useAlertForm needs to know this route exists.
     */
    const loadAlertForEdit = async () => {
      const alertId = route.params.alert_id as string | undefined;
      if (!alertId) return;

      isLoadingAlert.value = true;
      try {
        editedAlert.value = await queryClient.fetchQuery(
          alertDetailQuery(store.state.selectedOrganization.identifier, alertId),
        );
        isUpdated.value = true;
      } catch (error) {
        toast({
          variant: "error",
          message: t("toastMessages.views.errorWhileLoadingAlert"),
        });
        // Nothing to edit — send them somewhere that works rather than leaving
        // an empty form that would save as a NEW alert. Unless the user has
        // already moved on, in which case this page has no say in where they are.
        if (!isViewActive) return;
        router.replace({
          name: "alertList",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
            folder: (route.query.folder as string) || "default",
          },
        });
      } finally {
        isLoadingAlert.value = false;
      }
    };

    const getDestinations = async () => {
      try {
        destinations.value = (await queryClient.fetchQuery(
          destinationsQuery(store.state.selectedOrganization.identifier, "alert"),
        )) as any;
      } catch (error) {
        toast({
          variant: "error",
          message: t("toastMessages.views.errorWhilePullingDestinations"),
        });
      }
    };

    // Explicit refresh from the alert form (a destination was just created or
    // edited) — drop the cached list so this is a real refetch.
    const refreshDestinations = async () => {
      await queryClient.invalidateQueries({
        queryKey: destinationKeys.all(store.state.selectedOrganization.identifier),
      });
      await getDestinations();
    };

    const handleUpdateList = (folderId?: string) => {
      const resolvedFolder = folderId || (route.query.folder as string) || "default";

      // The prefill has been consumed into a saved alert — retiring it here
      // stops a later visit to this page inheriting a stale query.
      clearAlertPrefill();

      // Drop the cached alerts (list and any search) so AlertList refetches on
      // mount instead of rendering the pre-save rows.
      queryClient.invalidateQueries({
        queryKey: alertKeys.all(store.state.selectedOrganization.identifier),
      });

      // AlertList still renders this folder from Vuex, so the query invalidation
      // above does not reach it — drop the folder's entry as well.
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
      // In parallel: the form needs destinations either way, and edit mode
      // needs the alert. Sequencing them would make editing feel slower than
      // the list-hosted editor it replaces.
      await Promise.all([getDestinations(), loadAlertForEdit()]);
      // The user may have navigated on while those were in flight; anything
      // below this line would be acting on a page that no longer exists.
      if (!isViewActive) return;
      if (destinations.value.length) return;

      // Bouncing a prefilled form would throw away work the user did on another
      // page — they arrived here with a query in hand. Editing is the same
      // story: the alert already exists, and refusing to open it because the
      // org has no destinations left would be absurd. Warn and let them
      // continue; the destinations step offers creating one inline.
      if (arrivedWithPrefill || isUpdated.value) {
        toast({
          variant: "warning",
          message: t("toastMessages.views.noDestinationsCreateOneBeforeSaving"),
        });
        return;
      }

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
    });

    // Leaving without saving retires the prefill too — otherwise re-opening the
    // form later would silently inherit the abandoned query.
    onBeforeUnmount(() => {
      isViewActive = false;
      clearAlertPrefill();
    });

    return {
      destinations,
      isUpdated,
      hasPrefill,
      editedAlert,
      isLoadingAlert,
      getDestinations,
      refreshDestinations,
      handleUpdateList,
      handleCancel,
    };
  },
});
</script>
