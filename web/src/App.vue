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
    // The theme is already applied synchronously before mount by bootstrapTheme()
    // in main.ts (which also runs the legacy id→name migration). Re-applying here
    // is a no-op safety net once the store is available.
    onMounted(() => {
      initializeThemeColors();
    });

    // Watch for theme mode changes (light ↔ dark toggle) and reapply colors.
    // Resolution uses per-mode priority (preview > selected name > custom > default),
    // so switching modes always applies the correct colors for that mode.
    watch(
      () => store.state.theme,
      () => {
        initializeThemeColors();
      }
    );

    /**
     * Resolve and apply theme colors for the current mode. Priority is handled
     * centrally by the theme manager / registry:
     *   1. Vuex tempThemeColors (live preview from General Settings)
     *   2. Selected predefined theme — resolved by NAME from the registry
     *   3. Selected custom theme — the persisted hex color
     *   4. Default theme (O2 Signature) — resolved by NAME from the registry
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
