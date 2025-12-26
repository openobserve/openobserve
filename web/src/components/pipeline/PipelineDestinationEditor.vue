<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page
    class="q-pa-none o2-custom-bg"
  >
    <div
      class="row items-center no-wrap card-container q-px-md tw:mb-[0.675rem]"
    >
      <div class="flex items-center tw:h-[60px]">
        <div
          no-caps
          padding="xs"
          outline
          icon="arrow_back_ios_new"
          class="el-border tw:w-6 tw:h-6 flex items-center justify-center cursor-pointer el-border-radius q-mr-sm"
          title="Go Back"
          @click="$emit('cancel')"
        >
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
        <div class="col" data-test="pipeline-destination-editor-title">
          <div v-if="destination" class="text-h6">
            {{ t("alert_destinations.updateTitle") }} - {{ destination.name }}
          </div>
          <div v-else class="text-h6">
            {{ t("alert_destinations.addTitle") }}
          </div>
        </div>
      </div>
    </div>

    <div class="card-container tw:py-2 q-px-md tw:h-[calc(100vh-120px)] tw:overflow-auto">
      <div class="tw:w-[50vw]">
        <CreateDestinationForm
          :destination="destination"
          @created="handleDestinationCreated"
          @updated="handleDestinationUpdated"
          @cancel="handleCancel"
        />
      </div>
    </div>
  </q-page>
</template>

<script lang="ts" setup>
import { defineProps, defineEmits } from "vue";
import { useI18n } from "vue-i18n";
import CreateDestinationForm from "./NodeForm/CreateDestinationForm.vue";

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
