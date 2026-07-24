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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <ODialog
    data-test="tabs-delete-popup-dialog"
    v-model:open="open"
    size="md"
    :title="
      t('dashboard.tabsDeletePopUp.deleteTitle', {
        name: dashboardData?.tabs?.find((tab: any) => tab.tabId === tabId)?.name,
      })
    "
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    @click:secondary="onCancel"
    @click:primary="onConfirm"
  >
    <div data-test="dialog-box">
      <p class="para" data-test="dashboard-tab-delete-tab-para">
        {{ t("dashboard.tabsDeletePopUp.confirmMessage") }}
      </p>

      <!-- only show if there are panels in the tab -->
      <div
        v-if="dashboardData?.tabs?.find((tab: any) => tab.tabId === tabId)?.panels?.length"
        class="mt-4"
        data-test="dashboard-tab-delete-tab-panels-container"
      >
        <div class="flex flex-col" data-test="dashboard-tab-delete-radio-group">
          <ORadioGroup v-model="action" orientation="vertical" class="gap-4">
            <div class="flex flex-row">
              <ORadio
                val="move"
                :disabled="moveTabOptions.length === 0"
                data-test="dashboard-tab-delete-tab-panels-move"
                :label="t('dashboard.tabsDeletePopUp.movePanels')"
              />
              <div v-if="action === 'move'" class="mb-2.5 ml-5 max-w-75 min-w-50">
                <OSelect
                  v-model="selectedTabToMovePanels"
                  :options="moveTabOptions"
                  data-test="dashboard-tab-delete-tab-panels-move-select"
                />
              </div>
            </div>
            <ORadio
              val="delete"
              data-test="dashboard-tab-delete-tab-panels-delete"
              :label="t('dashboard.tabsDeletePopUp.deleteAllPanels')"
            />
          </ORadioGroup>
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { onMounted } from "vue";
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

export default defineComponent({
  name: "TabsDeletePopUp",
  components: { ODialog, ORadio, ORadioGroup, OSelect },
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  props: {
    tabId: { type: String },
    dashboardData: { type: Object },
    modelValue: { type: Boolean, default: false },
  },
  setup(props, { emit }) {
    const { t } = useI18n();
    const action = ref("move");
    const selectedTabToMovePanels = ref<string | undefined>(undefined);
    const moveTabOptions = ref([]);

    const open = computed({
      get: () => props.modelValue ?? false,
      set: (v: boolean) => emit("update:modelValue", v),
    });

    onMounted(() => {
      // update move tab options
      const newMoveTabOptions: any = [];
      props?.dashboardData?.tabs?.forEach((tab: any) => {
        // if tab is to be deleted, do not include it in the options
        if (tab.tabId != props.tabId) {
          newMoveTabOptions.push({
            label: tab.name,
            value: tab.tabId,
          });
        }
      });

      // if there are no other tabs to move panels to, force delete action
      action.value = newMoveTabOptions.length > 0 ? "move" : "delete";
      // set selectedTabToMovePanels to [0]th value (may be undefined if no options)
      selectedTabToMovePanels.value = newMoveTabOptions[0]?.value;

      moveTabOptions.value = newMoveTabOptions;
    });

    const onCancel = () => {
      open.value = false;
      emit("update:cancel");
    };

    const onConfirm = () => {
      // if action is delete, then emit without passing the selectedTabToMovePanels as args
      // else pass the selectedTabToMovePanels
      // if action is delete, then emit without passing the selectedTabToMovePanels as args
      // else pass the selectedTabToMovePanels
      if (action.value === "delete") {
        open.value = false;
        emit("update:ok");
        return;
      }
      open.value = false;
      emit("update:ok", selectedTabToMovePanels.value);
    };
    return {
      t,
      open,
      onCancel,
      onConfirm,
      action,
      selectedTabToMovePanels,
      moveTabOptions,
    };
  },
});
</script>
