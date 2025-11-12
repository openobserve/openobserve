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
          </q-tab-panel>
        </q-tab-panels>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { usePredefinedThemes } from "@/composables/usePredefinedThemes";
import { useThemeCustomizer } from "@/composables/useThemeCustomizer";
import { useQuasar } from "quasar";
import { useStore } from "vuex";

const $q = useQuasar();
const store = useStore();
const { isOpen } = usePredefinedThemes();
const { applyTheme: applyThemeToCustomizer } = useThemeCustomizer();
const dialogOpen = ref(false);
const activeTab = ref("light");

// Track applied themes for each mode
const appliedLightTheme = ref<number | null>(null);
const appliedDarkTheme = ref<number | null>(null);

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

  // Create theme config object to pass to ThemeCustomizer
  // Only pass theme color with full opacity (10 = 1.0)
  // Backgrounds will use defaults from SCSS
  const themeConfig: any = {
    mode: mode,
    themeColor: modeColors.themeColor,
    themeColorOpacity: 10, // Always use full opacity (1.0)
  };

  // Apply theme through the ThemeCustomizer composable
  applyThemeToCustomizer(themeConfig);

  // Track which theme was applied for this mode
  if (mode === "light") {
    appliedLightTheme.value = theme.id;
  } else {
    appliedDarkTheme.value = theme.id;
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
