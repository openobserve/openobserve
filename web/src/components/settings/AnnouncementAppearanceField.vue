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
  <div class="announcement-appearance">
    <div class="announcement-appearance-field">
      <span class="announcement-appearance-label">{{ t("announcements.editor.textSize") }}</span>
      <q-btn-toggle
        v-model="textSize"
        class="announcement-appearance-toggle"
        toggle-color="primary"
        no-caps
        unelevated
        :options="textSizeOptions"
        data-test="announcement-editor-text-size"
      />
    </div>

    <div class="announcement-appearance-field">
      <span class="announcement-appearance-label">{{ t("announcements.editor.icon") }}</span>
      <q-btn-toggle
        v-model="icon"
        class="announcement-appearance-toggle"
        toggle-color="primary"
        no-caps
        unelevated
        :options="iconOptions"
        data-test="announcement-editor-icon"
      />
    </div>

    <div class="announcement-appearance-field">
      <span class="announcement-appearance-label">{{ t("announcements.editor.background") }}</span>
      <div
        class="announcement-appearance-swatches"
        role="radiogroup"
        :aria-label="t('announcements.editor.background')"
        data-test="announcement-editor-color"
        @keydown="onSwatchKeydown"
      >
        <button
          v-for="(swatch, position) in swatches"
          :key="swatch.key"
          :ref="(el) => (swatchRefs[position] = el as HTMLButtonElement)"
          type="button"
          role="radio"
          class="announcement-swatch"
          :class="{
            'announcement-swatch--text': !swatch.preset,
            'is-selected': choice === swatch.key,
          }"
          :style="
            swatch.preset
              ? {
                  '--swatch-light': swatch.preset.light,
                  '--swatch-dark': swatch.preset.dark,
                }
              : undefined
          "
          :tabindex="focusKey === swatch.key ? 0 : -1"
          :aria-checked="choice === swatch.key"
          :aria-label="swatch.label"
          :data-test="`announcement-editor-color-${swatch.testId}`"
          @click="select(swatch.key)"
        >
          <template v-if="!swatch.preset">{{ swatch.label }}</template>
          <q-tooltip v-else>{{ swatch.label }}</q-tooltip>
        </button>
      </div>
      <span class="announcement-appearance-hint">{{ t("announcements.editor.colorHelp") }}</span>
    </div>

    <div v-if="choice === CUSTOM_CHOICE" class="announcement-appearance-field">
      <div class="announcement-appearance-grid">
        <q-input
          v-for="mode in THEME_MODES"
          :key="mode"
          :model-value="colorFor(mode)"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          placeholder="#1D4ED8"
          :label="t(`announcements.editor.${fieldFor(mode)}`)"
          :error="!!errors[fieldFor(mode)]"
          :error-message="errors[fieldFor(mode)]"
          :data-test="`announcement-editor-${fieldFor(mode)}`"
          @update:model-value="setColor(mode, String($event ?? '').trim())"
        >
          <template #append>
            <input
              type="color"
              class="announcement-color-input"
              :value="isHexColor(colorFor(mode)) ? colorFor(mode) : '#FFFFFF'"
              :aria-label="t(`announcements.editor.${fieldFor(mode)}`)"
              :data-test="`announcement-editor-${fieldFor(mode)}-picker`"
              @input="setColor(mode, ($event.target as HTMLInputElement).value.toUpperCase())"
            />
          </template>
        </q-input>
      </div>
      <span class="announcement-appearance-hint">
        {{ t("announcements.editor.colorCustomHelp") }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import {
  BANNER_ICONS,
  COLOR_PRESETS,
  TEXT_SIZES,
  isHexColor,
  materialIconName,
  presetFor,
  type BannerTextSize,
  type ThemeMode,
} from "@/utils/announcementAppearance";

defineProps<{ errors: { colorLight?: string; colorDark?: string } }>();

const textSize = defineModel<BannerTextSize>("textSize", { required: true });
const colorLight = defineModel<string>("colorLight", { required: true });
const colorDark = defineModel<string>("colorDark", { required: true });
const icon = defineModel<string>("icon", { required: true });

const SEVERITY_CHOICE = "severity";
const CUSTOM_CHOICE = "custom";
const THEME_MODES: ThemeMode[] = ["light", "dark"];

const { t } = useI18n();

const textSizeOptions = computed(() =>
  TEXT_SIZES.map((size) => ({
    label: t(`announcements.editor.textSizes.${size}`),
    value: size,
    attrs: { "data-test": `announcement-editor-text-size-${size}` },
  })),
);

const iconOptions = computed(() => [
  {
    label: t("announcements.editor.iconDefault"),
    value: "",
    attrs: { "data-test": "announcement-editor-icon-default" },
  },
  ...BANNER_ICONS.map((name) => ({
    icon: materialIconName(name),
    value: name,
    attrs: {
      "aria-label": name,
      title: name,
      "data-test": `announcement-editor-icon-${name}`,
    },
  })),
]);

const choiceFor = (light: string, dark: string) =>
  !light && !dark ? SEVERITY_CHOICE : (presetFor(light, dark)?.key ?? CUSTOM_CHOICE);

// A ref rather than derived from the hexes, so picking Custom on a preset pair does not snap back.
const choice = ref(choiceFor(colorLight.value, colorDark.value));

const swatches = computed(() => [
  {
    key: SEVERITY_CHOICE,
    testId: "default",
    label: t("announcements.editor.matchSeverity"),
    preset: null,
  },
  ...COLOR_PRESETS.map((preset) => ({
    key: preset.key,
    testId: preset.key,
    label: t(`announcements.editor.colorPresets.${preset.key}`),
    preset,
  })),
  {
    key: CUSTOM_CHOICE,
    testId: "custom",
    label: t("announcements.editor.custom"),
    preset: null,
  },
]);

const swatchRefs: HTMLButtonElement[] = [];

// Roving tabindex: the group is one Tab stop and arrow keys move between swatches.
const focusKey = ref(choice.value);

// Colours set from outside (a saved style) re-light the matching swatch unless Custom is open.
watch([colorLight, colorDark], ([light, dark]) => {
  if (choice.value === CUSTOM_CHOICE && (light || dark)) return;
  choice.value = choiceFor(light, dark);
  focusKey.value = choice.value;
});

const onSwatchKeydown = (event: KeyboardEvent) => {
  const steps: Record<string, number> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
  };
  const keys = swatches.value.map((swatch) => swatch.key);
  const current = keys.indexOf(focusKey.value);
  let next: number;
  if (event.key in steps) next = (current + steps[event.key] + keys.length) % keys.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = keys.length - 1;
  else return;
  event.preventDefault();
  focusKey.value = keys[next];
  swatchRefs[next]?.focus();
};

const fieldFor = (mode: ThemeMode) => (mode === "light" ? "colorLight" : "colorDark");

const colorFor = (mode: ThemeMode) => (mode === "light" ? colorLight.value : colorDark.value);

const setColor = (mode: ThemeMode, value: string) => {
  if (mode === "light") colorLight.value = value;
  else colorDark.value = value;
};

const select = (next: string) => {
  choice.value = next;
  focusKey.value = next;
  if (next === SEVERITY_CHOICE) {
    colorLight.value = "";
    colorDark.value = "";
    return;
  }
  const preset = COLOR_PRESETS.find((candidate) => candidate.key === next);
  if (preset) {
    colorLight.value = preset.light;
    colorDark.value = preset.dark;
  }
};
</script>

<style scoped lang="scss">
.announcement-appearance {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.announcement-appearance-field {
  display: flex;
  flex-direction: column;
}

.announcement-appearance-label {
  margin-bottom: 0.375rem;
  font-size: 0.8125rem;
  font-weight: 600;
}

.announcement-appearance-hint {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  opacity: 0.7;
}

.announcement-appearance-toggle {
  align-self: flex-start;
  flex-wrap: wrap;
  max-width: 100%;
  border: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
}

.announcement-appearance-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1rem;
}

.announcement-appearance-swatches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.announcement-swatch {
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
  border-radius: 50%;
  background: linear-gradient(135deg, var(--swatch-light) 0 50%, var(--swatch-dark) 50% 100%);
  cursor: pointer;

  &.is-selected {
    outline: 2px solid var(--q-primary);
    outline-offset: 2px;
  }
}

.announcement-swatch--text {
  width: auto;
  padding: 0 0.75rem;
  border-radius: 0.875rem;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 0.8125rem;
}

.announcement-color-input {
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}

:deep(.q-field--labeled.showLabelOnTop) {
  &.q-field--float .q-field__label {
    transform: translateY(-175%);
  }

  .q-field__native {
    padding: 4px 8px !important;
  }
}
</style>
