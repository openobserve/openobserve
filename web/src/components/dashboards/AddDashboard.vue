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
  <div class="q-px-md q-py-sm add-dashboard-form-card-section">
      <OForm ref="addDashboardForm" :default-values="{ name: '', description: '' }" @submit="onSubmit.execute">
        <OInput
          v-if="beingUpdated"
          v-model="dashboardData.id"
          :readonly="beingUpdated"
          :disabled="beingUpdated"
          :label="t('dashboard.id')"
          data-test="dashboard-id"
        />
        <OFormInput
          name="name"
          :label="t('dashboard.name') + ' *'"
          data-test="add-dashboard-name"
          :validators="[(val: string | number | undefined) => !(val?.toString().trim()) ? t('dashboard.nameRequired') : undefined]"
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
import { toRaw } from "vue";
import { getImageURL } from "../../utils/zincutils";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import SelectFolderDropdown from "./SelectFolderDropdown.vue";
import { getAllDashboards } from "@/utils/commons";
import { useQuasar } from "quasar";
import OButton from "@/lib/core/Button/OButton.vue";
import { useLoading } from "@/composables/useLoading";
import useNotifications from "@/composables/useNotifications";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

const defaultValue = () => {
  return {
    id: "",
    name: "",
    description: "",
  };
};

let callDashboard: Promise<{ data: any }>;

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
  emits: ["updated"],
  setup(props, { emit }) {
    const store: any = useStore();
    const beingUpdated: any = ref(false);
    const addDashboardForm: any = ref(null);
    const disableColor: any = ref("");
    const dashboardData: any = ref(defaultValue());
    const isValidIdentifier: any = ref(true);
    const { t } = useI18n();
    const $q = useQuasar();
    const { showPositiveNotification, showErrorNotification } =
      useNotifications();

    const activeFolder: any = store.state.organizationData.folders.find(
      (item: any) => item.folderId === props.activeFolderId,
    );
    const selectedFolder = ref({
      label: activeFolder.name,
      value: activeFolder.folderId,
    });

    //generate random integer number for dashboard Id
    function getRandInteger() {
      return Math.floor(Math.random() * (9999999999 - 100 + 1)) + 100;
    }

    const onSubmit = useLoading(async () => {
      const valid = await addDashboardForm.value.validate();
      if (!valid) return;

      // Sync OForm-owned values back to local state
      const formVals = addDashboardForm.value.form.state.values as { name: string; description: string };
      dashboardData.value.name = formVals.name ?? dashboardData.value.name;
      dashboardData.value.description = formVals.description ?? dashboardData.value.description;

      {
        const dashboardId = dashboardData.value.id;
        delete dashboardData.value.id;

        if (dashboardId == "") {
          const obj = toRaw(dashboardData.value);
          const baseObj = {
            title: obj.name,
            // NOTE: the dashboard ID is generated at the server side,
            // in "Create a dashboard" request handler. The server
            // doesn't care what value we put here as long as it's
            // a string.
            dashboardId: "",
            description: obj.description,
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

          callDashboard = dashboardService.create(
            store.state.selectedOrganization.identifier,
            baseObj,
            selectedFolder.value.value ?? "default",
          );
        }
        try {
          const res = await callDashboard;

          const data = convertDashboardSchemaVersion(
            res?.data["v" + res?.data?.version],
          );

          //update store
          await getAllDashboards(store, selectedFolder.value.value);
          emit("updated", data.dashboardId, selectedFolder.value.value);
          dashboardData.value = {
            id: "",
            name: "",
            description: "",
          };
          await addDashboardForm.value?.resetValidation();

          showPositiveNotification("Dashboard added successfully.");
        } catch (err: any) {
          showErrorNotification(err?.message ?? "Dashboard creation failed.");
        }
      }
    });

    return {
      t,
      disableColor,
      isPwd: ref(true),
      beingUpdated,
      status,
      dashboardData,
      addDashboardForm,
      store,
      getRandInteger,
      isValidIdentifier,
      getImageURL,
      selectedFolder,
      onSubmit,
    };
  },
  methods: {
    onRejected(rejectedEntries: string | any[]) {
      this.$q.notify({
        type: "negative",
        message: `${rejectedEntries.length} file(s) did not pass validation constraints`,
      });
    },
  },
  components: { SelectFolderDropdown, OForm, OFormInput, OInput },
});
</script>
<style lang="scss">
.add-dashboard-form-card-section {
  .add-folder-btn {
    margin-top: 36px !important;
  }
}
</style>
