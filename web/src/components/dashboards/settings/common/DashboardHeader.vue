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
  <div data-test="dashboard-header-root">
    <div
      data-test="dashboard-header-row"
      class="tw:flex tw:items-center tw:flex-nowrap tw:mb-2"
    >
      <div
        v-if="backButton"
        data-test="dashboard-header-back-button-container"
        class="col-auto"
      >
        <OButton
          data-test="dashboard-header-back-button"
          variant="outline"
          size="icon-xs"
          class="tw:mr-2"
          @click="onBackClicked"
          icon-left="arrow-back-ios-new"
        >
        </OButton>
      </div>
      <div
        data-test="dashboard-header-title-container"
        class="tw:flex tw:flex-col tw:flex-1"
      >
        <div
          data-test="dashboard-header-title"
          class="tw:text-base tw:font-semibold"
        >
          {{ title }}
        </div>
      </div>
      <div data-test="dashboard-header-right-slot-container" class="col-auto">
        <slot name="right"></slot>
      </div>
    </div>
    <OSeparator data-test="dashboard-header-separator" class="tw:mb-2" />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

export default defineComponent({
  name: "DashboardHeader",
  components: { OSeparator, OButton },
  props: {
    title: {
      type: String,
      default: "",
    },
    backButton: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["back"],
  setup(props, { emit }) {
    const onBackClicked = () => {
      emit("back");
    };

    return {
      onBackClicked,
    };
  },
});
</script>

<style scoped lang="scss"></style>
