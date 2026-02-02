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
  <div>
    <div style="display: flex; align-items: center">
      <!-- dropdown to select color palette type/mode -->
      <q-select
        v-model="dashboardPanelData.data.config.color.mode"
        :options="colorOptions"
        dense
        :label="t('dashboard.colorPalette')"
        class="showLabelOnTop"
        stack-label
        :display-value="selectedOptionLabel"
        @update:model-value="onColorModeChange"
        style="width: 100%"
        :popup-content-style="{ height: '300px', width: '200px' }"
       borderless hide-bottom-space>
        <template v-slot:option="props">
          <!-- label -->
          <!-- sublabel -->
          <!-- color palette as gradient -->
          <q-item v-if="!props.opt.isGroup" v-bind="props.itemProps">
            <q-item-section style="padding: 2px">
              <q-item-label>{{ props.opt.label }}</q-item-label>
              <q-item-label caption>
                <div v-if="props.opt.subLabel">
                  <div style="font-weight: 200">
                    {{ props.opt.subLabel }}
                  </div>
                </div>
                <div
                  v-if="Array.isArray(props.opt.colorPalette)"
                  class="color-container"
                >
                  <div
                    :style="{
                      background: `linear-gradient(to right, ${props.opt.colorPalette.join(
                        ', ',
                      )})`,
                      width: '100%',
                      height: '8px',
                      borderRadius: '3px',
                    }"
                  ></div>
                </div>
              </q-item-label>
            </q-item-section>
          </q-item>
          <!-- Render non-selectable group headers -->
          <q-item v-else>
            <q-item-section>
              <q-item-label v-html="props.opt.label" />
            </q-item-section>
          </q-item>
        </template>
      </q-select>

      <!-- color picker for fixed and shades typed color mode -->
      <div
        class="color-input-wrapper"
        v-if="
          ['fixed', 'shades'].includes(
            dashboardPanelData.data.config.color.mode,
          )
        "
        style="margin-top: 30px; margin-left: 5px"
      >
        <input
          type="color"
          v-model="dashboardPanelData.data.config.color.fixedColor[0]"
        />
      </div>
    </div>

    <!-- color by button group -->
    <div
      class="q-pt-md"
      v-if="dashboardPanelData.data.config.color.mode.startsWith('continuous')"
    >
      {{ t("dashboard.colorSeriesBy") }}
      <div>
        <q-btn-toggle
          v-model="dashboardPanelData.data.config.color.seriesBy"
          push
          toggle-color="primary"
          size="md"
          :options="[
            { label: 'Last', value: 'last' },
            { label: 'Min', value: 'min' },
            { label: 'Max', value: 'max' },
          ]"
        />
      </div>
    </div>
  </div>
</template>
<script lang="ts">
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { getColorPalette } from "@/utils/dashboard/colorPalette";
import { computed, inject, onBeforeMount, defineComponent } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "ColorPaletteDropdown",
  setup() {
    const { t } = useI18n();

    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData, promqlMode } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );
    onBeforeMount(() => {
      // on before mount need to check whether color object is there or not else use palette-classic-by-series as a default
      if (!dashboardPanelData?.data?.config?.color) {
        dashboardPanelData.data.config.color = {
          mode: "palette-classic-by-series",
          fixedColor: [],
          seriesBy: "last",
        };
      }
    });

    const store = useStore();

    const colorOptions = [
      {
        label: t("dashboard.colorBySeries"),
        isGroup: true,
      },
      {
        label: t("dashboard.colorDefaultPaletteBySeries"),
        subLabel: t("dashboard.colorDefaultPaletteBySeriesSubLabel"),
        colorPalette: getColorPalette(store.state.theme),
        value: "palette-classic-by-series",
      },
      {
        label: t("dashboard.colorPaletteClassic"),
        subLabel: t("dashboard.colorPaletteClassicSubLabel"),
        colorPalette: [
          "#5470c6",
          "#91cc75",
          "#fac858",
          "#ee6666",
          "#73c0de",
          "#3ba272",
          "#fc8452",
          "#9a60b4",
          "#ea7ccc",
          "#59c4e6",
          "#edafda",
          "#93b7e3",
          "#a5e7f0",
        ],
        value: "palette-classic",
      },
      {
        label: t("dashboard.colorSingleColor"),
        subLabel: t("dashboard.colorSingleColorSubLabel"),
        value: "fixed",
      },
      {
        label: t("dashboard.colorShadesOfSpecificColor"),
        subLabel: t("dashboard.colorShadesOfSpecificColorSubLabel"),
        value: "shades",
      },
      {
        label: t("dashboard.colorByValue"),
        isGroup: true,
      },
      {
        label: t("dashboard.colorGreenYellowRed"),
        colorPalette: ["green", "yellow", "red"],
        value: "continuous-green-yellow-red",
      },
      {
        label: t("dashboard.colorRedYellowGreen"),
        colorPalette: ["red", "yellow", "green"],
        value: "continuous-red-yellow-green",
      },
      {
        label: t("dashboard.colorTemperature"),
        colorPalette: ["#F6EADB", "#FBDBA2", "#FFC86D", "#FC8585"],
        value: "continuous-temperature",
      },
      {
        label: t("dashboard.colorPositive"),
        colorPalette: ["#A7D1A7", "#7AB97A", "#4EA24E", "#228B22"],
        value: "continuous-positive",
      },
      {
        label: t("dashboard.colorNegative"),
        colorPalette: ["#FFD4D4", "#FFADAD", "#F77272", "#F03030", "#B12E21"],
        value: "continuous-negative",
      },
      {
        label: t("dashboard.colorLightToDarkBlue"),
        colorPalette: ["#B8CCE0", "#96AFCD", "#7392BA", "#5175A7", "#2E5894"],
        value: "continuous-light-to-dark-blue",
      },
    ];

    const selectedOptionLabel = computed(() => {
      const selectedOption = colorOptions.find(
        (option) =>
          option.value ===
          (dashboardPanelData?.data?.config?.color?.mode ??
            "palette-classic-by-series"),
      );
      return selectedOption
        ? selectedOption.label
        : t("dashboard.colorPaletteClassicBySeries");
    });

    const onColorModeChange = (value: any) => {
      // if value.value is fixed or shades, assign ["#53ca53"] to fixedcolor as a default
      if (["fixed", "shades"].includes(value.value)) {
        dashboardPanelData.data.config.color.fixedColor = ["#53ca53"];
        dashboardPanelData.data.config.color.seriesBy = "last";
      } else if (
        ["palette-classic-by-series", "palette-classic"].includes(value.value)
      ) {
        // do not store fixedcolor in config for palette-classic-by-series and palette-classic
        dashboardPanelData.data.config.color.fixedColor = [];
      } else {
        // else assign sublabel to fixedcolor
        dashboardPanelData.data.config.color.fixedColor = value.colorPalette;
      }
      dashboardPanelData.data.config.color.mode = value.value;
    };
    return {
      t,
      dashboardPanelData,
      promqlMode,
      colorOptions,
      onColorModeChange,
      selectedOptionLabel,
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
.color-container {
  display: flex;
  height: 8px;
}
</style>
