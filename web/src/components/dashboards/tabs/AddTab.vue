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
  <ODrawer data-test="add-tab-dialog"
    :open="open"
    size="md"
    :title="editMode ? 'Edit Tab' : 'Add Tab'"
    secondary-button-label="Cancel"
    primary-button-label="Save"
    :primary-button-loading="onSubmit.isLoading.value"
    @update:open="$emit('update:open', $event)"
    @click:secondary="$emit('update:open', false)"
    @click:primary="submit()"
  >
    <div class="tw:p-4">
      <OForm ref="addTabForm" :default-values="{ name: '' }" @submit="onSubmit.execute">
        <OFormInput
          name="name"
          label="Name*"
          :validators="[(val: string | number | undefined) => !(val?.toString().trim()) ? t('dashboard.nameRequired') : undefined]"
          data-test="dashboard-add-tab-name"
        />
      </OForm>
    </div>
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useLoading } from "@/composables/useLoading";
import { addTab, getDashboard } from "@/utils/commons";
import { useRoute } from "vue-router";
import { editTab } from "../../../utils/commons";
import useNotifications from "@/composables/useNotifications";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";

const defaultValue = () => {
  return {
    name: "",
    panels: [],
  };
};

export default defineComponent({
  name: "AddTab",
  components: { ODrawer, OForm, OFormInput },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    tabId: {
      validator: (value) => {
        return typeof value === "string" || value === null;
      },
      default: null,
    },
    editMode: {
      type: Boolean,
      default: false,
    },
    dashboardId: {
      validator: (value) => {
        return typeof value === "string" || value === null;
      },
      required: true,
    },
    folderId: {
      required: false,
      validator: (value) => {
        return typeof value === "string" || value === null;
      },
    },
  },
  emits: ["refresh", "update:open"],
  setup(props: any, { emit }) {
    const { t } = useI18n();
    const route = useRoute();
    const store: any = useStore();
    const addTabForm: any = ref(null);
    let dashboardData: any = ref({});
    const isValidIdentifier: any = ref(true);
    const {
      showPositiveNotification,
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();
    const tabData: any = ref(defaultValue());

    const loadDashboardData = async () => {
      if (props.editMode) {
        dashboardData.value = await getDashboard(
          store,
          props.dashboardId,
          props.folderId ?? route.query.folder ?? "default",
        );
        tabData.value = JSON.parse(
          JSON.stringify(
            dashboardData?.value?.tabs?.find(
              (tab: any) => tab.tabId === props.tabId,
            ),
          ),
        );
      }
    };
    watch(
      () => props.open,
      (v) => {
        if (v) loadDashboardData();
        else tabData.value = defaultValue();
      },
    );

    watch(
      () => tabData.value.name,
      (name) => {
        addTabForm.value?.form.setFieldValue("name", name ?? "");
      },
    );

    const onSubmit = useLoading(async () => {
      const valid = await addTabForm.value.validate();
      if (!valid) return;
      // Sync form values back to local state
      tabData.value.name = (addTabForm.value.form.state.values.name as string) ?? tabData.value.name;
      try {
          //if edit mode
          if (props.editMode) {
            // only allowed to edit name
            const updatedTab = await editTab(
              store,
              props.dashboardId,
              props.folderId ?? route.query.folder ?? "default",
              tabData.value.tabId,
              tabData.value,
            );

            // emit refresh to rerender
            emit("refresh", updatedTab);
            emit("update:open", false);

            showPositiveNotification("Tab updated successfully", {
              timeout: 2000,
            });
          }
          //else new tab
          else {
            const newTab = await addTab(
              store,
              props.dashboardId,
              props.folderId ?? route.query.folder ?? "default",
              tabData.value,
            );

            // emit refresh to rerender
            emit("refresh", newTab);
            emit("update:open", false);

            showPositiveNotification("Tab added successfully", {
              timeout: 2000,
            });
          }
          tabData.value = {
            name: "",
            panels: [],
          };
          await addTabForm.value?.resetValidation();
      } catch (error: any) {
          if (error?.response?.status === 409) {
            showConfictErrorNotificationWithRefreshBtn(
              error?.response?.data?.message ??
                error?.message ??
                (props.editMode ? "Failed to update tab" : "Failed to add tab"),
            );
          } else {
            showErrorNotification(
              error?.message ??
                (props.editMode ? "Failed to update tab" : "Failed to add tab"),
              {
                timeout: 2000,
              },
            );
          }
        } finally {
        }
    });

    const submit = () => onSubmit.execute();

    return {
      t,
      tabData,
      addTabForm,
      store,
      isValidIdentifier,
      onSubmit,
      submit,
    };
  },
});
</script>
