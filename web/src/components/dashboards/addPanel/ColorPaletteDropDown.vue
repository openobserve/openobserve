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
      class="color-palette-row"
    >
      <!-- dropdown to select color palette type/mode -->
      <OSelect
        data-test="dashboard-color-palette-select"
        v-model="dashboardPanelData.data.config.color.mode"
        :label="t('dashboard.colorPalette')"
        class="showLabelOnTop tw:flex-1"
        @update:model-value="onColorModeChange"
        :dropdownStyle="{ width: '240px' }"
      >
        <template #trigger>
          <div class="trigger-preview">
            <span
              v-if="selectedOptionPalette.length"
              class="palette-preview"
              aria-hidden="true"
            >
              <span
                v-for="(color, i) in selectedOptionPalette.slice(0, 3)"
                :key="i"
                class="palette-preview-dot"
                :style="{ background: color }"
              />
            </span>
            <span class="trigger-label">{{ selectedOptionLabel }}</span>
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
            <div class="color-option-row">
              <span v-if="opt.colorPalette?.length" class="palette-preview" aria-hidden="true">
                <span
                  v-for="(c, i) in opt.colorPalette.slice(0, 5)"
                  :key="i"
                  class="palette-preview-dot"
                  :style="{ background: c }"
                />
              </span>
              <span class="color-option-label">{{ opt.label }}</span>
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
            <div class="color-option-row">
              <span
                v-if="opt.colorPalette?.length"
                class="gradient-preview"
                aria-hidden="true"
                :style="{ background: `linear-gradient(to right, ${opt.colorPalette.join(', ')})` }"
              />
              <span class="color-option-label">{{ opt.label }}</span>
            </div>
          </OSelectItem>
        </OSelectGroup>
      </OSelect>

      <!-- color picker for fixed and shades typed color mode -->
      <div
        v-if="['fixed', 'shades'].includes(dashboardPanelData.data.config.color.mode)"
        class="color-swatch-wrapper"
        data-test="dashboard-color-palette-color-input-wrapper"
      >
        <button
          type="button"
          class="color-swatch-btn"
          :aria-label="`Panel color: ${dashboardPanelData.data.config.color.fixedColor[0]}`"
          :style="{ background: dashboardPanelData.data.config.color.fixedColor[0] }"
          data-test="dashboard-color-palette-swatch-btn"
          @click="$refs.colorInput.click()"
        />
        <input
          ref="colorInput"
          type="color"
          class="color-input-hidden"
          v-model="dashboardPanelData.data.config.color.fixedColor[0]"
          data-test="dashboard-color-palette-color-input"
          tabindex="-1"
          aria-hidden="true"
        />
      </div>
    </div>

    <!-- color by button group -->
    <div
      class="tw:pt-3"
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
<style lang="scss" scoped>
:deep(.selectedLabel span) {
  text-transform: none !important;
}

.color-palette-row {
  display: flex;
  align-items: center;
}

.space {
  margin-top: 10px;
  margin-bottom: 10px;
}

.color-swatch-wrapper {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  margin-top: 1.875rem;
  margin-left: 0.375rem;
  position: relative;
}

.color-swatch-btn {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  border: 2px solid var(--color-border-default);
  cursor: pointer;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
  flex-shrink: 0;

  &:hover {
    border-color: var(--color-button-primary);
    box-shadow: 0 0 0 0.125rem var(--color-button-primary-focus-ring);
  }

  &:focus-visible {
    outline: 2px solid var(--color-button-primary-focus-ring);
    outline-offset: 0.125rem;
  }
}

.color-input-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.color-container {
  display: flex;
  height: 0.5rem;
}

.palette-preview {
  display: inline-flex;
  align-items: center;
  gap: 0.1875rem;
  flex-shrink: 0;
}

.palette-preview-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.trigger-preview {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  flex: 1;
}

.trigger-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  color: var(--color-text-primary);
}

.color-option-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  min-width: 0;
}

.color-option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gradient-preview {
  display: block;
  width: 2.5rem;
  height: 0.5rem;
  border-radius: 0.1875rem;
  flex-shrink: 0;
}
</style>
