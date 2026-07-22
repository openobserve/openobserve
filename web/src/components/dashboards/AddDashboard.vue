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
  <div class="add-dashboard-form-card-section">
    <OForm
      id="add-dashboard-form"
      ref="addDashboardForm"
      :schema="addDashboardSchema"
      :default-values="addDashboardDefaults()"
      @submit="onSubmit"
    >
      <OFormInput
        name="name"
        :label="t('dashboard.name')"
        required
        data-test="add-dashboard-name"
      />
      <span>&nbsp;</span>
      <OFormInput
        name="description"
        :label="t('dashboard.typeDesc')"
        data-test="add-dashboard-description"
      />

      <span>&nbsp;</span>
      <!-- select folder or create new folder and select -->
      <select-folder-dropdown
        v-if="showFolderSelection"
        :active-folder-id="selectedFolder.value"
        @folder-selected="selectedFolder = $event"
      />
      <span>&nbsp;</span>
    </OForm>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import dashboardService from "../../services/dashboards";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getImageURL } from "../../utils/zincutils";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import SelectFolderDropdown from "./SelectFolderDropdown.vue";
import { getAllDashboards } from "@/utils/commons";
import useNotifications from "@/composables/useNotifications";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeAddDashboardSchema,
  addDashboardDefaults,
  type AddDashboardForm,
} from "./AddDashboard.schema";

export default defineComponent({
  name: "ComponentAddDashboard",
  props: {
    activeFolderId: {
      validator: (value: any) => {
        return typeof value === "string" || value === null;
      },
      default: "default",
    },
    showFolderSelection: {
      type: Boolean,
      default: true,
    },
  },
  emits: ["updated", "close"],
  setup(props, { emit }) {
    const store: any = useStore();
    const addDashboardForm: any = ref(null);
    const disableColor: any = ref("");
    const isValidIdentifier: any = ref(true);
    const { t } = useI18n();
    const addDashboardSchema = makeAddDashboardSchema(t);
    const { showPositiveNotification, showErrorNotification } = useNotifications();

    const activeFolder: any = store.state.organizationData.folders.find(
      (item: any) => item.folderId === props.activeFolderId,
    );
    const selectedFolder = ref({
      label: activeFolder?.name,
      value: activeFolder?.folderId,
    });

    //generate random integer number for dashboard Id
    function getRandInteger() {
      return Math.floor(Math.random() * (9999999999 - 100 + 1)) + 100;
    }

    // Plain async @submit handler — the validated `value` is the source of
    // truth (the schema already gated it). This is a DIALOG form, so we do NOT
    // reset on save: the overlay unmounts the body on close and remounts fresh
    // (seeded by `:default-values`) → a clean form for free.
    const onSubmit = async (value: AddDashboardForm) => {
      const baseObj = {
        title: value.name,
        // NOTE: the dashboard ID is generated at the server side,
        // in "Create a dashboard" request handler. The server
        // doesn't care what value we put here as long as it's
        // a string.
        dashboardId: "",
        description: value.description ?? "",
        variables: {
          list: [],
          showDynamicFilters: true,
        },
        defaultDatetimeDuration: {
          startTime: null,
          endTime: null,
          relativeTimePeriod: "15m",
          type: "relative",
        },
        role: "",
        owner: store.state.userInfo.name,
        created: new Date().toISOString(),
        tabs: [
          {
            panels: [],
            name: "Default",
            tabId: "default",
          },
        ],
        version: 3,
      };

      try {
        const res = await dashboardService.create(
          store.state.selectedOrganization.identifier,
          baseObj,
          selectedFolder.value.value ?? "default",
        );

        const data = convertDashboardSchemaVersion(res?.data["v" + res?.data?.version]);

        //update store
        await getAllDashboards(store, selectedFolder.value.value);
        emit("updated", data.dashboardId, selectedFolder.value.value);

        showPositiveNotification(t("dashboard.addDashboardPage.addedSuccessfully"));
      } catch (err: any) {
        showErrorNotification(err?.message ?? t("dashboard.addDashboardPage.creationFailed"));
      }
    };

    return {
      t,
      addDashboardSchema,
      disableColor,
      isPwd: ref(true),
      status,
      addDashboardDefaults,
      addDashboardForm,
      store,
      getRandInteger,
      isValidIdentifier,
      getImageURL,
      selectedFolder,
      onSubmit,
      // Submit through the form so the Zod schema gates it (validate() does not
      // run a form-level schema). Used by external callers / tests.
      submit: () => addDashboardForm.value?.submit(),
    };
  },
  methods: {
    onRejected(rejectedEntries: string | any[]) {
      toast({
        variant: "error",
        message: this.t("dashboard.addDashboardPage.filesFailedValidation", {
          count: rejectedEntries.length,
        }),
      });
    },
  },
  components: { SelectFolderDropdown, OForm, OFormInput },
});
</script>
