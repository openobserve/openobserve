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
  <ODialog
    data-test="dashboard-tab-settings-add-tab-dialog"
    :open="open"
    size="sm"
    :title="editMode ? t('dashboard.editTab') : t('dashboard.newTab')"
    :secondary-button-label="t('dashboard.cancel')"
    :primary-button-label="t('dashboard.save')"
    form-id="add-tab-form"
    @update:open="$emit('update:open', $event)"
    @click:secondary="$emit('update:open', false)"
  >
    <div>
      <OForm
        id="add-tab-form"
        ref="addTabForm"
        :schema="addTabSchema"
        :default-values="addTabDefaults"
        @submit="onSubmit"
      >
        <OFormInput
          name="name"
          :label="t('dashboard.name')"
          required
          data-test="dashboard-add-tab-name"
        />
      </OForm>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { addTab, getDashboard } from "@/utils/commons";
import { useRoute } from "vue-router";
import { editTab } from "../../../utils/commons";
import useNotifications from "@/composables/useNotifications";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { makeAddTabSchema, type AddTabForm } from "./AddTab.schema";

export default defineComponent({
  name: "AddTab",
  components: { ODialog, OForm, OFormInput },
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
    const addTabSchema = makeAddTabSchema(t);
    const {
      showPositiveNotification,
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();

    // The tab record being edited. This is EXTERNAL data fetched from the
    // store/API (it carries the non-form fields tabId/panels) — NOT a mirror of
    // the form's `name` field. The OForm owns `name`; this only seeds it.
    const editingTab: any = ref(null);

    // OForm reads `defaultValues` once at mount, and ODialog remounts the body on
    // open — so this computed seeds `name` each time the dialog opens (edit → the
    // tab's name, create → blank). No local model / no manual reset needed.
    const addTabDefaults = computed(
      (): AddTabForm => ({
        name: props.editMode ? (editingTab.value?.name ?? "") : "",
      }),
    );

    // Edit data arrives ASYNC (getDashboard may hit the API) after the dialog has
    // mounted, so `:default-values` has already been read. Per the playbook
    // "Data arrives AFTER mount" rule, re-baseline the form via form.reset(values)
    // once the record loads — watching the EXTERNAL source, not a local mirror.
    const loadDashboardData = async () => {
      if (props.editMode) {
        const dashboardData: any = await getDashboard(
          store,
          props.dashboardId,
          props.folderId ?? route.query.folder ?? "default",
        );
        editingTab.value = JSON.parse(
          JSON.stringify(dashboardData?.tabs?.find((tab: any) => tab.tabId === props.tabId)),
        );
        addTabForm.value?.form.reset({ name: editingTab.value?.name ?? "" });
      }
    };
    watch(
      () => props.open,
      (v) => {
        if (v) loadDashboardData();
        else editingTab.value = null;
      },
    );

    const onSubmit = async (value: AddTabForm) => {
      // The @submit payload is the source of truth for `name`; the loaded
      // `editingTab` carries the rest (panels/tabId) in edit mode.
      try {
        //if edit mode
        if (props.editMode) {
          // only allowed to edit name
          const updatedTab = await editTab(
            store,
            props.dashboardId,
            props.folderId ?? route.query.folder ?? "default",
            editingTab.value?.tabId,
            { ...editingTab.value, name: value.name },
          );

          // emit refresh to rerender
          emit("refresh", updatedTab);
          emit("update:open", false);

          showPositiveNotification(t("dashboard.addTab.tabUpdatedSuccessfully"));
        }
        //else new tab
        else {
          const newTab = await addTab(
            store,
            props.dashboardId,
            props.folderId ?? route.query.folder ?? "default",
            { name: value.name, panels: [] },
          );

          // emit refresh to rerender
          emit("refresh", newTab);
          emit("update:open", false);

          showPositiveNotification(t("dashboard.addTab.tabAddedSuccessfully"));
        }
      } catch (error: any) {
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              (props.editMode
                ? t("dashboard.addTab.failedToUpdateTab")
                : t("dashboard.addTab.failedToAddTab")),
          );
        } else {
          showErrorNotification(
            error?.message ??
              (props.editMode
                ? t("dashboard.addTab.failedToUpdateTab")
                : t("dashboard.addTab.failedToAddTab")),
            {
              timeout: 2000,
            },
          );
        }
      }
    };

    return {
      t,
      addTabSchema,
      addTabDefaults,
      editingTab,
      addTabForm,
      store,
      onSubmit,
    };
  },
});
</script>
