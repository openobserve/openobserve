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
    <q-card
      class="predefined-theme-card"
      style="width: 400px; max-width: 90vw;"
    >
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
            <div v-for="theme in predefinedThemes" :key="theme.id" class="theme-card-compact q-mb-sm">
              <div class="row items-center no-wrap">
                <div class="color-preview-small" :style="{ backgroundColor: theme.light.themeColor }"></div>
                <div class="text-subtitle2 q-ml-sm">{{ theme.name }}</div>
                <q-space />
                <q-badge v-if="isThemeApplied(theme, 'light')" color="positive" label="Applied" class="text-caption q-mr-xs" />
                <q-btn
                  label="Apply"
                  color="primary"
                  size="sm"
                  unelevated
                  @click="applyTheme(theme, 'light')"
                />
              </div>
            </div>

            <!-- Custom Color Picker -->
            <div class="theme-card-compact q-mb-sm">
              <div class="row items-center no-wrap">
                <div class="color-preview-small clickable" :style="{ backgroundColor: customLightColor }" @click="openColorPicker('light')">
                  <q-icon name="colorize" size="16px" color="white" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);" />
                </div>
                <div class="text-subtitle2 q-ml-sm">Custom Color</div>
                <q-space />
                <q-badge v-if="isCustomThemeApplied('light')" color="positive" label="Applied" class="text-caption q-mr-xs" />
                <q-btn
                  label="Apply"
                  color="primary"
                  size="sm"
                  unelevated
                  @click="applyCustomTheme('light')"
                />
              </div>
            </div>
          </q-tab-panel>

          <!-- Dark Mode Themes -->
          <q-tab-panel name="dark" class="q-pa-none">
            <div v-for="theme in predefinedThemes" :key="theme.id" class="theme-card-compact q-mb-sm">
              <div class="row items-center no-wrap">
                <div class="color-preview-small" :style="{ backgroundColor: theme.dark.themeColor }"></div>
                <div class="text-subtitle2 q-ml-sm">{{ theme.name }}</div>
                <q-space />
                <q-badge v-if="isThemeApplied(theme, 'dark')" color="positive" label="Applied" class="text-caption q-mr-xs" />
                <q-btn
                  label="Apply"
                  color="primary"
                  size="sm"
                  unelevated
                  @click="applyTheme(theme, 'dark')"
                />
              </div>
            </div>

            <!-- Custom Color Picker -->
            <div class="theme-card-compact q-mb-sm">
              <div class="row items-center no-wrap">
                <div class="color-preview-small clickable" :style="{ backgroundColor: customDarkColor }" @click="openColorPicker('dark')">
                  <q-icon name="colorize" size="16px" color="white" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);" />
                </div>
                <div class="text-subtitle2 q-ml-sm">Custom Color</div>
                <q-space />
                <q-badge v-if="isCustomThemeApplied('dark')" color="positive" label="Applied" class="text-caption q-mr-xs" />
                <q-btn
                  label="Apply"
                  color="primary"
                  size="sm"
                  unelevated
                  @click="applyCustomTheme('dark')"
                />
              </div>
            </div>
          </q-tab-panel>
        </q-tab-panels>
      </q-card-section>
    </q-card>

    <!-- Color Picker Dialog -->
    <q-dialog v-model="showColorPicker">
      <q-card style="min-width: 300px">
        <q-card-section>
          <div class="text-h6">Pick Custom Color</div>
        </q-card-section>
        <q-card-section>
          <q-color
            v-model="tempColor"
            @update:model-value="updateCustomColor"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Close" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { usePredefinedThemes } from "@/composables/usePredefinedThemes";
import { useQuasar } from "quasar";
import { useStore } from "vuex";

const $q = useQuasar();
const store = useStore();
const { isOpen } = usePredefinedThemes();
const dialogOpen = ref(false);
const activeTab = ref("light");

// Track applied themes for each mode - Load from localStorage
const appliedLightTheme = ref<number | null>(
  localStorage.getItem('appliedLightTheme')
    ? parseInt(localStorage.getItem('appliedLightTheme')!)
    : null
);
const appliedDarkTheme = ref<number | null>(
  localStorage.getItem('appliedDarkTheme')
    ? parseInt(localStorage.getItem('appliedDarkTheme')!)
    : null
);

// Custom color picker state - Load from localStorage
const customLightColor = ref(localStorage.getItem('customLightColor') || "#3F7994");
const customDarkColor = ref(localStorage.getItem('customDarkColor') || "#5B9FBE");
const showColorPicker = ref(false);
const currentPickerMode = ref<"light" | "dark">("light");
const tempColor = ref("#3F7994");

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

// Function to apply theme colors directly to CSS variables
const applyThemeColors = (themeColor: string, mode: "light" | "dark", isDefault: boolean = false) => {
  const isDarkMode = mode === "dark";

  if (isDarkMode) {
    // Apply dark mode theme color
    const rgbaColor = hexToRgba(themeColor, 10);
    document.body.style.setProperty('--o2-dark-theme-color', rgbaColor);

    // Apply menu gradient colors
    if (isDefault) {
      // Use default menu gradient colors
      document.body.style.setProperty('--o2-menu-gradient-start', 'rgba(89, 155, 174, 0.3)');
      document.body.style.setProperty('--o2-menu-gradient-end', 'rgba(48, 193, 233, 0.3)');
      // Use default menu color for dark mode
      document.body.style.setProperty('--o2-menu-color', '#FFFFFF');
    } else {
      // Calculate menu gradient from theme color
      const menuGradientStart = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      const menuGradientEnd = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      document.body.style.setProperty('--o2-menu-gradient-start', menuGradientStart);
      document.body.style.setProperty('--o2-menu-gradient-end', menuGradientEnd);
      // Use theme color as menu color for dark mode
      document.body.style.setProperty('--o2-menu-color', themeColor);
    }

    // Clear light mode variables
    document.documentElement.style.removeProperty('--o2-theme-color');
    document.documentElement.style.removeProperty('--o2-body-primary-bg');
    document.documentElement.style.removeProperty('--o2-body-secondary-bg');
    document.body.style.removeProperty('background');
  } else {
    // Apply light mode theme color
    const rgbaColor = hexToRgba(themeColor, 10);
    document.documentElement.style.setProperty('--o2-theme-color', rgbaColor);

    // Auto-calculate and apply background colors based on theme color
    const primaryBg = hexToRgba(themeColor, 0.1); // 0.01 alpha (1%)
    const secondaryBg = hexToRgba(themeColor, 4); // 0.4 alpha (40%)

    document.documentElement.style.setProperty('--o2-body-primary-bg', primaryBg);
    document.documentElement.style.setProperty('--o2-body-secondary-bg', secondaryBg);

    // Update body gradient with auto-calculated colors
    const gradient = `linear-gradient(to bottom right, ${primaryBg}, ${secondaryBg})`;
    document.body.style.setProperty('background', gradient, 'important');

    // Apply menu gradient colors
    if (isDefault) {
      // Use default menu gradient colors
      document.documentElement.style.setProperty('--o2-menu-gradient-start', 'rgba(89, 175, 199, 0.3)');
      document.documentElement.style.setProperty('--o2-menu-gradient-end', 'rgba(48, 193, 233, 0.3)');
      // Use default menu color for light mode
      document.documentElement.style.setProperty('--o2-menu-color', '#3F7994');
    } else {
      // Calculate menu gradient from theme color
      const menuGradientStart = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      const menuGradientEnd = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      document.documentElement.style.setProperty('--o2-menu-gradient-start', menuGradientStart);
      document.documentElement.style.setProperty('--o2-menu-gradient-end', menuGradientEnd);
      // Use theme color as menu color for light mode
      document.documentElement.style.setProperty('--o2-menu-color', themeColor);
    }

    // Clear dark mode variables
    document.body.style.removeProperty('--o2-dark-theme-color');
  }
};

// Watch for theme mode changes and reapply colors
let observer: MutationObserver | null = null;

onMounted(() => {
  // Apply default theme on initial load if no theme has been applied
  const currentMode = store.state.theme === "dark" ? "dark" : "light";
  const appliedTheme = currentMode === "light" ? appliedLightTheme.value : appliedDarkTheme.value;

  if (appliedTheme === null) {
    // No theme applied yet, apply the default blue theme silently
    const defaultTheme = predefinedThemes.find(t => t.id === 1);
    if (defaultTheme) {
      const modeColors = currentMode === "light" ? defaultTheme.light : defaultTheme.dark;
      applyThemeColors(modeColors.themeColor, currentMode, true);

      // Track the applied theme and save to localStorage
      if (currentMode === "light") {
        appliedLightTheme.value = defaultTheme.id;
        localStorage.setItem('appliedLightTheme', defaultTheme.id.toString());
      } else {
        appliedDarkTheme.value = defaultTheme.id;
        localStorage.setItem('appliedDarkTheme', defaultTheme.id.toString());
      }
    }
  } else {
    // Theme was loaded from localStorage, reapply it
    if (appliedTheme === -1) {
      // Custom theme
      const color = currentMode === "light" ? customLightColor.value : customDarkColor.value;
      applyThemeColors(color, currentMode, false);
    } else {
      // Predefined theme
      const theme = predefinedThemes.find(t => t.id === appliedTheme);
      if (theme) {
        const isDefault = theme.id === 1;
        const modeColors = currentMode === "light" ? theme.light : theme.dark;
        applyThemeColors(modeColors.themeColor, currentMode, isDefault);
      }
    }
  }

  // Start observing body class changes for theme mode switches
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        // Reapply the current theme when mode changes
        const isDarkMode = document.body.classList.contains('body--dark');
        const currentMode = isDarkMode ? 'dark' : 'light';

        // Get the applied theme for the current mode
        const appliedTheme = currentMode === 'light' ? appliedLightTheme.value : appliedDarkTheme.value;

        if (appliedTheme !== null) {
          // Theme exists for this mode, apply it
          if (appliedTheme === -1) {
            // Custom theme
            const color = currentMode === 'light' ? customLightColor.value : customDarkColor.value;
            applyThemeColors(color, currentMode, false);
          } else {
            // Predefined theme
            const theme = predefinedThemes.find(t => t.id === appliedTheme);
            if (theme) {
              const isDefault = theme.id === 1; // Default Blue theme has id 1
              const modeColors = currentMode === 'light' ? theme.light : theme.dark;
              applyThemeColors(modeColors.themeColor, currentMode, isDefault);
            }
          }
        } else {
          // No theme applied for this mode, apply default theme
          const defaultTheme = predefinedThemes.find(t => t.id === 1);
          if (defaultTheme) {
            const modeColors = currentMode === 'light' ? defaultTheme.light : defaultTheme.dark;
            applyThemeColors(modeColors.themeColor, currentMode, true);

            // Track and save the applied theme
            if (currentMode === 'light') {
              appliedLightTheme.value = defaultTheme.id;
              localStorage.setItem('appliedLightTheme', defaultTheme.id.toString());
            } else {
              appliedDarkTheme.value = defaultTheme.id;
              localStorage.setItem('appliedDarkTheme', defaultTheme.id.toString());
            }
          }
        }
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

// Predefined themes with both light and dark mode colors
// Each theme has:
// - id: unique identifier
// - name: display name for the theme
// - light: colors for light mode
// - dark: colors for dark mode
//
// For each mode:
// - themeColor: hex color for buttons/toggles/borders
// - themeColorOpacity: opacity value (always 10 = fully opaque)
const predefinedThemes = [
  {
    id: 1,
    name: "Default Blue",
    light: {
      themeColor: "#3F7994",
      themeColorOpacity: 10,
    },
    dark: {
      themeColor: "#5B9FBE",
      themeColorOpacity: 10,
    },
  },
  {
    id: 2,
    name: "Ocean Breeze",
    light: {
      themeColor: "#7678ed",
      themeColorOpacity: 10,
    },
    dark: {
      themeColor: "#8B8DF0",
      themeColorOpacity: 10,
    },
  },
  {
    id: 4,
    name: "Purple Dream",
    light: {
      themeColor: "#9C27B0",
      themeColorOpacity: 10,
    },
    dark: {
      themeColor: "#BA68C8",
      themeColorOpacity: 10,
    },
  },
  {
    id: 5,
    name: "Indigo Night",
    light: {
      themeColor: "#3F51B5",
      themeColorOpacity: 10,
    },
    dark: {
      themeColor: "#5C6BC0",
      themeColorOpacity: 10,
    },
  },
  {
    id: 8,
    name: "Sky Blue",
    light: {
      themeColor: "#0288D1",
      themeColorOpacity: 10,
    },
    dark: {
      themeColor: "#29B6F6",
      themeColorOpacity: 10,
    },
  }
];

const applyTheme = (theme: any, mode: "light" | "dark") => {
  const modeColors = mode === "light" ? theme.light : theme.dark;

  // Check if this is the default theme (id: 1)
  const isDefault = theme.id === 1;

  // Apply theme colors directly
  applyThemeColors(modeColors.themeColor, mode, isDefault);

  // Track which theme was applied for this mode and save to localStorage
  if (mode === "light") {
    appliedLightTheme.value = theme.id;
    localStorage.setItem('appliedLightTheme', theme.id.toString());
  } else {
    appliedDarkTheme.value = theme.id;
    localStorage.setItem('appliedDarkTheme', theme.id.toString());
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

// Custom theme functions
const openColorPicker = (mode: "light" | "dark") => {
  currentPickerMode.value = mode;
  tempColor.value = mode === "light" ? customLightColor.value : customDarkColor.value;
  showColorPicker.value = true;
};

const applyCustomTheme = (mode: "light" | "dark") => {
  const color = mode === "light" ? customLightColor.value : customDarkColor.value;

  // Apply theme colors directly (custom theme is never default)
  applyThemeColors(color, mode, false);

  // Clear predefined theme tracking and mark custom as applied, save to localStorage
  if (mode === "light") {
    appliedLightTheme.value = -1; // -1 indicates custom theme
    localStorage.setItem('appliedLightTheme', '-1');
    localStorage.setItem('customLightColor', color);
  } else {
    appliedDarkTheme.value = -1;
    localStorage.setItem('appliedDarkTheme', '-1');
    localStorage.setItem('customDarkColor', color);
  }

  // Show success notification
  $q.notify({
    type: 'positive',
    message: `Custom color applied to ${mode} mode successfully!`,
    position: 'top',
    timeout: 2000,
  });
};

const isCustomThemeApplied = (mode: "light" | "dark"): boolean => {
  if (mode === "light") {
    return appliedLightTheme.value === -1;
  } else {
    return appliedDarkTheme.value === -1;
  }
};

const updateCustomColor = () => {
  if (currentPickerMode.value === "light") {
    customLightColor.value = tempColor.value;
    localStorage.setItem('customLightColor', tempColor.value);
  } else {
    customDarkColor.value = tempColor.value;
    localStorage.setItem('customDarkColor', tempColor.value);
  }
};
</script>

<style scoped>
.scroll-content {
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}

.theme-card-compact {
  padding: 8px 12px;
  border: 1px solid var(--o2-border-color);
  border-radius: 6px;
  background: var(--o2-card-bg);
}

.color-preview-small {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  border: 1px solid var(--o2-border-color);
  flex-shrink: 0;
  position: relative;
}

.color-preview-small.clickable {
  cursor: pointer;
  transition: transform 0.2s;
}

.color-preview-small.clickable:hover {
  transform: scale(1.1);
}
.predefined-theme-card{
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
</style>
