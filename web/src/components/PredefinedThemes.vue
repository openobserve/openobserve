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
  <ODrawer
    data-test="predefined-themes-drawer"
    v-model:open="dialogOpen"
    size="sm"
    seamless
    title="Theme"
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

    <!-- Light / Dark segmented mode toggle -->
    <OCardSection class="px-2 pt-2">
      <OToggleGroup
        :model-value="activeTab"
        type="single"
        class="w-full"
        @update:model-value="(v) => (activeTab = v as string)"
      >
        <OToggleGroupItem
          data-test="predefined-themes-tab-light"
          value="light"
          icon-left="light-mode"
          class="flex-1"
          >Light</OToggleGroupItem
        >
        <OToggleGroupItem
          data-test="predefined-themes-tab-dark"
          value="dark"
          icon-left="dark-mode"
          class="flex-1"
          >Dark</OToggleGroupItem
        >
      </OToggleGroup>
    </OCardSection>

    <!-- Theme list for the active mode. Selecting a row applies it immediately;
         the applied row is highlighted rather than carrying an Apply button. -->
    <OCardSection class="max-h-[calc(100vh-100px)] overflow-y-auto px-2 py-2">
      <ul class="m-0 flex list-none flex-col gap-2 p-0">
        <li v-for="theme in predefinedThemes" :key="theme.id">
          <button
            type="button"
            :data-test="`predefined-themes-apply-btn-${mode}-${themeNameSlug(theme.name)}`"
            class="rounded-default flex w-full cursor-pointer items-center border px-3 py-2 transition-[border-color,background-color,box-shadow] duration-150 focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_40%,transparent)] focus-visible:outline-none"
            :class="
              isThemeApplied(theme, mode)
                ? 'border-accent bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-card-glass-bg))] shadow-[inset_0_0_0_1px_var(--color-accent)]'
                : 'border-card-glass-border bg-card-glass-bg hover:border-accent hover:bg-[color-mix(in_srgb,var(--color-accent)_5%,var(--color-card-glass-bg))]'
            "
            :aria-pressed="isThemeApplied(theme, mode)"
            :aria-label="`Apply ${themeDisplayName(theme.name)} theme`"
            @click="applyTheme(theme, mode)"
          >
            <span
              class="rounded-default border-card-glass-border relative h-8 w-8 shrink-0 border"
              :style="swatchStyle(theme[mode])"
            />
            <span class="ml-2 min-w-0 flex-1 text-left">
              <span class="block truncate text-sm font-medium">{{
                themeDisplayName(theme.name)
              }}</span>
              <span class="text-text-secondary block truncate text-xs">{{
                theme[mode].themeColor
              }}</span>
            </span>
            <OTag
              v-if="isThemeApplied(theme, mode)"
              :data-test="`predefined-themes-applied-badge-${mode}-${themeNameSlug(theme.name)}`"
              type="themeApplied"
              value="applied"
            />
          </button>
        </li>

        <!-- Custom Color — clicking the row opens the color picker -->
        <li>
          <button
            type="button"
            :data-test="`predefined-themes-card-${mode}-custom-color`"
            class="rounded-default flex w-full cursor-pointer items-center border border-dashed px-3 py-2 transition-[border-color,background-color,box-shadow] duration-150 focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_40%,transparent)] focus-visible:outline-none"
            :class="
              isCustomThemeApplied(mode)
                ? 'border-accent bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-card-glass-bg))] shadow-[inset_0_0_0_1px_var(--color-accent)]'
                : 'border-card-glass-border bg-card-glass-bg hover:border-accent hover:bg-[color-mix(in_srgb,var(--color-accent)_5%,var(--color-card-glass-bg))]'
            "
            :aria-pressed="isCustomThemeApplied(mode)"
            aria-label="Pick a custom theme color"
            @click="openColorPicker(mode)"
          >
            <span
              :data-test="`predefined-themes-custom-color-preview-${mode}`"
              class="rounded-default border-card-glass-border relative h-8 w-8 shrink-0 border"
              :style="{ backgroundColor: mode === 'light' ? customLightColor : customDarkColor }"
            >
              <OIcon
                name="colorize"
                size="sm"
                class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
              />
            </span>
            <span class="ml-2 min-w-0 flex-1 text-left">
              <span class="block truncate text-sm font-medium">Custom Color</span>
              <span class="text-text-secondary block truncate text-xs">
                {{
                  isCustomThemeApplied(mode)
                    ? mode === "light"
                      ? customLightColor
                      : customDarkColor
                    : "Pick any brand hex"
                }}
              </span>
            </span>
            <OTag
              v-if="isCustomThemeApplied(mode)"
              :data-test="`predefined-themes-applied-badge-${mode}-custom-color`"
              type="themeApplied"
              value="applied"
            />
          </button>
        </li>
      </ul>
    </OCardSection>

    <!-- Note at the bottom -->
    <OCardSection class="px-2 pt-0 pb-2">
      <OSeparator class="mb-2" />
      <div class="text-text-secondary flex items-start gap-1 text-xs italic">
        <OIcon name="info-outline" size="xs" class="mt-0.5" />
        <span
          >Saved to this device only — themes don't sync across different browsers or devices.</span
        >
      </div>
    </OCardSection>

    <!-- Color Picker Dialog -->
    <ODialog
      data-test="predefined-themes-color-picker-dialog"
      v-model:open="showColorPicker"
      size="sm"
      title="Pick Custom Color"
      primary-button-label="Apply"
      neutral-button-label="Cancel"
      @click:primary="confirmCustomColor"
      @click:neutral="showColorPicker = false"
    >
      <OColor v-model="tempColor" @update:model-value="updateCustomColor" />
    </ODialog>
  </ODrawer>
</template>

<script setup lang="ts">
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { usePredefinedThemes } from "@/composables/usePredefinedThemes";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OColor from "@/lib/forms/Color/OColor.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { applyThemeColors, switchThemeMode } from "@/utils/theme";
import { applyThemeForMode, applyCurrentTheme } from "@/utils/themeManager";
import {
  PREDEFINED_THEMES,
  CUSTOM_THEME_NAME,
  THEME_STORAGE_KEYS,
  getDefaultTheme,
  themeNameSlug,
  themeDisplayName,
  type PredefinedTheme,
  type ThemeModeColors,
} from "@/constants/themes";
import { toast } from "@/lib/feedback/Toast/useToast";

const store = useStore();
const { isDark } = useTheme();
const { isOpen } = usePredefinedThemes();
const dialogOpen = ref(false);
const activeTab = ref("light");

// Strongly-typed mode derived from the toggle selection — used for indexing
// theme color maps and for the mode-aware data-test/handler calls.
const mode = computed<"light" | "dark">(() => (activeTab.value === "dark" ? "dark" : "light"));

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
    store.state?.organizationData?.organizationSettings?.light_mode_theme_color ||
    DEFAULT_LIGHT_COLOR,
);
const customDarkColor = ref(
  store.state.tempThemeColors?.dark ||
    localStorage.getItem(THEME_STORAGE_KEYS.dark.color) ||
    store.state?.organizationData?.organizationSettings?.dark_mode_theme_color ||
    DEFAULT_DARK_COLOR,
);

// Color picker dialog state
const showColorPicker = ref(false); // Controls dialog visibility
const currentPickerMode = ref<"light" | "dark">("light"); // Which mode is being edited
const tempColor = ref(customLightColor.value); // Bound to the color component

/**
 * Build the swatch background for a theme mode: a 3-color diagonal gradient when
 * the theme defines semantic colors, otherwise a flat fill of the theme color.
 */
const swatchStyle = (m: ThemeModeColors) =>
  m.semanticColors
    ? {
        background: `linear-gradient(135deg, ${m.themeColor} 33%, ${m.semanticColors.error} 33% 66%, ${m.semanticColors.success} 66%)`,
      }
    : { backgroundColor: m.themeColor };

// Watch isOpen from composable
watch(isOpen, (val) => {
  dialogOpen.value = val;
  // When dialog opens, sync activeTab with current store theme
  if (val) {
    activeTab.value = isDark.value ? "dark" : "light";
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
    localStorage.setItem("theme", newTheme);
    // Update store and toggle .dark on <html> (Tailwind dark variant) inside
    // switchThemeMode so the mode flip cross-fades as one frame.
    switchThemeMode(newTheme, () => {
      store.dispatch("appTheme", newTheme);
      document.documentElement.classList.toggle("dark", newTheme === "dark");
    });
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
    const hasTempColors = store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
    if (hasTempColors) return;

    if (
      !localStorage.getItem(THEME_STORAGE_KEYS.light.color) &&
      newSettings.light_mode_theme_color
    ) {
      customLightColor.value = newSettings.light_mode_theme_color;
    }
    if (!localStorage.getItem(THEME_STORAGE_KEYS.dark.color) && newSettings.dark_mode_theme_color) {
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
      if (mutation.type === "attributes" && mutation.attributeName === "class") {
        const hasTempColors =
          store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
        if (hasTempColors) return;

        const bodyMode = document.documentElement.classList.contains("dark") ? "dark" : "light";
        applyThemeForMode(bodyMode, store);
      }
    });
  });

  observer.observe(document.documentElement, {
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
const applyTheme = (theme: PredefinedTheme, themeMode: "light" | "dark") => {
  const modeColors = themeMode === "light" ? theme.light : theme.dark;
  const keys = THEME_STORAGE_KEYS[themeMode];

  // Apply immediately (predefined themes are never "default")
  applyThemeColors(modeColors.themeColor, themeMode, false, modeColors.semanticColors);

  // Persist selection by name + refresh the render-cache
  localStorage.setItem(keys.appliedName, theme.name);
  localStorage.setItem(keys.color, modeColors.themeColor);
  if (modeColors.semanticColors) {
    localStorage.setItem(keys.semantic, JSON.stringify(modeColors.semanticColors));
  } else {
    localStorage.removeItem(keys.semantic);
  }

  if (themeMode === "light") {
    appliedLightThemeName.value = theme.name;
    customLightColor.value = modeColors.themeColor;
  } else {
    appliedDarkThemeName.value = theme.name;
    customDarkColor.value = modeColors.themeColor;
  }

  toast({
    variant: "success",
    message: `${themeDisplayName(theme.name)} applied to ${themeMode} mode successfully!`,
  });
};

const isThemeApplied = (theme: PredefinedTheme, themeMode: "light" | "dark"): boolean =>
  (themeMode === "light" ? appliedLightThemeName.value : appliedDarkThemeName.value) === theme.name;

// Custom theme functions
const openColorPicker = (themeMode: "light" | "dark") => {
  currentPickerMode.value = themeMode;
  tempColor.value = themeMode === "light" ? customLightColor.value : customDarkColor.value;
  showColorPicker.value = true;
};

/**
 * Check if the custom theme is currently applied for the given mode.
 * Returns false while a live preview from General Settings is active (so the
 * "Applied" badge doesn't appear during preview).
 */
const isCustomThemeApplied = (themeMode: "light" | "dark"): boolean => {
  const hasTempColors = store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
  if (hasTempColors) return false;

  return (
    (themeMode === "light" ? appliedLightThemeName.value : appliedDarkThemeName.value) ===
    CUSTOM_THEME_NAME
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
const applyCustomTheme = (themeMode: "light" | "dark") => {
  const color = themeMode === "light" ? customLightColor.value : customDarkColor.value;
  const keys = THEME_STORAGE_KEYS[themeMode];

  // Apply immediately (custom theme is never default)
  applyThemeColors(color, themeMode, false);

  localStorage.setItem(keys.appliedName, CUSTOM_THEME_NAME);
  localStorage.setItem(keys.color, color);
  // Custom colors have no semantic palette — clear any stale one from a prior theme
  localStorage.removeItem(keys.semantic);

  if (themeMode === "light") {
    appliedLightThemeName.value = CUSTOM_THEME_NAME;
  } else {
    appliedDarkThemeName.value = CUSTOM_THEME_NAME;
  }

  toast({
    variant: "success",
    message: `Custom color applied to ${themeMode} mode successfully!`,
  });
};

/**
 * Confirm the picked custom color: apply it to the mode being edited and close
 * the picker dialog.
 */
const confirmCustomColor = () => {
  applyCustomTheme(currentPickerMode.value);
  showColorPicker.value = false;
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

  (["light", "dark"] as const).forEach((m) => {
    const keys = THEME_STORAGE_KEYS[m];
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
