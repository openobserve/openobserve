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
  <div class="flex flex-wrap items-center gap-1.5" :data-test="dataTest">
    <!-- None — checkerboard tint with a diagonal strike -->
    <button
      type="button"
      class="relative inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-default border border-border-default p-0 transition-[transform,box-shadow,border-color] duration-100 hover:scale-[1.12] bg-[repeating-linear-gradient(45deg,color-mix(in_srgb,var(--color-grey-500)_12%,transparent),color-mix(in_srgb,var(--color-grey-500)_12%,transparent)_2px,transparent_2px,transparent_6px)]"
      :class="!modelValue ? 'border-primary-600 ring-2 ring-focus-ring' : ''"
      :title="t('dashboard.colorNone')"
      :aria-label="t('dashboard.colorNone')"
      :aria-pressed="!modelValue"
      :data-test="dataTest ? `${dataTest}-none` : undefined"
      @click.stop="select(null)"
    >
      <span
        class="absolute inset-x-px top-1/2 h-px origin-center -rotate-45 bg-status-negative"
      />
    </button>

    <!-- Curated swatches -->
    <button
      v-for="c in swatches"
      :key="c"
      type="button"
      class="relative inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-default border border-border-default p-0 transition-[transform,box-shadow,border-color] duration-100 hover:scale-[1.12]"
      :class="isActive(c) ? 'border-primary-600 ring-2 ring-focus-ring' : ''"
      :style="{ background: c }"
      :title="c"
      :aria-label="c"
      :aria-pressed="isActive(c)"
      @click.stop="select(c)"
    >
      <OIcon
        v-if="isActive(c)"
        name="check"
        size="xs"
        :class="isDark(c) ? 'text-white' : 'text-black'"
      />
    </button>

    <!-- Custom (native color input) — rainbow wheel until a colour is chosen -->
    <label
      class="relative inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-default border border-border-default p-0 transition-[transform,box-shadow,border-color] duration-100 hover:scale-[1.12] bg-[conic-gradient(from_0deg,var(--color-error-500),var(--color-warning-400),var(--color-success-500),var(--color-blue-500),var(--color-purple-500),var(--color-error-500))]"
      :class="isCustomActive ? 'border-primary-600 ring-2 ring-focus-ring' : ''"
      :style="isCustomActive ? { background: modelValue } : {}"
      :title="t('dashboard.customColor')"
    >
      <OIcon
        v-if="!isCustomActive"
        name="colorize"
        size="xs"
        class="opacity-70"
      />
      <OIcon
        v-else
        name="check"
        size="xs"
        :class="isDark(modelValue) ? 'text-white' : 'text-black'"
      />
      <input
        type="color"
        class="absolute inset-0 h-full w-full cursor-pointer border-none p-0 opacity-0"
        :value="modelValue || DEFAULT_CUSTOM_COLOR"
        @input="(e) => select((e.target as HTMLInputElement).value)"
      />
    </label>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, PropType } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { isColorDark } from "@/utils/dashboard/chartColorUtils";

// Native <input type="color"> only accepts a literal hex — it cannot resolve a
// CSS custom property — so this seed value has to stay a concrete string.
const DEFAULT_CUSTOM_COLOR = "#1976d2";

export default defineComponent({
  name: "ColorSwatchPicker",
  components: { OIcon },
  props: {
    modelValue: { type: String as PropType<string | null>, default: null },
    swatches: { type: Array as PropType<string[]>, required: true },
    dataTest: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const { t } = useI18n();

    const normalized = computed(() => (props.modelValue || "").toLowerCase());

    const isActive = (c: string) => normalized.value === c.toLowerCase();

    const isCustomActive = computed(
      () =>
        !!props.modelValue &&
        !props.swatches.some((s) => s.toLowerCase() === normalized.value),
    );

    const select = (c: string | null) => emit("update:modelValue", c);

    return {
      t,
      isActive,
      isCustomActive,
      isDark: isColorDark,
      select,
      DEFAULT_CUSTOM_COLOR,
    };
  },
});
</script>

