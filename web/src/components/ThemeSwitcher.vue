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
  <OButton variant="ghost" size="icon-panel" data-test="navbar-theme-toggle-btn" @click="toggleDarkMode">
    <Transition name="theme-icon" mode="out-in">
      <OIcon :key="darkMode ? 'dark' : 'light'" :name="darkMode ? 'dark-mode' : 'light-mode'" size="sm" class="size-5!" />
    </Transition>
    <OTooltip side="top" align="center" :content="tooltipText" />
  </OButton>
</template>

<script lang="ts">
import { ref, watch, onMounted, computed, defineComponent } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { switchThemeMode } from "@/utils/theme";

export default defineComponent({
  components: { OButton, OIcon, OTooltip },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const darkMode = ref(false);

    onMounted(() => {
      try {
        const savedTheme = localStorage.getItem("theme");
        if (savedTheme !== null) {
          darkMode.value = savedTheme == "dark";
        } else {
          // Default to light theme if no saved theme is found
          darkMode.value = false;
        }
        setTheme(darkMode.value ? "dark" : "light");
      } catch (error) {
        // Handle localStorage not available
        console.warn("localStorage not available:", error);
        darkMode.value = false;
        setTheme("light");
      }
    });

    const tooltipText = computed(() => {
      const mode = darkMode.value ? t("common.lightMode") : t("common.darkMode");
      return `${t("common.switchTo")} ${mode}`;
    });

    // Click origin of the toggle button, consumed by the next setTheme call so
    // the circular reveal expands from the button (absent for mount/store syncs).
    let pendingOrigin: { x: number; y: number } | null = null;

    watch(darkMode, () => {
      setTheme(darkMode.value ? "dark" : "light", pendingOrigin ?? undefined);
      pendingOrigin = null;
    });

    // Watch store.state.theme for external changes
    // because we re changing theme from predefinedTheme.vue or general.vue when user changes tabs we are changing the theme
    watch(
      () => store.state.theme,
      (newTheme) => {
        const shouldBeDark = newTheme === "dark";
        if (darkMode.value !== shouldBeDark) {
          darkMode.value = shouldBeDark;
        }
      }
    );

    const setTheme = (theme: any, origin?: { x: number; y: number }) => {
      try {
        localStorage.setItem("theme", theme);
      } catch (error) {
        // Handle localStorage not available
        console.warn("localStorage not available for theme storage:", error);
      }
      // Toggle .dark on <html> for the O2 component library (Tailwind dark variant).
      // Wrapped in switchThemeMode so the mode flip animates as one frame —
      // circular reveal from `origin` when given, whole-page cross-fade otherwise.
      switchThemeMode(theme === 'dark' ? 'dark' : 'light', () => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        store.dispatch("appTheme", theme);
      }, origin);
    };

    const toggleDarkMode = (event?: MouseEvent) => {
      const el =
        event?.currentTarget instanceof HTMLElement
          ? event.currentTarget
          : event?.target instanceof HTMLElement
            ? event.target
            : null;
      if (el) {
        const rect = el.getBoundingClientRect();
        pendingOrigin = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
      darkMode.value = !darkMode.value;
    };

    return {
      store,
      darkMode,
      tooltipText,
      toggleDarkMode,
    };
  },
});
</script>

