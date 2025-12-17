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
  <!-- Right Column: Preview & Summary (30%) -->
  <div class="tw-flex-[0_0_30%] tw-flex tw-flex-col tw-gap-2" style="height: calc(100vh - 302px); position: sticky; top: 0; overflow: hidden;">
    <!-- Preview Alert -->
    <preview-alert
      style="flex: 1; height: 50%; overflow: auto;"
      ref="previewAlertRef"
      :formData="formData"
      :query="previewQuery"
      :selectedTab="selectedTab"
      :isAggregationEnabled="isAggregationEnabled"
    />

    <!-- Alert Summary -->
    <alert-summary
      style="flex: 1; height: 50%; overflow: auto;"
      :formData="formData"
      :destinations="destinations"
      :focusManager="focusManager"
      :wizardStep="wizardStep"
      :previewQuery="previewQuery"
      :generatedSqlQuery="generatedSqlQuery"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type PropType } from "vue";
import PreviewAlert from "./PreviewAlert.vue";
import AlertSummary from "./AlertSummary.vue";

export default defineComponent({
  name: "AlertWizardRightColumn",
  components: {
    PreviewAlert,
    AlertSummary,
  },
  props: {
    formData: {
      type: Object as PropType<any>,
      required: true,
    },
    previewQuery: {
      type: String,
      default: "",
    },
    generatedSqlQuery: {
      type: String,
      default: "",
    },
    selectedTab: {
      type: String,
      default: "custom",
    },
    isAggregationEnabled: {
      type: Boolean,
      default: false,
    },
    destinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    focusManager: {
      type: Object as PropType<any>,
      default: undefined,
    },
    wizardStep: {
      type: Number,
      required: false,
      default: 1,
    },
  },
  setup(props, { expose }) {
    const previewAlertRef = ref(null);

    // Expose refreshData method from PreviewAlert
    const refreshData = () => {
      if (previewAlertRef.value) {
        (previewAlertRef.value as any).refreshData();
      }
    };

    // Expose the method to parent component
    expose({
      refreshData,
    });

    return {
      previewAlertRef,
    };
  },
});
</script>
