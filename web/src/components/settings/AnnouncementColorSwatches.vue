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

    <!-- Each swatch shows its light colour over its dark one, since a preset sets both. -->
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
      class="rounded-default border-border-default focus-visible:ring-focus-ring size-7 cursor-pointer border p-0 transition-[transform,box-shadow] duration-100 outline-none hover:scale-110 focus-visible:ring-2"
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

const props = defineProps<{
  /** `default`, `custom`, or a preset key. */
  modelValue: string;
  dataTest: string;
}>();

const emit = defineEmits<{ (_e: "update:modelValue", _value: string): void }>();

const { t } = useI18nTyped();

/** Choices in visual order, matching the option refs. */
const CHOICES = [DEFAULT_CHOICE, ...BANNER_COLOR_PRESETS.map((p) => p.key), CUSTOM_CHOICE];

const NEXT_KEYS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

const options: (HTMLElement | null)[] = [];

const setOption = (index: number, el: unknown) => {
  const node = (el as { $el?: HTMLElement } | null)?.$el ?? (el as HTMLElement | null);
  options[index] = node ?? null;
};

// One Tab stop for the whole group, as a radiogroup promises; arrows move between choices.
const tabStop = (choice: string) => {
  const selected = CHOICES.includes(props.modelValue) ? props.modelValue : DEFAULT_CHOICE;
  return choice === selected ? 0 : -1;
};

const onKeydown = (event: KeyboardEvent) => {
  const step = NEXT_KEYS[event.key];
  if (!step) return;
  event.preventDefault();
  const current = Math.max(0, CHOICES.indexOf(props.modelValue));
  const next = (current + step + CHOICES.length) % CHOICES.length;
  emit("update:modelValue", CHOICES[next]);
  options[next]?.focus();
};

const presetLabel = (key: string) => t(`announcements.colorPresets.${key}` as I18nKey);

const swatchStyle = (preset: BannerColorPreset): CSSProperties => ({
  background: `linear-gradient(135deg, ${preset.light} 50%, ${preset.dark} 50%)`,
});
</script>
