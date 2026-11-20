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
  <!-- Menu row, like Language: label left, Light / Dark / System on the right. Clicking a segment picks it;
       Enter on the row steps to the next one. The menu stays open so the switch is visible. -->
  <ODropdownItem
    v-if="menuItem"
    data-test="navbar-theme-toggle-btn"
    :aria-label="`${t('dashboard.kiosk.theme')}: ${preferenceLabel(preference)}`"
    @select="onMenuSelect"
  >
    <template #icon-left>
      <OIcon size="xs" :name="preferenceIcon(preference)" class="padding-none" />
    </template>
    <span class="flex-1 whitespace-nowrap">{{ t("dashboard.kiosk.theme") }}</span>
    <span
      class="bg-toggle-track-bg rounded-default inline-flex items-center gap-0.5 p-0.5"
      aria-hidden="true"
    >
      <span
        v-for="option in PREFERENCES"
        :key="option"
        :title="preferenceLabel(option)"
        :data-test="`theme-option-${option}`"
        class="rounded-default inline-flex size-5 cursor-pointer items-center justify-center"
        :class="
          option === preference
            ? 'bg-toggle-item-active-bg text-selected-fg'
            : 'text-text-secondary hover:text-text-body'
        "
        @click="pickSegment(option)"
      >
        <OIcon size="xs" :name="preferenceIcon(option)" />
      </span>
    </span>
  </ODropdownItem>
  <OButton
    v-else
    :variant="bordered ? 'outline' : 'ghost'"
    :size="bordered ? 'icon-sm' : 'icon-toolbar'"
    data-test="navbar-theme-toggle-btn"
    :aria-label="raw(tooltipText)"
    @click="toggleDarkMode"
  >
    <Transition name="theme-icon" mode="out-in">
      <OIcon
        :key="darkMode ? 'dark' : 'light'"
        :name="darkMode ? 'dark-mode' : 'light-mode'"
        size="sm"
      />
    </Transition>
    <OTooltip side="top" align="center" :content="raw(tooltipText)" />
  </OButton>
</template>

<script lang="ts">
import { ref, watch, onMounted, computed, defineComponent } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { switchThemeMode } from "@/utils/theme";
import {
  getThemePreference,
  resolveThemeMode,
  setThemePreference,
  type ThemePreference,
} from "@/utils/themePreference";

const PREFERENCES: ThemePreference[] = ["light", "dark", "system"];

export default defineComponent({
  components: { OButton, OIcon, OTooltip, ODropdownItem },
  props: {
    // Outlined 32px square, for headers whose other controls are outlined buttons.
    bordered: { type: Boolean, default: false },
    // A row in a menu (the profile menu): mounts on open, so it reads the current theme instead of re-applying it.
    menuItem: { type: Boolean, default: false },
  },
  setup(props) {
    const store = useStore();
    const { t } = useI18nTyped();
    // eslint-disable-next-line no-restricted-syntax -- this component IS the theme seam's UI: darkMode is the toggle's own bound state, not a private copy of the app theme it should be reading from useTheme().
    const darkMode = ref(props.menuItem ? store.state.theme === "dark" : false);

    onMounted(() => {
      if (props.menuItem) return;
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

    // Whole sentence per target theme: "Switch to" + mode glued two translated
    // fragments together, which breaks wherever the word order differs.
    const tooltipText = computed(() =>
      darkMode.value ? t("common.switchToLightMode") : t("common.switchToDarkMode"),
    );

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
      },
    );

    const setTheme = (theme: any) => {
      try {
        // A kiosk ?theme= is for that screen only and must not become the saved preference.
        if (!store.state.themeOverride) localStorage.setItem("theme", theme);
      } catch (error) {
        // Handle localStorage not available
        console.warn("localStorage not available for theme storage:", error);
      }
      // Toggle .dark on <html> for the O2 component library (Tailwind dark variant).
      // Wrapped in switchThemeMode so the mode flip animates as one frame
      // (soft curtain sweep, defined in styles/tailwind.css).
      // `darkMode` is the component's source of truth and is always set to
      // match `theme` before setTheme runs, so the html-class toggle reads it
      // directly rather than re-deriving the boolean from the string arg.
      switchThemeMode(theme, () => {
        document.documentElement.classList.toggle("dark", darkMode.value);
        store.dispatch("appTheme", theme);
      });
    };

    // The standalone button picks an explicit mode, which ends "follow the system".
    const toggleDarkMode = () => {
      darkMode.value = !darkMode.value;
      setThemePreference(darkMode.value ? "dark" : "light");
    };
    const preference = ref<ThemePreference>(getThemePreference());
    let segmentPick: ThemePreference | null = null;
    const pickSegment = (p: ThemePreference) => {
      segmentPick = p;
    };
    const preferenceLabel = (p: ThemePreference) =>
      p === "system"
        ? t("settings.systemTheme")
        : p === "dark"
          ? t("settings.dark")
          : t("settings.light");
    const preferenceIcon = (p: ThemePreference) =>
      p === "system" ? "computer" : p === "dark" ? "dark-mode" : "light-mode";

    const applyPreference = (p: ThemePreference) => {
      setThemePreference(p);
      preference.value = p;
      darkMode.value = resolveThemeMode(p) === "dark";
    };

    // A segment click lands before the row's select, so the row knows which one was picked.
    const onMenuSelect = (event: Event) => {
      event.preventDefault();
      const next =
        segmentPick ?? PREFERENCES[(PREFERENCES.indexOf(preference.value) + 1) % PREFERENCES.length];
      segmentPick = null;
      applyPreference(next);
    };

    return {
      raw,
      store,
      darkMode,
      tooltipText,
      toggleDarkMode,
      onMenuSelect,
      preference,
      preferenceLabel,
      preferenceIcon,
      PREFERENCES,
      pickSegment,
      t,
    };
  },
});
</script>
