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
import { applyCurrentTheme } from "@/utils/themeManager";
import { migrateLegacyThemeStorage } from "@/constants/themes";
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
      // current default takes effect automatically.
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

      // One-time migration: convert the legacy id-based theme selection
      // (appliedLightTheme/appliedDarkTheme) to the name-based model.
      const THEME_NAME_MIGRATION_KEY = 'themeNameMigrationV4';
      if (!localStorage.getItem(THEME_NAME_MIGRATION_KEY)) {
        migrateLegacyThemeStorage();
        localStorage.setItem(THEME_NAME_MIGRATION_KEY, '1');
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
     * Initialize and apply theme colors for the current mode.
     * Resolution priority (highest to lowest) is handled centrally by the theme
     * manager / registry:
     *   1. Vuex tempThemeColors (live preview from General Settings)
     *   2. Selected predefined theme — resolved by NAME from the registry
     *   3. Selected custom theme — the persisted hex color
     *   4. Organization settings (backend default for the org)
     *   5. Default theme (O2 Signature) — resolved by NAME from the registry
     */
    const initializeThemeColors = () => {
      applyCurrentTheme(store);
    };

    return {
      store,
    }
  },
};
</script>
