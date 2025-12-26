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
        <q-btn
          label="Reset"
          icon="refresh"
          flat
          dense
          color="negative"
          @click="resetToDefaultTheme"
          class="q-mr-sm"
        />
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

      <q-card-section class="q-pt-none scroll-content-predefined-themes">
        <q-tab-panels v-model="activeTab" animated>
          <!-- Light Mode Themes -->
          <q-tab-panel name="light" class="q-pa-none">
            <div v-for="theme in predefinedThemes" :key="theme.id" class="theme-card-compact q-mb-sm">
              <div class="row items-center no-wrap">
                <div class="color-preview-small" :style="{ backgroundColor: theme.light.themeColor }"></div>
                <div class="q-ml-sm" style="flex: 1; min-width: 0;">
                  <div class="text-subtitle2">{{ theme.name }}</div>
                  <div class="text-caption text-grey-7">{{ theme.light.themeColor }}</div>
                </div>
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
                <div class="q-ml-sm" style="flex: 1; min-width: 0;">
                  <div class="text-subtitle2">Custom Color</div>
                  <div class="text-caption text-grey-7">{{ customLightColor }}</div>
                </div>
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
                <div class="q-ml-sm" style="flex: 1; min-width: 0;">
                  <div class="text-subtitle2">{{ theme.name }}</div>
                  <div class="text-caption text-grey-7">{{ theme.dark.themeColor }}</div>
                </div>
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
                <div class="q-ml-sm" style="flex: 1; min-width: 0;">
                  <div class="text-subtitle2">Custom Color</div>
                  <div class="text-caption text-grey-7">{{ customDarkColor }}</div>
                </div>
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

      <!-- Note at the bottom -->
      <q-card-section class="q-pt-none q-pb-sm">
        <q-separator class="q-mb-sm" />
        <div class="text-caption text-grey-7 tw:flex tw:items-start q-gutter-xs">
          <q-icon name="info_outline" size="14px" class="q-mt-xs" />
          <span>Theme preferences are stored locally on this device and will not sync across different browsers or devices.</span>
        </div>
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
import { hexToRgba, applyThemeColors } from "@/utils/theme";

const $q = useQuasar();
const store = useStore();
const { isOpen } = usePredefinedThemes();
const dialogOpen = ref(false);
const activeTab = ref("light");

// Default colors
// Get default colors from Vuex store (centralized - can be updated in one place)
const DEFAULT_LIGHT_COLOR = store.state.defaultThemeColors.light;
const DEFAULT_DARK_COLOR = store.state.defaultThemeColors.dark;

// Track applied themes for each mode
// Read from localStorage if available, otherwise set to null (no theme applied yet)
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

// Custom color state for the color picker in PredefinedThemes dialog
// Priority order (highest to lowest):
// 1. Vuex store tempThemeColors (live preview from General Settings - highest priority)
// 2. localStorage customColor (permanently saved custom color)
// 3. Organization settings (backend default for the organization)
// 4. Application defaults (#3F7994 for light, #5B9FBE for dark)
const customLightColor = ref(
  store.state.tempThemeColors?.light ||
  localStorage.getItem('customLightColor') ||
  store.state?.organizationData?.organizationSettings?.light_mode_theme_color ||
  DEFAULT_LIGHT_COLOR
);
const customDarkColor = ref(
  store.state.tempThemeColors?.dark ||
  localStorage.getItem('customDarkColor') ||
  store.state?.organizationData?.organizationSettings?.dark_mode_theme_color ||
  DEFAULT_DARK_COLOR
);

// Color picker dialog state
const showColorPicker = ref(false);                          // Controls dialog visibility
const currentPickerMode = ref<"light" | "dark">("light");    // Which mode is being edited
const tempColor = ref(customLightColor.value);               // Bound to q-color component

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

// Watch for organization settings changes and update custom colors
// This watcher handles the case where organizationSettings load AFTER component initialization
// or when admin updates organization settings while PredefinedThemes dialog is open
watch(
  () => store.state?.organizationData?.organizationSettings,
  (newSettings, oldSettings) => {
    if (newSettings && newSettings !== oldSettings) {
      // IMPORTANT: Don't override if user is actively previewing a color from General Settings
      // If temp colors exist in Vuex store, skip update to preserve the preview
      const hasTempColors = store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
      if (hasTempColors) {
        return;
      }

      const currentMode = store.state.theme === "dark" ? "dark" : "light";
      let shouldApply = false;

      // Only update if localStorage doesn't have custom colors
      if (!localStorage.getItem('customLightColor') && newSettings.light_mode_theme_color) {
        customLightColor.value = newSettings.light_mode_theme_color;
        if (currentMode === 'light' && appliedLightTheme.value === -1) {
          shouldApply = true;
        }
      }
      if (!localStorage.getItem('customDarkColor') && newSettings.dark_mode_theme_color) {
        customDarkColor.value = newSettings.dark_mode_theme_color;
        if (currentMode === 'dark' && appliedDarkTheme.value === -1) {
          shouldApply = true;
        }
      }

      // Apply theme if custom theme is active and we updated the color
      if (shouldApply) {
        const color = currentMode === "light" ? customLightColor.value : customDarkColor.value;
        applyThemeColors(color, currentMode, false);
      }
    }
  },
  { deep: true }
);

// MutationObserver for watching body class changes (theme mode switches)
// This will be initialized in onMounted and cleaned up in onUnmounted
let observer: MutationObserver | null = null;

/**
 * Component mounted lifecycle hook
 * Initializes theme colors and sets up MutationObserver for theme mode changes
 */
onMounted(() => {
  const currentMode = store.state.theme === "dark" ? "dark" : "light";

  // PRIORITY 1: Check if there's a temporary preview color in Vuex store (from General Settings)
  // If user is previewing a color in General Settings, apply it here too
  const hasTempPreview = currentMode === "light"
    ? !!store.state.tempThemeColors?.light
    : !!store.state.tempThemeColors?.dark;

  if (hasTempPreview) {
    // Apply temporary preview color from Vuex store (highest priority)
    // RE-READ from store instead of using customLightColor.value to ensure we get the latest
    const color = currentMode === "light"
      ? store.state.tempThemeColors!.light!
      : store.state.tempThemeColors!.dark!;

    applyThemeColors(color, currentMode, false);
  } else {
    // No temporary preview - check if user has saved a theme
    const appliedTheme = currentMode === "light" ? appliedLightTheme.value : appliedDarkTheme.value;

    if (appliedTheme === null) {
      // PRIORITY 2: No theme explicitly selected by user yet
      // Apply color from customLightColor/customDarkColor which has its own priority:
      // localStorage > org settings > defaults
      // DON'T save to localStorage automatically - let user explicitly choose
      const color = currentMode === "light" ? customLightColor.value : customDarkColor.value;

      // Determine if this is a default color or from organization settings
      const isFromOrgSettings = currentMode === "light"
        ? store.state?.organizationData?.organizationSettings?.light_mode_theme_color
        : store.state?.organizationData?.organizationSettings?.dark_mode_theme_color;

      // Mark as default only if NOT from org settings and NOT in localStorage
      const isDefault = !isFromOrgSettings &&
        !sessionStorage.getItem(`tempCustom${currentMode === 'light' ? 'Light' : 'Dark'}Color`) &&
        !localStorage.getItem(`custom${currentMode === 'light' ? 'Light' : 'Dark'}Color`);

      applyThemeColors(color, currentMode, isDefault);
    } else {
      // PRIORITY 3: User has explicitly applied a theme - reapply it
      if (appliedTheme === -1) {
        // appliedTheme === -1 means Custom theme (from color picker)
        const color = currentMode === "light" ? customLightColor.value : customDarkColor.value;
        applyThemeColors(color, currentMode, false);
      } else {
        // appliedTheme is a predefined theme ID
        const theme = predefinedThemes.find(t => t.id === appliedTheme);
        if (theme) {
          const modeColors = currentMode === "light" ? theme.light : theme.dark;
          applyThemeColors(modeColors.themeColor, currentMode, false);
        }
      }
    }
  }

  /**
   * MutationObserver to watch for body class changes (theme mode switches)
   * This handles the case when user toggles between light/dark mode
   *
   * CRITICAL FIX: This observer was the root cause of the color picker bug
   * It was checking sessionStorage (old implementation) instead of Vuex store (new implementation)
   * Now it properly checks store.state.tempThemeColors to prevent overriding preview colors
   */
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        // CRITICAL: Check if user is actively previewing a color from General Settings
        // If temp colors exist in Vuex store, skip applying to preserve the preview
        // This prevents the backend color from overriding the user's preview selection
        const hasTempColors = store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
        if (hasTempColors) {
          return;
        }

        // Reapply the current theme when mode changes (light <-> dark toggle)
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
              const modeColors = currentMode === 'light' ? theme.light : theme.dark;
              applyThemeColors(modeColors.themeColor, currentMode, false);
            }
          }
        } else {
          // No theme explicitly selected, just apply available color
          // DON'T save to localStorage - let user explicitly choose
          const color = currentMode === 'light' ? customLightColor.value : customDarkColor.value;

          const isFromOrgSettings = currentMode === "light"
            ? store.state?.organizationData?.organizationSettings?.light_mode_theme_color
            : store.state?.organizationData?.organizationSettings?.dark_mode_theme_color;

          const isDefault = !isFromOrgSettings && !sessionStorage.getItem(`tempCustom${currentMode === 'light' ? 'Light' : 'Dark'}Color`) && !localStorage.getItem(`custom${currentMode === 'light' ? 'Light' : 'Dark'}Color`);

          applyThemeColors(color, currentMode, isDefault);
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

  // Apply theme colors directly (predefined themes are never "default")
  applyThemeColors(modeColors.themeColor, mode, false);

  // Store the hex color value in localStorage (not the theme ID)
  if (mode === "light") {
    appliedLightTheme.value = theme.id;
    localStorage.setItem('appliedLightTheme', theme.id.toString());
    localStorage.setItem('customLightColor', modeColors.themeColor);
  } else {
    appliedDarkTheme.value = theme.id;
    localStorage.setItem('appliedDarkTheme', theme.id.toString());
    localStorage.setItem('customDarkColor', modeColors.themeColor);
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

/**
 * Check if custom theme is currently applied for the given mode
 * Returns false if user is actively previewing a color (to hide "Applied" badge during preview)
 * @param mode - 'light' or 'dark' theme mode
 * @returns true if custom theme is applied and not being previewed
 */
const isCustomThemeApplied = (mode: "light" | "dark"): boolean => {
  // If there are temp colors being previewed from General Settings, don't show "Applied" badge
  // This prevents confusion - the temp color is being previewed, not permanently applied
  const hasTempColors = store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
  if (hasTempColors) {
    return false;
  }

  // Check if custom theme (appliedTheme === -1) is applied for this mode
  if (mode === "light") {
    return appliedLightTheme.value === -1;
  } else {
    return appliedDarkTheme.value === -1;
  }
};

const updateCustomColor = () => {
  // Just update the preview color as user picks
  if (currentPickerMode.value === "light") {
    customLightColor.value = tempColor.value;
  } else {
    customDarkColor.value = tempColor.value;
  }
};

const applyCustomTheme = (mode: "light" | "dark") => {
  const color = mode === "light" ? customLightColor.value : customDarkColor.value;

  // Apply theme colors directly (custom theme is never default)
  applyThemeColors(color, mode, false);

  // Mark as custom theme and save to localStorage
  if (mode === "light") {
    appliedLightTheme.value = -1;
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

// Reset both light and dark themes to settings or defaults
const resetToDefaultTheme = () => {
  // Check if we have colors in organizationSettings
  const orgLightColor = store.state?.organizationData?.organizationSettings?.light_mode_theme_color;
  const orgDarkColor = store.state?.organizationData?.organizationSettings?.dark_mode_theme_color;

  // Reset light mode
  const lightResetColor = orgLightColor || DEFAULT_LIGHT_COLOR;
  customLightColor.value = lightResetColor;
  localStorage.removeItem('customLightColor');
  localStorage.removeItem('appliedLightTheme');
  appliedLightTheme.value = -1;
  localStorage.setItem('appliedLightTheme', '-1');

  // Reset dark mode
  const darkResetColor = orgDarkColor || DEFAULT_DARK_COLOR;
  customDarkColor.value = darkResetColor;
  localStorage.removeItem('customDarkColor');
  localStorage.removeItem('appliedDarkTheme');
  appliedDarkTheme.value = -1;
  localStorage.setItem('appliedDarkTheme', '-1');

  // Apply theme for current mode
  const currentMode = store.state.theme === "dark" ? "dark" : "light";
  const currentColor = currentMode === "light" ? lightResetColor : darkResetColor;
  const isDefault = currentMode === "light" ? !orgLightColor : !orgDarkColor;
  applyThemeColors(currentColor, currentMode, isDefault);

  $q.notify({
    type: 'positive',
    message: orgLightColor || orgDarkColor
      ? 'Theme reset to organization settings!'
      : 'Theme reset to default colors!',
    position: 'top',
    timeout: 2000,
  });
};
</script>

<style scoped>
.scroll-content-predefined-themes {
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
