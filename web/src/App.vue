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
  <router-view
    :class="store.state.theme === 'dark' ? 'dark-theme' : 'light-theme'"
  ></router-view>
</template>

<script lang="ts">
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { onMounted, watch } from "vue";
import config from "@/aws-exports";
import { applyThemeColors } from "@/utils/theme";

export default {
  setup() {
    const store = useStore();
    const router = useRouter();
    const creds = localStorage.getItem("creds");
    if (creds) {
      router.push("/logs");
    }

    // Initialize theme colors on app mount
    // This runs once when the app loads and applies the correct theme colors
    // based on priority: tempThemeColors > localStorage > org settings > defaults
    onMounted(() => {
      initializeThemeColors();
    });

    // Watch for theme mode changes (light ↔ dark toggle)
    // When user toggles between light and dark mode, reapply the correct colors
    watch(
      () => store.state.theme,
      () => {
        // Check if user is actively previewing colors in General Settings
        // Skip reinitialization if temp colors exist to preserve the preview
        const hasTempColors = store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
        if (!hasTempColors) {
          initializeThemeColors();
        }
      }
    );

    // Watch for organization settings changes (loaded asynchronously from backend)
    // This handles the race condition where App.vue mounts before MainLayout loads org settings
    watch(
      () => store.state.organizationData?.organizationSettings,
      (newSettings) => {
        // Only reinitialize if settings actually changed (not just initial undefined -> object)
        // Check if theme colors were loaded from backend
        if (newSettings?.light_mode_theme_color || newSettings?.dark_mode_theme_color) {
          const hasTempColors = store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
          if (!hasTempColors) {
            initializeThemeColors();
          }
        }
      },
      { deep: true }
    );

    /**
     * Initialize and apply theme colors based on priority order
     * Priority (highest to lowest):
     * 1. Vuex store tempThemeColors (live preview from General Settings)
     * 2. localStorage customColor (saved by user from PredefinedThemes or General Settings)
     * 3. Organization settings (backend default for the org)
     * 4. Application defaults (from Vuex store - centralized)
     */
    const initializeThemeColors = () => {
      // Get default colors from Vuex store (centralized)
      const DEFAULT_LIGHT_COLOR = store.state.defaultThemeColors.light;
      const DEFAULT_DARK_COLOR = store.state.defaultThemeColors.dark;

      const currentMode = store.state.theme === "dark" ? "dark" : "light";

      // Light mode color priority
      const storeLight = store.state.tempThemeColors?.light;          // 1. Temp preview (highest priority)
      const localLight = localStorage.getItem('customLightColor');    // 2. Saved custom color
      const orgLight = store.state?.organizationData?.organizationSettings?.light_mode_theme_color; // 3. Org default
      const customLightColor = storeLight || localLight || orgLight || DEFAULT_LIGHT_COLOR;         // 4. App default

      // Dark mode color priority
      const storeDark = store.state.tempThemeColors?.dark;            // 1. Temp preview (highest priority)
      const localDark = localStorage.getItem('customDarkColor');      // 2. Saved custom color
      const orgDark = store.state?.organizationData?.organizationSettings?.dark_mode_theme_color;   // 3. Org default
      const customDarkColor = storeDark || localDark || orgDark || DEFAULT_DARK_COLOR;              // 4. App default

      // Check if user has explicitly applied a theme from PredefinedThemes dialog
      // appliedTheme stores the theme ID (-1 for custom, or predefined theme ID)
      const appliedLightTheme = localStorage.getItem('appliedLightTheme');
      const appliedDarkTheme = localStorage.getItem('appliedDarkTheme');
      const appliedTheme = currentMode === 'light' ? appliedLightTheme : appliedDarkTheme;

      // Check if there's a temporary preview color (from General Settings color picker)
      const hasTempPreview = currentMode === "light"
        ? !!store.state.tempThemeColors?.light
        : !!store.state.tempThemeColors?.dark;

      // Check if user has saved a custom color in localStorage (from PredefinedThemes or General Settings)
      const hasSavedColor = currentMode === 'light'
        ? !!localStorage.getItem('customLightColor')
        : !!localStorage.getItem('customDarkColor');

      if (hasTempPreview || hasSavedColor) {
        // User has either a temp preview or saved custom color - apply it
        const color = currentMode === 'light' ? customLightColor : customDarkColor;

        // Determine if this color is from org settings (backend) or custom/default
        const isFromOrgSettings = currentMode === "light"
          ? (store.state?.organizationData?.organizationSettings?.light_mode_theme_color === customLightColor)
          : (store.state?.organizationData?.organizationSettings?.dark_mode_theme_color === customDarkColor);

        const DEFAULT_LIGHT_COLOR = "#3F7994";
        const DEFAULT_DARK_COLOR = "#5B9FBE";
        const isDefaultColor = (currentMode === 'light' && color === DEFAULT_LIGHT_COLOR) ||
                               (currentMode === 'dark' && color === DEFAULT_DARK_COLOR);

        applyThemeColors(color, currentMode, isDefaultColor);
      } else {
        // No theme explicitly selected, apply available colors
        const color = currentMode === 'light' ? customLightColor : customDarkColor;
        const isFromOrgSettings = currentMode === "light"
          ? store.state?.organizationData?.organizationSettings?.light_mode_theme_color
          : store.state?.organizationData?.organizationSettings?.dark_mode_theme_color;
        const isDefault = !isFromOrgSettings && !hasTempPreview;
        applyThemeColors(color, currentMode, isDefault);
      }
    };

    return {
      store,
    }
  },
};
</script>
