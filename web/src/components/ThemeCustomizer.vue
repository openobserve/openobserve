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

              <!-- Show opacity slider only for body backgrounds, not theme color -->
              <div v-if="colorVar.name !== '--o2-theme-color'" class="row items-center q-gutter-sm">
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

              <!-- Show opacity slider only for body backgrounds, not dark theme color -->
              <div v-if="colorVar.name !== '--o2-dark-theme-color'" class="row items-center q-gutter-sm">
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

// Light Mode Variables
const lightModeVariables = reactive([
  {
    name: "--o2-theme-color",
    label: "Theme Color",
    value: "#3F7994",
    opacity: 10, // 1.0 alpha (fully opaque)
  },
  {
    name: "--o2-body-primary-bg",
    label: "Body Primary Background",
    value: "#599BAE",
    opacity: 1, // 0.1 alpha
  },
  {
    name: "--o2-body-secondary-bg",
    label: "Body Secondary Background",
    value: "#599BAE",
    opacity: 4, // 0.4 alpha
  },
]);

// Dark Mode Variables - use same variable names as light mode
const darkModeVariables = reactive([
  {
    name: "--o2-dark-theme-color",
    label: "Dark Theme Color (for buttons/toggles)",
    value: "#3F7994",
    opacity: 10, // 1.0 alpha
  },
  {
    name: "--o2-body-primary-bg",
    label: "Body Primary Background",
    value: "#000000",
    opacity: 0, // 0.0 alpha (transparent by default)
  },
  {
    name: "--o2-body-secondary-bg",
    label: "Body Secondary Background",
    value: "#000000",
    opacity: 0, // 0.0 alpha (transparent by default)
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

    // Apply all dark mode variables to body (this overrides SCSS defaults)
    darkModeVariables.forEach(colorVar => {
      const rgbaColor = hexToRgba(colorVar.value, colorVar.opacity);
      document.body.style.setProperty(colorVar.name, rgbaColor);
    });

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

    // Apply all light mode variables to :root (this overrides SCSS defaults)
    lightModeVariables.forEach(colorVar => {
      const rgbaColor = hexToRgba(colorVar.value, colorVar.opacity);
      document.documentElement.style.setProperty(colorVar.name, rgbaColor);
    });

    // Apply menu variables based on light theme color
    const lightThemeColor = lightModeVariables.find(v => v.name === '--o2-theme-color');
    if (lightThemeColor) {
      applyMenuVariables(lightThemeColor.value, document.documentElement);
    }
  }

  // Update body gradient
  updateBodyGradient();
};

// Function to update theme from external sources (e.g., predefined themes)
const updateThemeFromPredefined = (themeConfig: any) => {
  const mode = themeConfig.mode || 'light';
  const isDarkMode = document.body.classList.contains('body--dark');

  if (mode === 'light') {
    // Update light mode variables
    const lightThemeColor = lightModeVariables.find(v => v.name === '--o2-theme-color');
    const lightPrimaryBg = lightModeVariables.find(v => v.name === '--o2-body-primary-bg');
    const lightSecondaryBg = lightModeVariables.find(v => v.name === '--o2-body-secondary-bg');

    if (lightThemeColor && themeConfig.themeColor) {
      lightThemeColor.value = themeConfig.themeColor;
      lightThemeColor.opacity = themeConfig.themeColorOpacity || 10;
    }
    if (lightPrimaryBg && themeConfig.primaryBg) {
      lightPrimaryBg.value = themeConfig.primaryBg;
      lightPrimaryBg.opacity = themeConfig.primaryBgOpacity || 1;
    }
    if (lightSecondaryBg && themeConfig.secondaryBg) {
      lightSecondaryBg.value = themeConfig.secondaryBg;
      lightSecondaryBg.opacity = themeConfig.secondaryBgOpacity || 4;
    }

    // Only apply if we're currently in light mode
    if (!isDarkMode) {
      applyAllVariablesForCurrentMode();
    }
  } else {
    // Update dark mode variables
    const darkThemeColor = darkModeVariables.find(v => v.name === '--o2-dark-theme-color');
    const darkPrimaryBg = darkModeVariables.find(v => v.name === '--o2-body-primary-bg');
    const darkSecondaryBg = darkModeVariables.find(v => v.name === '--o2-body-secondary-bg');

    if (darkThemeColor && themeConfig.themeColor) {
      darkThemeColor.value = themeConfig.themeColor;
      darkThemeColor.opacity = themeConfig.themeColorOpacity || 10;
    }
    if (darkPrimaryBg && themeConfig.primaryBg) {
      darkPrimaryBg.value = themeConfig.primaryBg;
      darkPrimaryBg.opacity = themeConfig.primaryBgOpacity !== undefined ? themeConfig.primaryBgOpacity : 0;
    }
    if (darkSecondaryBg && themeConfig.secondaryBg) {
      darkSecondaryBg.value = themeConfig.secondaryBg;
      darkSecondaryBg.opacity = themeConfig.secondaryBgOpacity !== undefined ? themeConfig.secondaryBgOpacity : 0;
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

    // If changing theme color, update menu variables
    if (colorName === '--o2-theme-color' || colorName === '--o2-dark-theme-color') {
      applyMenuVariables(colorVar.value, targetElement);
    }

    // If changing body backgrounds, force update the gradient
    if (colorName === '--o2-body-primary-bg' || colorName === '--o2-body-secondary-bg') {
      updateBodyGradient();
    }
  }
};

const updateBodyGradient = () => {
  const isDarkMode = document.body.classList.contains('body--dark');

  if (isDarkMode) {
    // In dark mode, check if user has customized the background
    const darkPrimary = darkModeVariables.find(v => v.name === '--o2-body-primary-bg');
    const darkSecondary = darkModeVariables.find(v => v.name === '--o2-body-secondary-bg');

    // Only apply gradient if user has set opacity > 0
    if (darkPrimary && darkPrimary.opacity > 0 || darkSecondary && darkSecondary.opacity > 0) {
      const primaryBg = darkPrimary ? hexToRgba(darkPrimary.value, darkPrimary.opacity) : 'transparent';
      const secondaryBg = darkSecondary ? hexToRgba(darkSecondary.value, darkSecondary.opacity) : 'transparent';

      const gradient = `linear-gradient(to bottom right, ${primaryBg}, ${secondaryBg})`;
      document.body.style.setProperty('background', gradient, 'important');
    } else {
      // Remove any custom gradient, let SCSS take over
      document.body.style.removeProperty('background');
    }
  } else {
    // In light mode, apply custom gradient
    const lightPrimary = lightModeVariables.find(v => v.name === '--o2-body-primary-bg');
    const lightSecondary = lightModeVariables.find(v => v.name === '--o2-body-secondary-bg');
    const primaryBg = lightPrimary ? hexToRgba(lightPrimary.value, lightPrimary.opacity) : 'rgba(89, 155, 174, 0.1)';
    const secondaryBg = lightSecondary ? hexToRgba(lightSecondary.value, lightSecondary.opacity) : 'rgba(89, 155, 174, 0.4)';

    const gradient = `linear-gradient(to bottom right, ${primaryBg}, ${secondaryBg})`;
    document.body.style.setProperty('background', gradient, 'important');
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

    // If changing theme color, update menu variables
    if (currentColorName.value === '--o2-theme-color' || currentColorName.value === '--o2-dark-theme-color') {
      applyMenuVariables(colorVar.value, targetElement);
    }

    // If changing body backgrounds, force update the gradient
    if (currentColorName.value === '--o2-body-primary-bg' || currentColorName.value === '--o2-body-secondary-bg') {
      updateBodyGradient();
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

  body.body--dark & {
    background: #1d1d1d;
    color: rgba(255, 255, 255, 0.87);
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
