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
  <q-dialog v-model="dialogOpen" position="right" maximized>
    <q-card style="width: 400px; max-width: 90vw;">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">Predefined Themes</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-tabs
          v-model="activeTab"
          dense
          class="text-grey"
          active-color="primary"
          indicator-color="primary"
          align="justify"
        >
          <q-tab name="light" label="Light Mode" />
          <q-tab name="dark" label="Dark Mode" />
        </q-tabs>
      </q-card-section>

      <q-card-section class="q-pt-none scroll-content">
        <q-tab-panels v-model="activeTab" animated>
          <!-- Light Mode Themes -->
          <q-tab-panel name="light" class="q-pa-none">
            <div v-for="theme in predefinedThemes" :key="theme.id" class="theme-card q-mb-md">
              <div class="row items-center q-mb-sm">
                <div class="text-subtitle1">{{ theme.name }}</div>
                <q-space />
                <q-badge v-if="isThemeApplied(theme, 'light')" color="positive" label="Applied" />
              </div>

              <div class="row q-mb-md">
                <div class="col">
                  <div class="text-caption text-grey-7">Theme Color</div>
                  <div class="color-preview" :style="{ backgroundColor: hexToRgba(theme.light.themeColor, getOpacity(theme.id, 'light', 'themeColor', theme.light.themeColorOpacity)) }"></div>
                  <div class="text-caption q-mb-xs">{{ theme.light.themeColor }}</div>
                  <q-select
                    :model-value="getOpacity(theme.id, 'light', 'themeColor', theme.light.themeColorOpacity)"
                    @update:model-value="(val) => setOpacity(theme.id, 'light', 'themeColor', val)"
                    :options="opacityOptions"
                    dense
                    emit-value
                    map-options
                    label="Opacity"
                    class="o2-custom-select-dashboard"
                  />
                </div>
                <div class="col q-px-sm">
                  <div class="text-caption text-grey-7">Primary BG</div>
                  <div class="color-preview" :style="{ backgroundColor: hexToRgba(theme.light.primaryBg, getOpacity(theme.id, 'light', 'primaryBg', theme.light.primaryBgOpacity)) }"></div>
                  <div class="text-caption q-mb-xs">{{ theme.light.primaryBg }}</div>
                  <q-select
                    :model-value="getOpacity(theme.id, 'light', 'primaryBg', theme.light.primaryBgOpacity)"
                    @update:model-value="(val) => setOpacity(theme.id, 'light', 'primaryBg', val)"
                    :options="opacityOptions"
                    dense
                    emit-value
                    map-options
                    label="Opacity"
                     class="o2-custom-select-dashboard"
                  />
                </div>
                <div class="col">
                  <div class="text-caption text-grey-7">Secondary BG</div>
                  <div class="color-preview" :style="{ backgroundColor: hexToRgba(theme.light.secondaryBg, getOpacity(theme.id, 'light', 'secondaryBg', theme.light.secondaryBgOpacity)) }"></div>
                  <div class="text-caption q-mb-xs">{{ theme.light.secondaryBg }}</div>
                  <q-select
                    :model-value="getOpacity(theme.id, 'light', 'secondaryBg', theme.light.secondaryBgOpacity)"
                    @update:model-value="(val) => setOpacity(theme.id, 'light', 'secondaryBg', val)"
                    :options="opacityOptions"
                    dense
                    emit-value
                    map-options
                    label="Opacity"
                     class="o2-custom-select-dashboard"
                  />
                </div>
              </div>

              <q-btn
                label="Apply Theme"
                color="primary"
                class="full-width"
                @click="applyTheme(theme, 'light')"
              />
            </div>
          </q-tab-panel>

          <!-- Dark Mode Themes -->
          <q-tab-panel name="dark" class="q-pa-none">
            <div v-for="theme in predefinedThemes" :key="theme.id" class="theme-card q-mb-md">
              <div class="row items-center q-mb-sm">
                <div class="text-subtitle1">{{ theme.name }}</div>
                <q-space />
                <q-badge v-if="isThemeApplied(theme, 'dark')" color="positive" label="Applied" />
              </div>

              <div class="row q-mb-md">
                <div class="col">
                  <div class="text-caption text-grey-7">Theme Color</div>
                  <div class="color-preview" :style="{ backgroundColor: hexToRgba(theme.dark.themeColor, getOpacity(theme.id, 'dark', 'themeColor', theme.dark.themeColorOpacity)) }"></div>
                  <div class="text-caption q-mb-xs">{{ theme.dark.themeColor }}</div>
                  <q-select
                    :model-value="getOpacity(theme.id, 'dark', 'themeColor', theme.dark.themeColorOpacity)"
                    @update:model-value="(val) => setOpacity(theme.id, 'dark', 'themeColor', val)"
                    :options="opacityOptions"
                    dense
                    emit-value
                    map-options
                    label="Opacity"
                     class="o2-custom-select-dashboard"
                  />
                </div>
                <div class="col q-px-sm">
                  <div class="text-caption text-grey-7">Primary BG</div>
                  <div class="color-preview" :style="{ backgroundColor: hexToRgba(theme.dark.primaryBg, getOpacity(theme.id, 'dark', 'primaryBg', theme.dark.primaryBgOpacity)) }"></div>
                  <div class="text-caption q-mb-xs">{{ theme.dark.primaryBg }}</div>
                  <q-select
                    :model-value="getOpacity(theme.id, 'dark', 'primaryBg', theme.dark.primaryBgOpacity)"
                    @update:model-value="(val) => setOpacity(theme.id, 'dark', 'primaryBg', val)"
                    :options="opacityOptions"
                    dense
                    emit-value
                    map-options
                    label="Opacity"
                     class="o2-custom-select-dashboard"
                  />
                </div>
                <div class="col">
                  <div class="text-caption text-grey-7">Secondary BG</div>
                  <div class="color-preview" :style="{ backgroundColor: hexToRgba(theme.dark.secondaryBg, getOpacity(theme.id, 'dark', 'secondaryBg', theme.dark.secondaryBgOpacity)) }"></div>
                  <div class="text-caption q-mb-xs">{{ theme.dark.secondaryBg }}</div>
                  <q-select
                    :model-value="getOpacity(theme.id, 'dark', 'secondaryBg', theme.dark.secondaryBgOpacity)"
                    @update:model-value="(val) => setOpacity(theme.id, 'dark', 'secondaryBg', val)"
                    :options="opacityOptions"
                    emit-value
                    dense
                    map-options
                    label="Opacity"
                    class="o2-custom-select-dashboard"
                  />
                </div>
              </div>

              <q-btn
                label="Apply Theme"
                color="primary"
                class="full-width"
                @click="applyTheme(theme, 'dark')"
              />
            </div>
          </q-tab-panel>
        </q-tab-panels>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { usePredefinedThemes } from "@/composables/usePredefinedThemes";
import { useThemeCustomizer } from "@/composables/useThemeCustomizer";
import { useQuasar } from "quasar";
import { useStore } from "vuex";

const $q = useQuasar();
const store = useStore();
const { isOpen } = usePredefinedThemes();
const { applyTheme: applyThemeToCustomizer } = useThemeCustomizer();
const dialogOpen = ref(false);
const activeTab = ref("light");

// Track applied themes for each mode
const appliedLightTheme = ref<number | null>(null);
const appliedDarkTheme = ref<number | null>(null);

// Track user-selected opacity values for each theme and mode
const selectedOpacities = ref<Record<string, any>>({});

// Opacity options for dropdowns (0-10 scale)
const opacityOptions = [
  { label: '0 (Transparent)', value: 0 },
  { label: '0.1', value: 1 },
  { label: '0.2', value: 2 },
  { label: '0.3', value: 3 },
  { label: '0.4', value: 4 },
  { label: '0.5', value: 5 },
  { label: '0.6', value: 6 },
  { label: '0.7', value: 7 },
  { label: '0.8', value: 8 },
  { label: '0.9', value: 9 },
  { label: '1.0 (Opaque)', value: 10 },
];

// Get opacity for a specific theme, mode, and color type
const getOpacity = (themeId: number, mode: string, colorType: string, defaultValue: number) => {
  const key = `${themeId}-${mode}-${colorType}`;
  if (selectedOpacities.value[key] === undefined) {
    selectedOpacities.value[key] = defaultValue;
  }
  return selectedOpacities.value[key];
};

// Set opacity for a specific theme, mode, and color type
const setOpacity = (themeId: number, mode: string, colorType: string, value: number) => {
  const key = `${themeId}-${mode}-${colorType}`;
  selectedOpacities.value[key] = value;
};

// Watch isOpen from composable
watch(isOpen, (val) => {
  dialogOpen.value = val;
  // When dialog opens, sync activeTab with current store theme
  if (val) {
    activeTab.value = store.state.theme === "dark" ? "dark" : "light";
  }
});

// Watch dialogOpen to sync back
watch(dialogOpen, (val) => {
  isOpen.value = val;
});

// Watch activeTab changes and update store.state.theme accordingly
watch(activeTab, (newTab) => {
  const newTheme = newTab === "dark" ? "dark" : "light";
  if (store.state.theme !== newTheme) {
    // Update theme in store and localStorage
    store.dispatch("appTheme", newTheme);
    localStorage.setItem("theme", newTheme);
    $q.dark.set(newTheme === "dark");
  }
});

// Watch store.state.theme changes and update activeTab accordingly
watch(
  () => store.state.theme,
  (newTheme) => {
    const newTab = newTheme === "dark" ? "dark" : "light";
    if (activeTab.value !== newTab) {
      activeTab.value = newTab;
    }
  }
);

// Helper function to convert hex to rgba
const hexToRgba = (hex: string, opacity: number): string => {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const alpha = opacity / 10; // Convert 1-10 scale to 0.1-1.0
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Predefined themes with both light and dark mode colors
// Each theme has:
// - id: unique identifier
// - name: display name for the theme
// - light: colors and opacities for light mode
// - dark: colors and opacities for dark mode
//
// For each mode:
// - themeColor: hex color for buttons/toggles/borders
// - themeColorOpacity: opacity value (0-10 scale, 10 = fully opaque)
// - primaryBg: hex color for primary background gradient
// - primaryBgOpacity: opacity value (0-10 scale)
// - secondaryBg: hex color for secondary background gradient
// - secondaryBgOpacity: opacity value (0-10 scale)
const predefinedThemes = [
  {
    id: 1,
    name: "Pastel Dream",
    light: {
      themeColor: "#A2D2FF",
      themeColorOpacity: 10,
      primaryBg: "#FFAFCC",
      primaryBgOpacity: 1,
      secondaryBg: "#FFC8DD",
      secondaryBgOpacity: 4,
    },
    dark: {
      themeColor: "#5E9DB8",
      themeColorOpacity: 10,
      primaryBg: "#2D1B2E",
      primaryBgOpacity: 2,
      secondaryBg: "#1A2332",
      secondaryBgOpacity: 5,
    },
  },
  {
    id: 2,
    name: "Ocean Breeze",
    light: {
      themeColor: "#4A90E2",
      themeColorOpacity: 10,
      primaryBg: "#7CB9E8",
      primaryBgOpacity: 1,
      secondaryBg: "#B0E0E6",
      secondaryBgOpacity: 3,
    },
    dark: {
      themeColor: "#4A9FD8",
      themeColorOpacity: 10,
      primaryBg: "#1B3A52",
      primaryBgOpacity: 3,
      secondaryBg: "#0F2537",
      secondaryBgOpacity: 6,
    },
  },
  {
    id: 3,
    name: "Forest Green",
    light: {
      themeColor: "#2D7A3E",
      themeColorOpacity: 10,
      primaryBg: "#A8D5BA",
      primaryBgOpacity: 2,
      secondaryBg: "#C8E6C9",
      secondaryBgOpacity: 4,
    },
    dark: {
      themeColor: "#4CAF50",
      themeColorOpacity: 10,
      primaryBg: "#1B4D2A",
      primaryBgOpacity: 2,
      secondaryBg: "#0D3318",
      secondaryBgOpacity: 5,
    },
  },
  {
    id: 4,
    name: "Sunset Glow",
    light: {
      themeColor: "#FF6B6B",
      themeColorOpacity: 10,
      primaryBg: "#FFB347",
      primaryBgOpacity: 1,
      secondaryBg: "#FFCC99",
      secondaryBgOpacity: 3,
    },
    dark: {
      themeColor: "#FF6B6B",
      themeColorOpacity: 10,
      primaryBg: "#4D1F1F",
      primaryBgOpacity: 3,
      secondaryBg: "#331A1A",
      secondaryBgOpacity: 5,
    },
  },
  {
    id: 5,
    name: "Purple Haze",
    light: {
      themeColor: "#9B59B6",
      themeColorOpacity: 10,
      primaryBg: "#D7BDE2",
      primaryBgOpacity: 2,
      secondaryBg: "#E8DAEF",
      secondaryBgOpacity: 4,
    },
    dark: {
      themeColor: "#B088D9",
      themeColorOpacity: 10,
      primaryBg: "#2C1F3D",
      primaryBgOpacity: 2,
      secondaryBg: "#1A1225",
      secondaryBgOpacity: 6,
    },
  },
];

const applyTheme = (theme: any, mode: "light" | "dark") => {
  const modeColors = mode === "light" ? theme.light : theme.dark;

  // Get user-selected opacity values (or use defaults)
  const themeColorOpacity = getOpacity(theme.id, mode, 'themeColor', modeColors.themeColorOpacity);
  const primaryBgOpacity = getOpacity(theme.id, mode, 'primaryBg', modeColors.primaryBgOpacity);
  const secondaryBgOpacity = getOpacity(theme.id, mode, 'secondaryBg', modeColors.secondaryBgOpacity);

  // Create theme config object to pass to ThemeCustomizer
  const themeConfig = {
    mode: mode,
    themeColor: modeColors.themeColor,
    themeColorOpacity: themeColorOpacity,
    primaryBg: modeColors.primaryBg,
    primaryBgOpacity: primaryBgOpacity,
    secondaryBg: modeColors.secondaryBg,
    secondaryBgOpacity: secondaryBgOpacity,
  };

  // Apply theme through the ThemeCustomizer composable
  applyThemeToCustomizer(themeConfig);

  // Track which theme was applied for this mode
  if (mode === "light") {
    appliedLightTheme.value = theme.id;
  } else {
    appliedDarkTheme.value = theme.id;
  }

  // Show success notification
  $q.notify({
    type: 'positive',
    message: `${theme.name} applied to ${mode} mode successfully!`,
    position: 'top',
    timeout: 2000,
  });
};

const isThemeApplied = (theme: any, mode: "light" | "dark"): boolean => {
  if (mode === "light") {
    return appliedLightTheme.value === theme.id;
  } else {
    return appliedDarkTheme.value === theme.id;
  }
};
</script>

<style scoped>
.scroll-content {
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}

.theme-card {
  padding: 16px;
  border: 1px solid var(--o2-border-color);
  border-radius: 8px;
  background: var(--o2-card-bg);
}

.color-preview {
  width: 80px;
  height: 60px;
  border-radius: 4px;
  border: 1px solid var(--o2-border-color);
  margin: 8px 0;
}
</style>
