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
  <div v-if="props.errors.errors.length" :data-test="`dashboard-error`">
    <OSeparator />
    <div>
      <div
        data-test="dashboard-errors-expand-bar"
        class="bg-section-header-bg hover:bg-surface-subtle-hover flex cursor-pointer items-center gap-2 overflow-hidden px-2 py-2"
        @click="onDropDownClick"
      >
        <OIcon :name="!showErrors ? 'arrow-right' : 'arrow-drop-down'" size="sm" class="mr-1" />
        <span class="text-status-error-text text-sm font-semibold">
          Errors ({{ props.errors.errors.length }})
        </span>
      </div>
    </div>
    <div class="flex overflow-hidden" :style="!showErrors ? 'height: 0px;' : 'height: auto;'">
      <div class="flex flex-col">
        <div data-test="dashboard-error">
          <ul data-test="dashboard-errors-list" class="list-inside list-disc px-3">
            <li
              v-for="(item, index) in props.errors.errors"
              :key="index"
              class="text-status-error-text py-1"
              data-test="dashboard-errors-list-item"
            >
              {{ item }}
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
export default defineComponent({
  name: "DashboardErrorsComponent",
  components: {
    OSeparator,
    OIcon,
  },
  props: ["errors"],

  setup(props) {
    const showErrors = ref(false);
    const { t } = useI18n();

    const onDropDownClick = () => {
      showErrors.value = !showErrors.value;
    };

    watch([showErrors, props.errors], () => {
      resizeChartEvent();
    });

    watch(props.errors, () => {
      if (props.errors.errors.length > 0) {
        showErrors.value = true;
      }
    });

    const resizeChartEvent = () => {
      window.dispatchEvent(new Event("resize"));
    };

    return {
      props,
      t,
      onDropDownClick,
      showErrors,
    };
  },
});
</script>
