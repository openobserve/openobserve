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
  <div class="tw:rounded-md tw:p-0"
  >
    <AppPageHeader
      :back="{
        label: t('pipeline_destinations.header'),
        onClick: () => emit('cancel'),
      }"
      class="card-container tw:px-3 tw:border-b tw:border-border-default"
    >
      <template #title>
        <span data-test="pipeline-destination-editor-title">
          <template v-if="destination"
            >{{ t("alert_destinations.updateTitle") }} -
            {{ destination.name }}</template
          >
          <template v-else>{{ t("alert_destinations.addTitle") }}</template>
        </span>
      </template>
    </AppPageHeader>

    <div class="card-container tw:py-2 tw:px-3 tw:overflow-auto">
      <div class="tw:w-full">
        <CreateDestinationForm
          :destination="destination"
          @created="handleDestinationCreated"
          @updated="handleDestinationUpdated"
          @cancel="handleCancel"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { defineProps, defineEmits } from "vue";
import { useI18n } from "vue-i18n";
import CreateDestinationForm from "./NodeForm/CreateDestinationForm.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";

const { t } = useI18n();

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
</script>

<style lang="scss" scoped>
.card-container {
  border-radius: 8px;
}
</style>
