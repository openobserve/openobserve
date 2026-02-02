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
  <q-btn rounded flat dense :ripple="false" @click="toggleDarkMode">
    <q-icon :name="DarkModeIcon" class="header-icon"></q-icon>
    <q-tooltip anchor="top middle" self="bottom middle">
      {{ tooltipText }}
    </q-tooltip>
  </q-btn>
</template>

<script lang="ts">
import { ref, watch, onMounted, computed, defineComponent } from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import {
  outlinedDarkMode,
  outlinedLightMode,
} from "@quasar/extras/material-icons-outlined";

export default defineComponent({
  setup() {
    const store = useStore();
    const $q = useQuasar();
    const { t } = useI18n();
    const darkMode = ref(false);

    const DarkModeIcons = {
      light: outlinedLightMode,
      dark: outlinedDarkMode,
    };

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

    const DarkModeIcon = computed(() => {
      return darkMode.value ? DarkModeIcons.dark : DarkModeIcons.light;
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
      $q.dark.set(theme == "dark");
      store.dispatch("appTheme", theme);
    };

    const toggleDarkMode = () => {
      darkMode.value = !darkMode.value;
    };

    return {
      store,
      darkMode,
      DarkModeIcon,
      tooltipText,
      toggleDarkMode,
      outlinedDarkMode,
      outlinedLightMode,
    };
  },
});
</script>

<style>
.light-mode {
  background-color: #ffffff;
  color: #000000;
}

.dark-mode {
  background-color: #36383a;
  color: #ffffff;
}

.round-button {
  border: none;
  border-radius: 50%;
  box-shadow: none;
  transition: box-shadow 0.3s ease;
}

.round-button:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}
</style>