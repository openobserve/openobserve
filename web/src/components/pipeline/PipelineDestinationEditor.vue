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
  <q-page class="q-pa-none tw:flex tw:flex-col" style="min-height: 0; height: 100%; overflow: hidden;">

    <!-- Header -->
    <div class="tw:flex tw:items-center tw:px-3 tw:h-[68px] tw:border-b-[1px] tw:gap-3 tw:flex-shrink-0">
      <div
        data-test="pipeline-destination-editor-back-btn"
        class="el-border tw:w-6 tw:h-6 flex items-center justify-center cursor-pointer el-border-radius"
        @click="handleCancel"
      >
        <q-icon name="arrow_back_ios_new" size="14px" />
      </div>
      <div class="tw:flex tw:flex-col tw:justify-center">
        <div class="q-table__title tw:font-[600] tw:leading-tight" data-test="pipeline-destination-editor-title">
          {{
            destination
              ? t("alert_destinations.updateTitle") + " - " + destination.name
              : t("alert_destinations.addTitle")
          }}
        </div>
      </div>
    </div>

    <!-- Form Body -->
    <div class="tw:px-3 tw:py-3 tw:overflow-hidden" style="flex: 1; min-height: 0; height: calc(100vh - 170px);">
      <CreateDestinationForm
        ref="destinationFormRef"
        :destination="destination"
        :hide-footer="true"
        @created="handleDestinationCreated"
        @updated="handleDestinationUpdated"
        @cancel="handleCancel"
      />
    </div>

    <!-- Footer -->
    <div class="page-footer">
      <OButton
        data-test="add-destination-cancel-btn"
        variant="outline"
        size="sm-action"
        @click="handleCancel"
      >
        {{ t('alerts.cancel') }}
      </OButton>
      <OButton
        data-test="add-destination-submit-btn"
        variant="primary"
        size="sm-action"
        @click="handleSave"
      >
        {{ t('alerts.save') }}
      </OButton>
    </div>
  </q-page>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import CreateDestinationForm from "./NodeForm/CreateDestinationForm.vue";

const { t } = useI18n();

const destinationFormRef = ref<InstanceType<typeof CreateDestinationForm> | null>(null);

// Props
const props = defineProps<{
  destination?: any;
}>();

// Emits
const emit = defineEmits(["cancel", "created", "updated"]);

// Handle destination creation
const handleDestinationCreated = (destinationName: string) => {
  emit("created", destinationName);
};

// Handle destination update
const handleDestinationUpdated = (destinationName: string) => {
  emit("updated", destinationName);
};

// Handle cancel
const handleCancel = () => {
  emit("cancel");
};

// Handle save — trigger form submit
const handleSave = () => {
  destinationFormRef.value?.submitForm();
};
</script>

<style lang="scss" scoped>
.page-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 24px;
  height: 50px;
  flex-shrink: 0;
  border-top: 1px solid var(--o2-border-color);
}
</style>
