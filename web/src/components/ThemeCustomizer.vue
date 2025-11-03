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
  <q-dialog
    v-model="dialogOpen"
    position="right"
    maximized
    seamless
    transition-show="slide-left"
    transition-hide="slide-right"
  >
    <q-card class="theme-customizer-card">
      <q-card-section class="row items-center q-pb-none sticky-header">
        <div class="text-h6">Theme Customization</div>
        <q-space />
        <q-btn
          icon="content_copy"
          flat
          round
          dense
          @click="copyColorConfig"
        >
          <q-tooltip>Copy Color Configuration</q-tooltip>
        </q-btn>
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>


      <q-card-section class="q-pt-xs q-pb-sm tw-flex">
        <div class="text-caption text-grey-7 tw-flex  q-gutter-xs">
          <q-icon name="info" size="16px" />
          <span>Panel auto-hides when you click away. Hover over the edge to bring it back.</span>
        </div>
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

      <q-card-section class="q-pt-none">
        <q-tab-panels v-model="activeTab" animated>
          <q-tab-panel name="light" class="q-pa-none">
            <div v-for="colorVar in lightModeVariables" :key="colorVar.name" class="color-item q-mb-lg">
              <div class="text-subtitle2 q-mb-sm">{{ colorVar.label }}</div>

              <div class="row items-center q-gutter-sm q-mb-sm">
                <q-input
                  :model-value="getDisplayColor(colorVar)"
                  dense
                  outlined
                  readonly
                  style="flex: 1; font-family: monospace; font-size: 12px;"
                />

                <q-btn
                  icon="colorize"
                  round
                  color="primary"
                  size="sm"
                  @click="openColorPicker(colorVar.name, 'light')"
                >
                  <q-tooltip>Pick Color</q-tooltip>
                </q-btn>
              </div>

              <!-- Opacity slider for all colors -->
              <div class="row items-center q-gutter-sm">
                <div class="text-caption" style="min-width: 60px;">Opacity:</div>
                <q-slider
                  :model-value="colorVar.opacity"
                  @update:model-value="(val) => updateOpacity(colorVar.name, val, 'light')"
                  :min="0"
                  :max="10"
                  :step="1"
                  label
                  :label-value="colorVar.opacity"
                  color="primary"
                  style="flex: 1"
                />
              </div>
            </div>
          </q-tab-panel>

          <q-tab-panel name="dark" class="q-pa-none">
            <div v-for="colorVar in darkModeVariables" :key="colorVar.name" class="color-item q-mb-lg">
              <div class="text-subtitle2 q-mb-sm">{{ colorVar.label }}</div>

              <div class="row items-center q-gutter-sm q-mb-sm">
                <q-input
                  :model-value="getDisplayColor(colorVar)"
                  dense
                  outlined
                  readonly
                  style="flex: 1; font-family: monospace; font-size: 12px;"
                />

                <q-btn
                  icon="colorize"
                  round
                  color="primary"
                  size="sm"
                  @click="openColorPicker(colorVar.name, 'dark')"
                >
                  <q-tooltip>Pick Color</q-tooltip>
                </q-btn>
              </div>

              <!-- Opacity slider for all colors -->
              <div class="row items-center q-gutter-sm">
                <div class="text-caption" style="min-width: 60px;">Opacity:</div>
                <q-slider
                  :model-value="colorVar.opacity"
                  @update:model-value="(val) => updateOpacity(colorVar.name, val, 'dark')"
                  :min="0"
                  :max="10"
                  :step="1"
                  label
                  :label-value="colorVar.opacity"
                  color="primary"
                  style="flex: 1"
                />
              </div>
            </div>
          </q-tab-panel>
        </q-tab-panels>
      </q-card-section>

      <q-dialog v-model="showColorPicker">
        <q-card style="min-width: 300px">
          <q-card-section>
            <div class="text-h6">{{ currentColorLabel }}</div>
          </q-card-section>
          <q-card-section>
            <q-color v-model="currentColorValue" @update:model-value="applyColor" />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Close" color="primary" v-close-popup />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch, reactive, onMounted, onUnmounted } from "vue";
import { useThemeCustomizer } from "@/composables/useThemeCustomizer";
import { useQuasar } from "quasar";
import { useStore } from "vuex";

const $q = useQuasar();
const store = useStore();
const { isOpen, registerUpdateFunction } = useThemeCustomizer();
const dialogOpen = ref(false);
const showColorPicker = ref(false);
const currentColorName = ref("");
const currentColorLabel = ref("");
const currentColorValue = ref("");
const currentMode = ref<"light" | "dark">("light");
const activeTab = ref("light");

// Light Mode Variables - only theme color, backgrounds are auto-calculated
const lightModeVariables = reactive([
  {
    name: "--o2-theme-color",
    label: "Theme Color",
    value: "#3F7994",
    opacity: 10, // 1.0 alpha (fully opaque)
  },
]);

// Dark Mode Variables - only theme color, no background customization
const darkModeVariables = reactive([
  {
    name: "--o2-dark-theme-color",
    label: "Dark Theme Color (for buttons/toggles)",
    value: "#3F7994",
    opacity: 10, // 1.0 alpha
  },
]);

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

// Function to apply menu variables based on theme color
// Menu uses theme color with different opacities:
// - Menu Gradient Start: 0.04 (4%)
// - Menu Gradient End: 0.08 (8%)
// - Menu Border Color: 0.6 (60%)
const applyMenuVariables = (themeColorHex: string, targetElement: HTMLElement) => {
  const menuGradientStart = hexToRgba(themeColorHex, 0.4); // 0.4 on 1-10 scale = 0.04 alpha
  const menuGradientEnd = hexToRgba(themeColorHex, 0.8);   // 0.8 on 1-10 scale = 0.08 alpha
  const menuBorderColor = hexToRgba(themeColorHex, 6);     // 6 on 1-10 scale = 0.6 alpha

  targetElement.style.setProperty('--o2-menu-gradient-start', menuGradientStart);
  targetElement.style.setProperty('--o2-menu-gradient-end', menuGradientEnd);
  targetElement.style.setProperty('--o2-menu-border-color', menuBorderColor);
};

// Function to apply all variables for the current mode
const applyAllVariablesForCurrentMode = () => {
  const isDarkMode = document.body.classList.contains('body--dark');

  // List of all shared variable names that can appear in both modes
  const sharedVariables = [
    '--o2-body-primary-bg',
    '--o2-body-secondary-bg',
    '--o2-menu-gradient-start',
    '--o2-menu-gradient-end',
    '--o2-menu-border-color'
  ];

  if (isDarkMode) {
    // Clear shared variables from :root (light mode)
    sharedVariables.forEach(varName => {
      document.documentElement.style.removeProperty(varName);
    });
    // Also clear light-specific variables
    document.documentElement.style.removeProperty('--o2-theme-color');

    // Apply dark mode theme color only (let SCSS handle backgrounds)
    darkModeVariables.forEach(colorVar => {
      const rgbaColor = hexToRgba(colorVar.value, colorVar.opacity);
      document.body.style.setProperty(colorVar.name, rgbaColor);
    });

    // Remove any custom background, let SCSS take over for dark mode
    document.body.style.removeProperty('background');

    // Apply menu variables based on dark theme color
    const darkThemeColor = darkModeVariables.find(v => v.name === '--o2-dark-theme-color');
    if (darkThemeColor) {
      applyMenuVariables(darkThemeColor.value, document.body);
    }
  } else {
    // Clear shared variables from body (dark mode)
    sharedVariables.forEach(varName => {
      document.body.style.removeProperty(varName);
    });
    // Also clear dark-specific variable
    document.body.style.removeProperty('--o2-dark-theme-color');

    // Apply theme color to :root
    const lightThemeColor = lightModeVariables.find(v => v.name === '--o2-theme-color');
    if (lightThemeColor) {
      const rgbaColor = hexToRgba(lightThemeColor.value, lightThemeColor.opacity);
      document.documentElement.style.setProperty('--o2-theme-color', rgbaColor);

      // Apply menu variables based on light theme color
      applyMenuVariables(lightThemeColor.value, document.documentElement);

      // Auto-calculate and apply background colors based on theme color
      const primaryBg = hexToRgba(lightThemeColor.value, 0.1); // 0.01 alpha (1%)
      const secondaryBg = hexToRgba(lightThemeColor.value, 4); // 0.4 alpha (40%)

      document.documentElement.style.setProperty('--o2-body-primary-bg', primaryBg);
      document.documentElement.style.setProperty('--o2-body-secondary-bg', secondaryBg);

      // Update body gradient with auto-calculated colors
      const gradient = `linear-gradient(to bottom right, ${primaryBg}, ${secondaryBg})`;
      document.body.style.setProperty('background', gradient, 'important');
    }
  }
};

// Function to update theme from external sources (e.g., predefined themes)
const updateThemeFromPredefined = (themeConfig: any) => {
  const mode = themeConfig.mode || 'light';
  const isDarkMode = document.body.classList.contains('body--dark');

  if (mode === 'light') {
    // Update light mode variables - only theme color
    const lightThemeColor = lightModeVariables.find(v => v.name === '--o2-theme-color');

    if (lightThemeColor && themeConfig.themeColor) {
      lightThemeColor.value = themeConfig.themeColor;
      lightThemeColor.opacity = themeConfig.themeColorOpacity || 10;
    }

    // Only apply if we're currently in light mode
    if (!isDarkMode) {
      applyAllVariablesForCurrentMode();
    }
  } else {
    // Update dark mode variables - only theme color
    const darkThemeColor = darkModeVariables.find(v => v.name === '--o2-dark-theme-color');

    if (darkThemeColor && themeConfig.themeColor) {
      darkThemeColor.value = themeConfig.themeColor;
      darkThemeColor.opacity = themeConfig.themeColorOpacity || 10;
    }

    // Only apply if we're currently in dark mode
    if (isDarkMode) {
      applyAllVariablesForCurrentMode();
    }
  }
};

// Watch for theme changes and reapply variables
let observer: MutationObserver | null = null;

onMounted(() => {
  // Register the update function so predefined themes can update our state
  registerUpdateFunction(updateThemeFromPredefined);

  // Apply initial variables for current mode
  applyAllVariablesForCurrentMode();

  // Start observing body class changes
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        applyAllVariablesForCurrentMode();
      }
    });
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });
});

onUnmounted(() => {
  if (observer) {
    observer.disconnect();
  }
});

const openColorPicker = (colorName: string, mode: "light" | "dark") => {
  const variables = mode === "light" ? lightModeVariables : darkModeVariables;
  const colorVar = variables.find(c => c.name === colorName);
  if (colorVar) {
    currentColorName.value = colorName;
    currentColorLabel.value = colorVar.label;
    currentColorValue.value = colorVar.value;
    currentMode.value = mode;
    showColorPicker.value = true;
  }
};

const hexToRgba = (hex: string, opacity: number): string => {
  // Remove # if present
  hex = hex.replace('#', '');

  // Parse hex to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Convert opacity scale (1-10) to alpha (0.1-1.0)
  const alpha = opacity / 10;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getDisplayColor = (colorVar: any): string => {
  return hexToRgba(colorVar.value, colorVar.opacity);
};

const updateOpacity = (colorName: string, newOpacity: number, mode: "light" | "dark") => {
  const variables = mode === "light" ? lightModeVariables : darkModeVariables;
  const colorVar = variables.find(c => c.name === colorName);
  if (colorVar) {
    colorVar.opacity = newOpacity;
    const rgbaColor = hexToRgba(colorVar.value, newOpacity);

    // Apply to the correct element based on mode
    const targetElement = mode === "dark" && document.body.classList.contains('body--dark')
      ? document.body
      : document.documentElement;

    targetElement.style.setProperty(colorName, rgbaColor);

    // If changing theme color, update menu variables and backgrounds
    if (colorName === '--o2-theme-color') {
      applyMenuVariables(colorVar.value, targetElement);

      // Auto-update background colors based on new theme color
      const primaryBg = hexToRgba(colorVar.value, 0.1); // 0.01 alpha (1%)
      const secondaryBg = hexToRgba(colorVar.value, 4); // 0.4 alpha (40%)

      document.documentElement.style.setProperty('--o2-body-primary-bg', primaryBg);
      document.documentElement.style.setProperty('--o2-body-secondary-bg', secondaryBg);

      // Update body gradient
      const gradient = `linear-gradient(to bottom right, ${primaryBg}, ${secondaryBg})`;
      document.body.style.setProperty('background', gradient, 'important');
    }

    if (colorName === '--o2-dark-theme-color') {
      applyMenuVariables(colorVar.value, targetElement);
    }
  }
};

const applyColor = () => {
  const variables = currentMode.value === "light" ? lightModeVariables : darkModeVariables;
  const colorVar = variables.find(c => c.name === currentColorName.value);
  if (colorVar) {
    colorVar.value = currentColorValue.value;
    const rgbaColor = hexToRgba(colorVar.value, colorVar.opacity);

    // Apply to the correct element based on mode
    const targetElement = currentMode.value === "dark" && document.body.classList.contains('body--dark')
      ? document.body
      : document.documentElement;

    targetElement.style.setProperty(currentColorName.value, rgbaColor);

    // If changing theme color, update menu variables and backgrounds
    if (currentColorName.value === '--o2-theme-color') {
      applyMenuVariables(colorVar.value, targetElement);

      // Auto-update background colors based on new theme color
      const primaryBg = hexToRgba(colorVar.value, 0.1); // 0.01 alpha (1%)
      const secondaryBg = hexToRgba(colorVar.value, 4); // 0.4 alpha (40%)

      document.documentElement.style.setProperty('--o2-body-primary-bg', primaryBg);
      document.documentElement.style.setProperty('--o2-body-secondary-bg', secondaryBg);

      // Update body gradient
      const gradient = `linear-gradient(to bottom right, ${primaryBg}, ${secondaryBg})`;
      document.body.style.setProperty('background', gradient, 'important');
    }

    if (currentColorName.value === '--o2-dark-theme-color') {
      applyMenuVariables(colorVar.value, targetElement);
    }
  }
};

const copyColorConfig = async () => {
  try {
    // Create separate objects for light and dark mode configurations
    const lightConfig = lightModeVariables.reduce((acc, colorVar) => {
      acc[colorVar.name] = {
        color: colorVar.value,
        opacity: colorVar.opacity / 10, // Convert to 0.1-1.0 scale
      };
      return acc;
    }, {} as Record<string, { color: string; opacity: number }>);

    const darkConfig = darkModeVariables.reduce((acc, colorVar) => {
      acc[colorVar.name] = {
        color: colorVar.value,
        opacity: colorVar.opacity / 10, // Convert to 0.1-1.0 scale
      };
      return acc;
    }, {} as Record<string, { color: string; opacity: number }>);

    const colorConfig = {
      lightMode: lightConfig,
      darkMode: darkConfig,
    };

    // Convert to formatted JSON string
    const configString = JSON.stringify(colorConfig, null, 2);

    // Copy to clipboard
    await navigator.clipboard.writeText(configString);

    // Show success notification
    $q.notify({
      type: 'positive',
      message: 'Color configuration copied to clipboard!',
      position: 'top',
      timeout: 2000,
    });
  } catch (error) {
    console.error('Failed to copy color configuration:', error);
    $q.notify({
      type: 'negative',
      message: 'Failed to copy configuration',
      position: 'top',
      timeout: 2000,
    });
  }
};
</script>

<style scoped lang="scss">
.theme-customizer-card {
  width: 450px;
  max-width: 90vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
  color: rgba(0, 0, 0, 0.87);
  opacity: 0;

  body.body--dark & {
    background: #1d1d1d;
    color: rgba(255, 255, 255, 0.87);
  }
  &:hover{
    opacity: 1;
  }
}
.sticky-header {
  position: sticky;
  top: 0;
  background: inherit;
  z-index: 1;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.28);
  }
}

.scroll-content {
  flex: 1;
  overflow-y: auto;
}

.color-item {
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.05);

  body.body--dark & {
    background: rgba(255, 255, 255, 0.05);
  }
}

// Ensure proper text colors for all elements in light mode
:deep(.text-subtitle2),
:deep(.text-body2),
:deep(.q-field__label),
:deep(.q-field__native) {
  color: rgba(0, 0, 0, 0.87);
}

:deep(.q-input) {
  .q-field__control {
    color: rgba(0, 0, 0, 0.87);

    &:before {
      border-color: rgba(0, 0, 0, 0.28);
    }
  }
}

// Dark mode overrides
body.body--dark {
  .theme-customizer-card {
    :deep(.text-subtitle2),
    :deep(.text-body2),
    :deep(.q-field__label),
    :deep(.q-field__native) {
      color: rgba(255, 255, 255, 0.87);
    }

    :deep(.q-input) {
      .q-field__control {
        color: rgba(255, 255, 255, 0.87);

        &:before {
          border-color: rgba(255, 255, 255, 0.28);
        }
      }
    }

    :deep(.q-btn__content) {
      color: rgba(255, 255, 255, 0.87);
    }
  }
}
</style>
