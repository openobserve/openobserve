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
      v-if="!isLoadingAlert"
      :modelValue="editedAlert"
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
import alertsService from "@/services/alerts";
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
    // them (a logs search, a panel, a pattern set) — this page owns clearing the
    // stashed payload once they leave.
    const hasPrefill = computed(() => !!route.query.prefill);

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
        const res = await alertsService.get_by_alert_id(
          store.state.selectedOrganization.identifier,
          alertId,
        );
        editedAlert.value = res.data;
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
        const res = await destinationService.list({
          org_identifier: store.state.selectedOrganization.identifier,
          module: "alert",
        });
        destinations.value = res.data;
      } catch (error) {
        toast({
          variant: "error",
          message: t("toastMessages.views.errorWhilePullingDestinations"),
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
      // In parallel: the form needs destinations either way, and edit mode
      // needs the alert. Sequencing them would make editing feel slower than
      // the list-hosted editor it replaces.
      await Promise.all([getDestinations(), loadAlertForEdit()]);
      // The user may have navigated on while those were in flight; anything
      // below this line would be acting on a page that no longer exists.
      if (!isViewActive) return;
      if (destinations.value.length) return;

      // A heads-up, not a reason to bounce the user off a form that can still save.
      toast({
        variant: "warning",
        message: t("alerts.alertSettings.noDestinationNote"),
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
      handleUpdateList,
      handleCancel,
    };
  },
});
</script>
