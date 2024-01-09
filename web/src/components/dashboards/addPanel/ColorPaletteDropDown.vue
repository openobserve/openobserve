<!-- Copyright 2023 Zinc Labs Inc.

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
  <div style="display: flex; align-items: center">
    <q-select
      v-model="dashboardPanelData.data.config.color.mode"
      :options="colorOptions"
      outlined
      dense
      label="Color palette"
      class="showLabelOnTop"
      stack-label
      emit-value
      :display-value="`${
        dashboardPanelData.data.config.color.mode ?? 'palette-classic'
      }`"
      style="width: 100%"
    >
    </q-select>
    <div
      class="color-input-wrapper"
      v-if="
        ['fixed', 'shades'].includes(dashboardPanelData.data.config.color.mode)
      "
      style="margin-top: 30px; margin-left: 5px"
    >
      <input
        type="color"
        v-model="dashboardPanelData.data.config.color.fixedColor"
      />
    </div>
  </div>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { onBeforeMount } from "vue";
import { computed, defineComponent } from "vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  setup() {
    const { dashboardPanelData, promqlMode } = useDashboardPanelData();

    // on before mount need to check whether color object is there or not else use palette-classic as a default
    onBeforeMount(() => {
      if (!dashboardPanelData?.data?.config?.color) {
        dashboardPanelData.data.config.color = {
          mode: "palette-classic",
        };
      }
    });

    const colorOptions = [
      {
        label: "fixed",
        value: "fixed",
      },
      {
        label: "shades",
        value: "shades",
      },
      {
        label: "palette-classic",
        value: "palette-classic",
      },
      {
        label: "continuous",
        value: "continuous",
      },
    ];

    return {
      dashboardPanelData,
      promqlMode,
      colorOptions,
    };
  },
});
</script>

<style lang="scss" scoped>
:deep(.selectedLabel span) {
  text-transform: none !important;
}

.space {
  margin-top: 10px;
  margin-bottom: 10px;
}
.color-input-wrapper {
  height: 25px;
  width: 25px;
  overflow: hidden;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  position: relative;
}
.color-input-wrapper input[type="color"] {
  position: absolute;
  height: 4em;
  width: 4em;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  overflow: hidden;
  border: none;
  margin: 0;
  padding: 0;
}
</style>
