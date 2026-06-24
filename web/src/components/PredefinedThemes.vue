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
  <ODrawer data-test="predefined-themes-drawer"
    v-model:open="dialogOpen"
    size="sm"
    seamless
    title="Predefined Themes"
  >
    <template #header-right>
      <OButton
        data-test="predefined-themes-reset-btn"
        variant="ghost-destructive"
        size="xs"
        @click="resetToDefaultTheme"
      >
        <template #icon-left><OIcon name="refresh" size="xs" /></template>
        Reset
      </OButton>
    </template>

      <OCardSection class="tw:pt-0">
        <OTabs v-model="activeTab" dense class="tw:text-gray-500" align="justify">
          <OTab data-test="predefined-themes-tab-light" name="light" label="Light Mode" />
          <OTab data-test="predefined-themes-tab-dark" name="dark" label="Dark Mode" />
        </OTabs>
      </OCardSection>

      <OCardSection class="tw:py-2 tw:px-2 scroll-content-predefined-themes">
        <OTabPanels v-model="activeTab" animated>
          <!-- Light Mode Themes -->
          <OTabPanel name="light">
            <div
              v-for="theme in predefinedThemes"
              :key="theme.id"
              :data-test="`predefined-themes-card-light-${themeNameSlug(theme.name)}`"
              class="theme-card-compact tw:mb-2"
            >
              <div class="tw:flex tw:items-center tw:flex-nowrap">
                <div
                  class="color-preview-small"
                  :style="theme.light.semanticColors
                    ? { background: `linear-gradient(135deg, ${theme.light.themeColor} 33%, ${theme.light.semanticColors.error} 33% 66%, ${theme.light.semanticColors.success} 66%)` }
                    : { backgroundColor: theme.light.themeColor }"
                ></div>
                <div class="tw:ml-2" style="flex: 1; min-width: 0">
                  <div class="tw:text-sm tw:font-medium">{{ theme.name }}</div>
                  <div class="tw:text-xs tw:text-gray-400">
                    {{ theme.light.themeColor }}
                  </div>
                </div>
                <div class="tw:flex-1" />
                <OBadge
                  v-if="isThemeApplied(theme, 'light')"
                  :data-test="`predefined-themes-applied-badge-light-${themeNameSlug(theme.name)}`"
                  variant="success"
                  size="sm"
                  class="tw:mr-1"
                >Applied</OBadge>
                <OButton
                  :data-test="`predefined-themes-apply-btn-light-${themeNameSlug(theme.name)}`"
                  variant="primary"
                  size="sm"
                  @click="applyTheme(theme, 'light')"
                >Apply</OButton>
              </div>
            </div>

            <!-- Custom Color Picker -->
            <div data-test="predefined-themes-card-light-custom-color" class="theme-card-compact tw:mb-2">
              <div class="tw:flex tw:items-center tw:flex-nowrap">
                <div
                  data-test="predefined-themes-custom-color-preview-light"
                  class="color-preview-small clickable"
                  :style="{ backgroundColor: customLightColor }"
                  @click="openColorPicker('light')"
                >
                  <OIcon
                    name="colorize"
                    size="sm"
                    style="
                      position: absolute;
                      top: 50%;
                      left: 50%;
                      transform: translate(-50%, -50%);
                    "
                  />
                </div>
                <div class="tw:ml-2" style="flex: 1; min-width: 0">
                  <div class="tw:text-sm tw:font-medium">Custom Color</div>
                  <div class="tw:text-xs tw:text-gray-400">
                    {{ customLightColor }}
                  </div>
                </div>
                <div class="tw:flex-1" />
                <OBadge
                  v-if="isCustomThemeApplied('light')"
                  data-test="predefined-themes-applied-badge-light-custom-color"
                  variant="success"
                  size="sm"
                  class="tw:mr-1"
                >Applied</OBadge>
                <OButton
                  data-test="predefined-themes-apply-btn-light-custom-color"
                  variant="primary"
                  size="sm"
                  @click="applyCustomTheme('light')"
                >Apply</OButton>
              </div>
            </div>
          </OTabPanel>

          <!-- Dark Mode Themes -->
          <OTabPanel name="dark">
            <div
              v-for="theme in predefinedThemes"
              :key="theme.id"
              :data-test="`predefined-themes-card-dark-${themeNameSlug(theme.name)}`"
              class="theme-card-compact tw:mb-2"
            >
              <div class="tw:flex tw:items-center tw:flex-nowrap">
                <div
                  class="color-preview-small"
                  :style="theme.dark.semanticColors
                    ? { background: `linear-gradient(135deg, ${theme.dark.themeColor} 33%, ${theme.dark.semanticColors.error} 33% 66%, ${theme.dark.semanticColors.success} 66%)` }
                    : { backgroundColor: theme.dark.themeColor }"
                ></div>
                <div class="tw:ml-2" style="flex: 1; min-width: 0">
                  <div class="tw:text-sm tw:font-medium">{{ theme.name }}</div>
                  <div class="tw:text-xs tw:text-gray-400">
                    {{ theme.dark.themeColor }}
                  </div>
                </div>
                <div class="tw:flex-1" />
                <OBadge
                  v-if="isThemeApplied(theme, 'dark')"
                  :data-test="`predefined-themes-applied-badge-dark-${themeNameSlug(theme.name)}`"
                  variant="success"
                  size="sm"
                  class="tw:mr-1"
                >Applied</OBadge>
                <OButton
                  :data-test="`predefined-themes-apply-btn-dark-${themeNameSlug(theme.name)}`"
                  variant="primary"
                  size="sm"
                  @click="applyTheme(theme, 'dark')"
                >Apply</OButton>
              </div>
            </div>

            <!-- Custom Color Picker -->
            <div data-test="predefined-themes-card-dark-custom-color" class="theme-card-compact tw:mb-2">
              <div class="tw:flex tw:items-center tw:flex-nowrap">
                <div
                  data-test="predefined-themes-custom-color-preview-dark"
                  class="color-preview-small clickable"
                  :style="{ backgroundColor: customDarkColor }"
                  @click="openColorPicker('dark')"
                >
                  <OIcon
                    name="colorize"
                    size="sm"
                    style="
                      position: absolute;
                      top: 50%;
                      left: 50%;
                      transform: translate(-50%, -50%);
                    "
                  />
                </div>
                <div class="tw:ml-2" style="flex: 1; min-width: 0">
                  <div class="tw:text-sm tw:font-medium">Custom Color</div>
                  <div class="tw:text-xs tw:text-gray-400">
                    {{ customDarkColor }}
                  </div>
                </div>
                <div class="tw:flex-1" />
                <OBadge
                  v-if="isCustomThemeApplied('dark')"
                  data-test="predefined-themes-applied-badge-dark-custom-color"
                  variant="success"
                  size="sm"
                  class="tw:mr-1"
                >Applied</OBadge>
                <OButton
                  data-test="predefined-themes-apply-btn-dark-custom-color"
                  variant="primary"
                  size="sm"
                  @click="applyCustomTheme('dark')"
                >Apply</OButton>
              </div>
            </div>
          </OTabPanel>
        </OTabPanels>
      </OCardSection>

      <!-- Note at the bottom -->
      <OCardSection class="tw:pt-0 tw:pb-2">
        <OSeparator class="tw:mb-2" />
        <div
          class="tw:text-xs tw:text-gray-400 tw:flex tw:items-start tw:gap-1"
        >
          <OIcon name="info-outline" size="xs" class="tw:mt-1" />
          <span
            >Theme preferences are stored locally on this device and will not
            sync across different browsers or devices.</span
          >
        </div>
      </OCardSection>

    <!-- Color Picker Dialog -->
    <ODialog data-test="predefined-themes-color-picker-dialog"
      v-model:open="showColorPicker"
      size="sm"
      title="Pick Custom Color"
      primary-button-label="Close"
      @click:primary="showColorPicker = false"
    >
      <OColor
        v-model="tempColor"
        @update:model-value="updateCustomColor"
      />
    </ODialog>
  </ODrawer>
</template>

<script setup lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import { ref, watch, onMounted, onUnmounted } from "vue";
import { usePredefinedThemes } from "@/composables/usePredefinedThemes";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OColor from "@/lib/forms/Color/OColor.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import { useStore } from "vuex";
import { applyThemeColors } from "@/utils/theme";
import { applyThemeForMode, applyCurrentTheme } from "@/utils/themeManager";
import {
  PREDEFINED_THEMES,
  CUSTOM_THEME_NAME,
  THEME_STORAGE_KEYS,
  getDefaultTheme,
  themeNameSlug,
  type PredefinedTheme,
} from "@/constants/themes";
import { toast } from "@/lib/feedback/Toast/useToast";

const store = useStore();
const { isOpen } = usePredefinedThemes();
const dialogOpen = ref(false);
const activeTab = ref("light");

// Predefined themes list (used by the template) — sourced from the shared registry.
const predefinedThemes = PREDEFINED_THEMES;

// Default colors come from the registry default theme (O2 Signature).
const DEFAULT_LIGHT_COLOR = getDefaultTheme().light.themeColor;
const DEFAULT_DARK_COLOR = getDefaultTheme().dark.themeColor;

// Track the SELECTED theme by NAME for each mode.
// Holds a predefined theme name, CUSTOM_THEME_NAME for a custom color, or null
// when nothing has been explicitly selected (resolution falls back to default).
const appliedLightThemeName = ref<string | null>(
  localStorage.getItem(THEME_STORAGE_KEYS.light.appliedName),
);
const appliedDarkThemeName = ref<string | null>(
  localStorage.getItem(THEME_STORAGE_KEYS.dark.appliedName),
);

// Custom color state for the color picker in the PredefinedThemes dialog.
// Source of truth for the custom theme; for other themes it is a render-cache.
// Priority order (highest to lowest):
// 1. Vuex store tempThemeColors (live preview from General Settings)
// 2. localStorage custom color (saved color cache)
// 3. Organization settings (backend default for the organization)
// 4. Default theme color (O2 Signature)
const customLightColor = ref(
  store.state.tempThemeColors?.light ||
    localStorage.getItem(THEME_STORAGE_KEYS.light.color) ||
    store.state?.organizationData?.organizationSettings
      ?.light_mode_theme_color ||
    DEFAULT_LIGHT_COLOR,
);
const customDarkColor = ref(
  store.state.tempThemeColors?.dark ||
    localStorage.getItem(THEME_STORAGE_KEYS.dark.color) ||
    store.state?.organizationData?.organizationSettings
      ?.dark_mode_theme_color ||
    DEFAULT_DARK_COLOR,
);

// Color picker dialog state
const showColorPicker = ref(false); // Controls dialog visibility
const currentPickerMode = ref<"light" | "dark">("light"); // Which mode is being edited
const tempColor = ref(customLightColor.value); // Bound to q-color component

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
    // Toggle .dark on <html> for the O2 component library (Tailwind dark variant)
    document.documentElement.classList.toggle("dark", newTheme === "dark");
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
  },
);

// Watch for organization settings changes (loaded after init or updated by an admin).
// Refresh the custom-color chips when the user has no saved custom color, then
// re-resolve and apply the effective theme (which respects the existing priority).
watch(
  () => store.state?.organizationData?.organizationSettings,
  (newSettings, oldSettings) => {
    if (!newSettings || newSettings === oldSettings) return;

    // Don't override a live preview coming from General Settings.
    const hasTempColors =
      store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
    if (hasTempColors) return;

    if (
      !localStorage.getItem(THEME_STORAGE_KEYS.light.color) &&
      newSettings.light_mode_theme_color
    ) {
      customLightColor.value = newSettings.light_mode_theme_color;
    }
    if (
      !localStorage.getItem(THEME_STORAGE_KEYS.dark.color) &&
      newSettings.dark_mode_theme_color
    ) {
      customDarkColor.value = newSettings.dark_mode_theme_color;
    }

    applyCurrentTheme(store);
  },
  { deep: true },
);

// MutationObserver for watching body class changes (theme mode switches)
// This will be initialized in onMounted and cleaned up in onUnmounted
let observer: MutationObserver | null = null;

/**
 * Component mounted lifecycle hook.
 * Applies the resolved theme for the current mode and watches body class changes
 * (light <-> dark toggle) to reapply the correct colors.
 */
onMounted(() => {
  // Resolve & apply the effective theme for the current mode (preview > selected
  // name > custom color > org settings > default), handled by the theme manager.
  applyCurrentTheme(store);

  // Reapply the resolved theme whenever the body theme-mode class toggles,
  // unless a live preview from General Settings is active.
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "class"
      ) {
        const hasTempColors =
          store.state.tempThemeColors?.light ||
          store.state.tempThemeColors?.dark;
        if (hasTempColors) return;

        const mode = document.body.classList.contains("body--dark")
          ? "dark"
          : "light";
        applyThemeForMode(mode, store);
      }
    });
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
});

onUnmounted(() => {
  if (observer) {
    observer.disconnect();
  }
});

/**
 * Apply a predefined theme to a mode.
 * The SELECTION is persisted by name; the resolved color + semantic colors are
 * also cached so direct localStorage readers (charts) stay in sync. Because the
 * selection is stored by name, a future release that changes this theme's colors
 * will automatically apply on next load.
 */
const applyTheme = (theme: PredefinedTheme, mode: "light" | "dark") => {
  const modeColors = mode === "light" ? theme.light : theme.dark;
  const keys = THEME_STORAGE_KEYS[mode];

  // Apply immediately (predefined themes are never "default")
  applyThemeColors(modeColors.themeColor, mode, false, modeColors.semanticColors);

  // Persist selection by name + refresh the render-cache
  localStorage.setItem(keys.appliedName, theme.name);
  localStorage.setItem(keys.color, modeColors.themeColor);
  if (modeColors.semanticColors) {
    localStorage.setItem(keys.semantic, JSON.stringify(modeColors.semanticColors));
  } else {
    localStorage.removeItem(keys.semantic);
  }

  if (mode === "light") {
    appliedLightThemeName.value = theme.name;
    customLightColor.value = modeColors.themeColor;
  } else {
    appliedDarkThemeName.value = theme.name;
    customDarkColor.value = modeColors.themeColor;
  }

  toast({
    variant: "success",
    message: `${theme.name} applied to ${mode} mode successfully!`,
  });
};

const isThemeApplied = (
  theme: PredefinedTheme,
  mode: "light" | "dark",
): boolean =>
  (mode === "light" ? appliedLightThemeName.value : appliedDarkThemeName.value) ===
  theme.name;

// Custom theme functions
const openColorPicker = (mode: "light" | "dark") => {
  currentPickerMode.value = mode;
  tempColor.value =
    mode === "light" ? customLightColor.value : customDarkColor.value;
  showColorPicker.value = true;
};

/**
 * Check if the custom theme is currently applied for the given mode.
 * Returns false while a live preview from General Settings is active (so the
 * "Applied" badge doesn't appear during preview).
 */
const isCustomThemeApplied = (mode: "light" | "dark"): boolean => {
  const hasTempColors =
    store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
  if (hasTempColors) return false;

  return (
    (mode === "light"
      ? appliedLightThemeName.value
      : appliedDarkThemeName.value) === CUSTOM_THEME_NAME
  );
};

const updateCustomColor = () => {
  // Just update the preview color as user picks
  if (currentPickerMode.value === "light") {
    customLightColor.value = tempColor.value;
  } else {
    customDarkColor.value = tempColor.value;
  }
};

/**
 * Apply a custom color to a mode. Custom themes are persisted by COLOR (the hex
 * is the source of truth), marked with CUSTOM_THEME_NAME.
 */
const applyCustomTheme = (mode: "light" | "dark") => {
  const color =
    mode === "light" ? customLightColor.value : customDarkColor.value;
  const keys = THEME_STORAGE_KEYS[mode];

  // Apply immediately (custom theme is never default)
  applyThemeColors(color, mode, false);

  localStorage.setItem(keys.appliedName, CUSTOM_THEME_NAME);
  localStorage.setItem(keys.color, color);
  // Custom colors have no semantic palette — clear any stale one from a prior theme
  localStorage.removeItem(keys.semantic);

  if (mode === "light") {
    appliedLightThemeName.value = CUSTOM_THEME_NAME;
  } else {
    appliedDarkThemeName.value = CUSTOM_THEME_NAME;
  }

  toast({
    variant: "success",
    message: `Custom color applied to ${mode} mode successfully!`,
  });
};

/**
 * Reset both modes by clearing the explicit selection + caches, so resolution
 * falls back to organization settings (if configured) or the default theme
 * (O2 Signature).
 */
const resetToDefaultTheme = () => {
  const org = store.state?.organizationData?.organizationSettings;
  const orgLightColor = org?.light_mode_theme_color;
  const orgDarkColor = org?.dark_mode_theme_color;

  (["light", "dark"] as const).forEach((mode) => {
    const keys = THEME_STORAGE_KEYS[mode];
    localStorage.removeItem(keys.appliedName);
    localStorage.removeItem(keys.color);
    localStorage.removeItem(keys.semantic);
  });
  appliedLightThemeName.value = null;
  appliedDarkThemeName.value = null;

  // Update the custom-color chips to reflect the reset target
  customLightColor.value = orgLightColor || DEFAULT_LIGHT_COLOR;
  customDarkColor.value = orgDarkColor || DEFAULT_DARK_COLOR;

  // Re-resolve & apply the effective theme for the current mode
  applyCurrentTheme(store);

  toast({
    variant: "success",
    message:
      orgLightColor || orgDarkColor
        ? "Theme reset to organization settings!"
        : "Theme reset to default colors!",
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
.predefined-theme-card {
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
