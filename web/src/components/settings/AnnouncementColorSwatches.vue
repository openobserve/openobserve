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
  <div
    class="flex flex-wrap items-center gap-2"
    role="radiogroup"
    :data-test="dataTest"
    @keydown="onKeydown"
  >
    <OButton
      :ref="(el) => setOption(0, el)"
      variant="outline"
      size="xs"
      :active="modelValue === DEFAULT_CHOICE"
      role="radio"
      :tabindex="tabStop(DEFAULT_CHOICE)"
      :aria-checked="modelValue === DEFAULT_CHOICE"
      :data-test="`${dataTest}-default`"
      @click="$emit('update:modelValue', DEFAULT_CHOICE)"
    >
      {{ t("announcements.form.colorDefault") }}
    </OButton>

    <!-- OButton bakes in its own background, so a swatch whose fill is the colour itself is a plain button. -->
    <button
      v-for="(preset, i) in BANNER_COLOR_PRESETS"
      :key="preset.key"
      :ref="(el) => setOption(i + 1, el)"
      type="button"
      role="radio"
      :tabindex="tabStop(preset.key)"
      :aria-checked="modelValue === preset.key"
      :aria-label="presetLabel(preset.key)"
      :title="presetLabel(preset.key)"
      class="rounded-default border-border-default focus-visible:ring-focus-ring from-banner-swatch-light to-banner-swatch-dark size-7 cursor-pointer border bg-linear-135 from-50% to-50% p-0 transition-[transform,box-shadow] duration-100 outline-none hover:scale-110 focus-visible:ring-2"
      :class="modelValue === preset.key ? 'ring-focus-ring ring-2' : ''"
      :style="swatchStyle(preset)"
      :data-test="`${dataTest}-preset-${preset.key}`"
      @click="$emit('update:modelValue', preset.key)"
    />

    <OButton
      :ref="(el) => setOption(BANNER_COLOR_PRESETS.length + 1, el)"
      variant="outline"
      size="xs"
      icon-left="colorize"
      :active="modelValue === CUSTOM_CHOICE"
      role="radio"
      :tabindex="tabStop(CUSTOM_CHOICE)"
      :aria-checked="modelValue === CUSTOM_CHOICE"
      :data-test="`${dataTest}-custom`"
      @click="$emit('update:modelValue', CUSTOM_CHOICE)"
    >
      {{ t("announcements.form.colorCustom") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from "vue";

import { BANNER_COLOR_PRESETS, type BannerColorPreset } from "@/constants/themes";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import { CUSTOM_CHOICE, DEFAULT_CHOICE } from "@/utils/announcementAppearance";
import { useRovingRadio } from "./useRovingRadio";

const props = defineProps<{
  /** `default`, `custom`, or a preset key. */
  modelValue: string;
  dataTest: string;
}>();

const emit = defineEmits<{ (_e: "update:modelValue", _value: string): void }>();

const { t } = useI18nTyped();

/** Choices in visual order, matching the option refs. */
const CHOICES = [DEFAULT_CHOICE, ...BANNER_COLOR_PRESETS.map((p) => p.key), CUSTOM_CHOICE];

const { setOption, tabStop, onKeydown } = useRovingRadio(
  () => CHOICES,
  () => props.modelValue,
  (choice) => emit("update:modelValue", choice),
);

const presetLabel = (key: string) => t(`announcements.colorPresets.${key}` as I18nKey);

// The colours are data, so they travel as the swatch tokens' values rather than a literal style property.
const swatchStyle = (preset: BannerColorPreset): CSSProperties =>
  ({
    "--color-banner-swatch-light": preset.light,
    "--color-banner-swatch-dark": preset.dark,
  }) as CSSProperties;
</script>
