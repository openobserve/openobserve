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
  <router-view
    :class="store.state.theme === 'dark' ? 'dark-theme' : 'light-theme'"
  ></router-view>
  <OToastProvider />
  <ConfirmDialogProvider />
</template>

<script lang="ts">
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { onMounted, watch } from "vue";
import config from "@/aws-exports";
import { applyThemeColors, type SemanticColors } from "@/utils/theme";
import OToastProvider from "@/lib/feedback/Toast/OToastProvider.vue";
import ConfirmDialogProvider from "@/components/ConfirmDialogProvider.vue";

export default {
  components: { OToastProvider, ConfirmDialogProvider },
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
      // One-time migration: clear saved colors that were old defaults so the
      // current default (#3F7994 light / #79a1b4 dark) takes effect automatically.
      const THEME_MIGRATION_KEY = 'themeMigrationV3';
      if (!localStorage.getItem(THEME_MIGRATION_KEY)) {
        const OLD_LIGHT_DEFAULTS = ['#1a8a7a', '#6B76E3', '#5B9FBE'];
        const OLD_DARK_DEFAULTS  = ['#3ab9aa', '#818CF8', '#5B9FBE'];
        const savedLight = localStorage.getItem('customLightColor');
        const savedDark  = localStorage.getItem('customDarkColor');
        if (savedLight && OLD_LIGHT_DEFAULTS.map(c => c.toLowerCase()).includes(savedLight.toLowerCase())) {
          localStorage.removeItem('customLightColor');
          localStorage.removeItem('appliedLightTheme');
        }
        if (savedDark && OLD_DARK_DEFAULTS.map(c => c.toLowerCase()).includes(savedDark.toLowerCase())) {
          localStorage.removeItem('customDarkColor');
          localStorage.removeItem('appliedDarkTheme');
        }
        localStorage.setItem(THEME_MIGRATION_KEY, '1');
      }
      initializeThemeColors();
    });

    // Watch for theme mode changes (light ↔ dark toggle)
    // When user toggles between light and dark mode, reapply the correct colors
    // NOTE: Always call initializeThemeColors() here regardless of temp colors.
    // initializeThemeColors() uses per-mode priority logic:
    //   tempThemeColors[currentMode] > localStorage > org settings > defaults
    // So if the user previewed dark mode colors but switches to light mode,
    // initializeThemeColors() will correctly apply the light mode colors (not the dark preview).
    // Skipping it would leave stale CSS variables and body classes from the preview.
    watch(
      () => store.state.theme,
      () => {
        initializeThemeColors();
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

      // Load persisted semantic colors for the current mode
      const semanticColorsRaw = currentMode === 'light'
        ? localStorage.getItem('lightSemanticColors')
        : localStorage.getItem('darkSemanticColors');
      const semanticColors: SemanticColors | undefined = semanticColorsRaw
        ? JSON.parse(semanticColorsRaw)
        : undefined;

      if (hasTempPreview || hasSavedColor) {
        // User has either a temp preview or saved custom color - apply it
        const color = currentMode === 'light' ? customLightColor : customDarkColor;

        const isDefaultColor = (currentMode === 'light' && color === DEFAULT_LIGHT_COLOR) ||
                               (currentMode === 'dark' && color === DEFAULT_DARK_COLOR);

        applyThemeColors(color, currentMode, isDefaultColor, semanticColors);
      } else {
        // No theme explicitly selected, apply available colors
        const color = currentMode === 'light' ? customLightColor : customDarkColor;
        const isDefault = !hasTempPreview && (
          color === (currentMode === 'light' ? DEFAULT_LIGHT_COLOR : DEFAULT_DARK_COLOR)
        );
        applyThemeColors(color, currentMode, isDefault, semanticColors);
      }
    };

    return {
      store,
    }
  },
};
</script>
