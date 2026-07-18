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
  <div data-test="dashboard-color-palette-root">
    <div
      data-test="dashboard-color-palette-flex-container"
      class="flex items-center"
    >
      <!-- dropdown to select color palette type/mode -->
      <OSelect
        data-test="dashboard-color-palette-select"
        v-model="dashboardPanelData.data.config.color.mode"
        :label="t('dashboard.colorPalette')"
        class="showLabelOnTop flex-1"
        @update:model-value="onColorModeChange"
        :dropdownStyle="{ width: '240px' }"
      >
        <template #trigger>
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            <span
              v-if="selectedOptionPalette.length"
              class="inline-flex items-center gap-[0.1875rem] flex-shrink-0"
              aria-hidden="true"
            >
              <span
                v-for="(color, i) in selectedOptionPalette.slice(0, 3)"
                :key="i"
                class="w-2 h-2 rounded-full flex-shrink-0"
                :style="{ background: color }"
              />
            </span>
            <span
              class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-text-body"
            >{{ selectedOptionLabel }}</span
            >
          </div>
        </template>

        <!-- By Series group -->
        <OSelectGroup :label="t('dashboard.colorBySeries')">
          <OSelectItem
            v-for="opt in colorOptionsByGroup.bySeries"
            :key="opt.value"
            :value="opt.value"
            :label="opt.label"
          >
            <div class="flex items-center gap-1.5 w-full min-w-0">
              <span
                v-if="opt.colorPalette?.length"
                class="inline-flex items-center gap-[0.1875rem] flex-shrink-0"
                aria-hidden="true"
              >
                <span
                  v-for="(c, i) in opt.colorPalette.slice(0, 5)"
                  :key="i"
                  class="w-2 h-2 rounded-full flex-shrink-0"
                  :style="{ background: c }"
                />
              </span>
              <span
                class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
              >{{ opt.label }}</span
              >
            </div>
          </OSelectItem>

          <OSelectItem value="fixed" :label="t('dashboard.colorSingleColor')" />
          <OSelectItem value="shades" :label="t('dashboard.colorShadesOfSpecificColor')" />
        </OSelectGroup>

        <!-- By Value group -->
        <OSelectGroup :label="t('dashboard.colorByValue')">
          <OSelectItem
            v-for="opt in colorOptionsByGroup.byValue"
            :key="opt.value"
            :value="opt.value"
            :label="opt.label"
          >
            <div class="flex items-center gap-1.5 w-full min-w-0">
              <span
                v-if="opt.colorPalette?.length"
                class="block w-10 h-2 rounded-default flex-shrink-0"
                aria-hidden="true"
                :style="{ background: `linear-gradient(to right, ${opt.colorPalette.join(', ')})` }"
              />
              <span
                class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
              >{{ opt.label }}</span
              >
            </div>
          </OSelectItem>
        </OSelectGroup>
      </OSelect>

      <!-- color picker for fixed and shades typed color mode -->
      <div
        v-if="['fixed', 'shades'].includes(dashboardPanelData.data.config.color.mode)"
        class="inline-flex items-center flex-shrink-0 mt-7.5 ml-1.5 relative"
        data-test="dashboard-color-palette-color-input-wrapper"
      >
        <button
          type="button"
          class="w-8 h-8 rounded-full cursor-pointer flex-shrink-0 transition-[box-shadow,border-color] duration-200 ease border-2 border-solid border-border-default hover:border-button-primary hover:ring-2 hover:ring-button-primary-focus-ring focus-visible:outline-2 focus-visible:outline-button-primary-focus-ring focus-visible:outline-offset-2"
          :aria-label="`Panel color: ${dashboardPanelData.data.config.color.fixedColor[0]}`"
          :style="{ background: dashboardPanelData.data.config.color.fixedColor[0] }"
          data-test="dashboard-color-palette-swatch-btn"
          @click="$refs.colorInput.click()"
        />
        <input
          ref="colorInput"
          type="color"
          class="absolute w-0 h-0 opacity-0 pointer-events-none"
          v-model="dashboardPanelData.data.config.color.fixedColor[0]"
          data-test="dashboard-color-palette-color-input"
          tabindex="-1"
          aria-hidden="true"
        />
      </div>
    </div>

    <!-- color by button group -->
    <div
      class="pt-3"
      v-if="dashboardPanelData.data.config.color.mode.startsWith('continuous')"
    >
      {{ t("dashboard.colorSeriesBy") }}
      <div>
        <OToggleGroup v-model="dashboardPanelData.data.config.color.seriesBy">
          <OToggleGroupItem value="last">Last</OToggleGroupItem>
          <OToggleGroupItem value="min">Min</OToggleGroupItem>
          <OToggleGroupItem value="max">Max</OToggleGroupItem>
        </OToggleGroup>
      </div>
    </div>
  </div>
</template>
<script lang="ts">
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { getColorPalette } from "@/utils/dashboard/colorPalette";
import { computed, inject, onBeforeMount, defineComponent } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import OSelectGroup from "@/lib/forms/Select/OSelectGroup.vue";

export default defineComponent({
  name: "ColorPaletteDropdown",
  components: { OToggleGroup, OToggleGroupItem, OSelect, OSelectItem, OSelectGroup },
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
        header: true,
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
          "#5b8ef0",
          "#34d399",
          "#fb923c",
          "#f472b6",
          "#a78bfa",
          "#fbbf24",
          "#38bdf8",
          "#f87171",
          "#2dd4bf",
          "#4ade80",
          "#e879f9",
          "#facc15",
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
        header: true,
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

    const colorOptionsByGroup = computed(() => ({
      bySeries: colorOptions.filter(
        (o) => !o.header && !o.value?.startsWith("continuous") && o.value !== "fixed" && o.value !== "shades",
      ),
      byValue: colorOptions.filter((o) => o.value?.startsWith("continuous")),
    }));

    const selectedOptionPalette = computed<string[]>(() => {
      const mode = dashboardPanelData?.data?.config?.color?.mode ?? "palette-classic-by-series";
      if (["fixed", "shades"].includes(mode)) {
        const fixed = dashboardPanelData?.data?.config?.color?.fixedColor?.[0];
        return fixed ? [fixed] : [];
      }
      const option = colorOptions.find((o) => o.value === mode);
      return (option as any)?.colorPalette ?? [];
    });

    const onColorModeChange = (value: string) => {
      const selectedOption = colorOptions.find((opt: any) => opt.value === value);
      // if value is fixed or shades, assign ["#53ca53"] to fixedcolor as a default
      if (["fixed", "shades"].includes(value)) {
        dashboardPanelData.data.config.color.fixedColor = ["#53ca53"];
        dashboardPanelData.data.config.color.seriesBy = "last";
      } else if (
        ["palette-classic-by-series", "palette-classic"].includes(value)
      ) {
        // do not store fixedcolor in config for palette-classic-by-series and palette-classic
        dashboardPanelData.data.config.color.fixedColor = [];
      } else {
        // else assign sublabel to fixedcolor
        dashboardPanelData.data.config.color.fixedColor = selectedOption?.colorPalette ?? [];
      }
      dashboardPanelData.data.config.color.mode = value;
    };
    return {
      t,
      dashboardPanelData,
      promqlMode,
      colorOptions,
      colorOptionsByGroup,
      onColorModeChange,
      selectedOptionLabel,
      selectedOptionPalette,
    };
  },
});
</script>
