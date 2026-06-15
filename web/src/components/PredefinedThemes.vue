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
import { hexToRgba, applyThemeColors, type SemanticColors } from "@/utils/theme";
import { toast } from "@/lib/feedback/Toast/useToast";

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
  localStorage.getItem("appliedLightTheme")
    ? parseInt(localStorage.getItem("appliedLightTheme")!)
    : null,
);
const appliedDarkTheme = ref<number | null>(
  localStorage.getItem("appliedDarkTheme")
    ? parseInt(localStorage.getItem("appliedDarkTheme")!)
    : null,
);

// Custom color state for the color picker in PredefinedThemes dialog
// Priority order (highest to lowest):
// 1. Vuex store tempThemeColors (live preview from General Settings - highest priority)
// 2. localStorage customColor (permanently saved custom color)
// 3. Organization settings (backend default for the organization)
// 4. Application defaults (#3F7994 for light, #5B9FBE for dark)
const customLightColor = ref(
  store.state.tempThemeColors?.light ||
    localStorage.getItem("customLightColor") ||
    store.state?.organizationData?.organizationSettings
      ?.light_mode_theme_color ||
    DEFAULT_LIGHT_COLOR,
);
const customDarkColor = ref(
  store.state.tempThemeColors?.dark ||
    localStorage.getItem("customDarkColor") ||
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

// Watch for organization settings changes and update custom colors
// This watcher handles the case where organizationSettings load AFTER component initialization
// or when admin updates organization settings while PredefinedThemes dialog is open
watch(
  () => store.state?.organizationData?.organizationSettings,
  (newSettings, oldSettings) => {
    if (newSettings && newSettings !== oldSettings) {
      // IMPORTANT: Don't override if user is actively previewing a color from General Settings
      // If temp colors exist in Vuex store, skip update to preserve the preview
      const hasTempColors =
        store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
      if (hasTempColors) {
        return;
      }

      const currentMode = store.state.theme === "dark" ? "dark" : "light";
      let shouldApply = false;

      // Only update if localStorage doesn't have custom colors
      if (
        !localStorage.getItem("customLightColor") &&
        newSettings.light_mode_theme_color
      ) {
        customLightColor.value = newSettings.light_mode_theme_color;
        if (currentMode === "light" && appliedLightTheme.value === -1) {
          shouldApply = true;
        }
      }
      if (
        !localStorage.getItem("customDarkColor") &&
        newSettings.dark_mode_theme_color
      ) {
        customDarkColor.value = newSettings.dark_mode_theme_color;
        if (currentMode === "dark" && appliedDarkTheme.value === -1) {
          shouldApply = true;
        }
      }

      // Apply theme if custom theme is active and we updated the color
      if (shouldApply) {
        const color =
          currentMode === "light"
            ? customLightColor.value
            : customDarkColor.value;
        applyThemeColors(color, currentMode, false);
      }
    }
  },
  { deep: true },
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
  const hasTempPreview =
    currentMode === "light"
      ? !!store.state.tempThemeColors?.light
      : !!store.state.tempThemeColors?.dark;

  if (hasTempPreview) {
    // Apply temporary preview color from Vuex store (highest priority)
    // RE-READ from store instead of using customLightColor.value to ensure we get the latest
    const color =
      currentMode === "light"
        ? store.state.tempThemeColors!.light!
        : store.state.tempThemeColors!.dark!;

    applyThemeColors(color, currentMode, false);
  } else {
    // No temporary preview - check if user has saved a theme
    const appliedTheme =
      currentMode === "light"
        ? appliedLightTheme.value
        : appliedDarkTheme.value;

    if (appliedTheme === null) {
      // PRIORITY 2: No theme explicitly selected by user yet
      // Apply color from customLightColor/customDarkColor which has its own priority:
      // localStorage > org settings > defaults
      // DON'T save to localStorage automatically - let user explicitly choose
      const color =
        currentMode === "light"
          ? customLightColor.value
          : customDarkColor.value;

      // Determine if this is a default color or from organization settings
      const isFromOrgSettings =
        currentMode === "light"
          ? store.state?.organizationData?.organizationSettings
              ?.light_mode_theme_color
          : store.state?.organizationData?.organizationSettings
              ?.dark_mode_theme_color;

      // Mark as default only if NOT from org settings and NOT in localStorage
      const isDefault =
        !isFromOrgSettings &&
        !sessionStorage.getItem(
          `tempCustom${currentMode === "light" ? "Light" : "Dark"}Color`,
        ) &&
        !localStorage.getItem(
          `custom${currentMode === "light" ? "Light" : "Dark"}Color`,
        );

      applyThemeColors(color, currentMode, isDefault);
    } else {
      // PRIORITY 3: User has explicitly applied a theme - reapply it
      if (appliedTheme === -1) {
        // appliedTheme === -1 means Custom theme (from color picker)
        const color =
          currentMode === "light"
            ? customLightColor.value
            : customDarkColor.value;
        applyThemeColors(color, currentMode, false);
      } else {
        // appliedTheme is a predefined theme ID
        const theme = predefinedThemes.find((t) => t.id === appliedTheme);
        if (theme) {
          const modeColors = currentMode === "light" ? theme.light : theme.dark;
          applyThemeColors(modeColors.themeColor, currentMode, false, modeColors.semanticColors as SemanticColors | undefined);
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
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "class"
      ) {
        // CRITICAL: Check if user is actively previewing a color from General Settings
        // If temp colors exist in Vuex store, skip applying to preserve the preview
        // This prevents the backend color from overriding the user's preview selection
        const hasTempColors =
          store.state.tempThemeColors?.light ||
          store.state.tempThemeColors?.dark;
        if (hasTempColors) {
          return;
        }

        // Reapply the current theme when mode changes (light <-> dark toggle)
        const isDarkMode = document.body.classList.contains("body--dark");
        const currentMode = isDarkMode ? "dark" : "light";

        // Get the applied theme for the current mode
        const appliedTheme =
          currentMode === "light"
            ? appliedLightTheme.value
            : appliedDarkTheme.value;

        if (appliedTheme !== null) {
          // Theme exists for this mode, apply it
          if (appliedTheme === -1) {
            // Custom theme
            const color =
              currentMode === "light"
                ? customLightColor.value
                : customDarkColor.value;
            applyThemeColors(color, currentMode, false);
          } else {
            // Predefined theme
            const theme = predefinedThemes.find((t) => t.id === appliedTheme);
            if (theme) {
              const modeColors =
                currentMode === "light" ? theme.light : theme.dark;
              applyThemeColors(modeColors.themeColor, currentMode, false, modeColors.semanticColors as SemanticColors | undefined);
            }
          }
        } else {
          // No theme explicitly selected, just apply available color
          // DON'T save to localStorage - let user explicitly choose
          const color =
            currentMode === "light"
              ? customLightColor.value
              : customDarkColor.value;

          const isFromOrgSettings =
            currentMode === "light"
              ? store.state?.organizationData?.organizationSettings
                  ?.light_mode_theme_color
              : store.state?.organizationData?.organizationSettings
                  ?.dark_mode_theme_color;

          const isDefault =
            !isFromOrgSettings &&
            !sessionStorage.getItem(
              `tempCustom${currentMode === "light" ? "Light" : "Dark"}Color`,
            ) &&
            !localStorage.getItem(
              `custom${currentMode === "light" ? "Light" : "Dark"}Color`,
            );

          applyThemeColors(color, currentMode, isDefault);
        }
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
    id: 10,
    name: "O2 Signature",
    light: {
      themeColor: "#6B76E3",
      themeColorOpacity: 10,
    },
    dark: {
      themeColor: "#8B8DF0",
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
  },
  {
    id: 14,
    name: "O2 Crimson Ink",
    light: {
      themeColor: "#E11D48",
      themeColorOpacity: 10,
      semanticColors: {
        error: "#F97316",
        errorBg: "#FFF7ED",
        errorText: "#C2410C",
        success: "#6366F1",
        successBg: "#EEF2FF",
        successText: "#3730A3",
        secondaryBtnBg: "#FFE4E6",
        secondaryBtnText: "#BE123C",
        secondaryBtnBorder: "#FECDD3",
        outlineText: "#BE123C",
        outlineBorder: "#FECDD3",
        ghostText: "#BE123C",
      },
    },
    dark: {
      themeColor: "#FB7185",
      themeColorOpacity: 10,
      semanticColors: {
        error: "#FB923C",
        errorBg: "#3A1A08",
        errorText: "#FB923C",
        success: "#818CF8",
        successBg: "#1E1B4B",
        successText: "#A5B4FC",
        secondaryBtnBg: "#3D0617",
        secondaryBtnText: "#FECDD3",
        secondaryBtnBorder: "#9F1239",
        outlineText: "#FECDD3",
        outlineBorder: "#9F1239",
        ghostText: "#FECDD3",
      },
    },
  },
];

// Slugify a theme name into a kebab-case identifier for data-test attributes
// e.g. "Ocean Breeze" -> "ocean-breeze"
const themeNameSlug = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, "-");

const applyTheme = (theme: any, mode: "light" | "dark") => {
  const modeColors = mode === "light" ? theme.light : theme.dark;

  // Apply theme colors directly (predefined themes are never "default")
  applyThemeColors(modeColors.themeColor, mode, false, modeColors.semanticColors as SemanticColors | undefined);

  // Store the hex color value in localStorage (not the theme ID)
  if (mode === "light") {
    appliedLightTheme.value = theme.id;
    localStorage.setItem("appliedLightTheme", theme.id.toString());
    localStorage.setItem("customLightColor", modeColors.themeColor);
    if (modeColors.semanticColors) {
      localStorage.setItem("lightSemanticColors", JSON.stringify(modeColors.semanticColors));
    } else {
      localStorage.removeItem("lightSemanticColors");
    }
  } else {
    appliedDarkTheme.value = theme.id;
    localStorage.setItem("appliedDarkTheme", theme.id.toString());
    localStorage.setItem("customDarkColor", modeColors.themeColor);
    if (modeColors.semanticColors) {
      localStorage.setItem("darkSemanticColors", JSON.stringify(modeColors.semanticColors));
    } else {
      localStorage.removeItem("darkSemanticColors");
    }
  }

  // Show success notification
  toast({
    variant: "success",
    message: `${theme.name} applied to ${mode} mode successfully!`,
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
  tempColor.value =
    mode === "light" ? customLightColor.value : customDarkColor.value;
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
  const hasTempColors =
    store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
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
  const color =
    mode === "light" ? customLightColor.value : customDarkColor.value;

  // Apply theme colors directly (custom theme is never default)
  applyThemeColors(color, mode, false);

  // Mark as custom theme and save to localStorage
  if (mode === "light") {
    appliedLightTheme.value = -1;
    localStorage.setItem("appliedLightTheme", "-1");
    localStorage.setItem("customLightColor", color);
  } else {
    appliedDarkTheme.value = -1;
    localStorage.setItem("appliedDarkTheme", "-1");
    localStorage.setItem("customDarkColor", color);
  }

  // Show success notification
  toast({
    variant: "success",
    message: `Custom color applied to ${mode} mode successfully!`,
  });
};

// Reset both light and dark themes to settings or defaults
const resetToDefaultTheme = () => {
  // Check if we have colors in organizationSettings
  const orgLightColor =
    store.state?.organizationData?.organizationSettings?.light_mode_theme_color;
  const orgDarkColor =
    store.state?.organizationData?.organizationSettings?.dark_mode_theme_color;

  // Reset light mode
  const lightResetColor = orgLightColor || DEFAULT_LIGHT_COLOR;
  customLightColor.value = lightResetColor;
  localStorage.removeItem("customLightColor");
  localStorage.removeItem("appliedLightTheme");
  localStorage.removeItem("lightSemanticColors");
  appliedLightTheme.value = -1;
  localStorage.setItem("appliedLightTheme", "-1");

  // Reset dark mode
  const darkResetColor = orgDarkColor || DEFAULT_DARK_COLOR;
  customDarkColor.value = darkResetColor;
  localStorage.removeItem("customDarkColor");
  localStorage.removeItem("appliedDarkTheme");
  localStorage.removeItem("darkSemanticColors");
  appliedDarkTheme.value = -1;
  localStorage.setItem("appliedDarkTheme", "-1");

  // Apply theme for current mode
  const currentMode = store.state.theme === "dark" ? "dark" : "light";
  const currentColor =
    currentMode === "light" ? lightResetColor : darkResetColor;
  const isDefault = currentMode === "light" ? !orgLightColor : !orgDarkColor;
  applyThemeColors(currentColor, currentMode, isDefault);

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
