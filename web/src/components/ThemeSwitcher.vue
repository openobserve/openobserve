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
    <OIcon :name="darkMode ? 'dark-mode' : 'light-mode'" size="sm" class="size-5!" />
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

    watch(darkMode, () => {
      setTheme(darkMode.value ? "dark" : "light");
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

    const setTheme = (theme: any) => {
      try {
        localStorage.setItem("theme", theme);
      } catch (error) {
        // Handle localStorage not available
        console.warn("localStorage not available for theme storage:", error);
      }
      // Toggle .dark on <html> for the O2 component library (Tailwind dark variant)
      document.documentElement.classList.toggle('dark', theme === 'dark');
      store.dispatch("appTheme", theme);
    };

    const toggleDarkMode = () => {
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

