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
  <div class="swatch-row" :data-test="dataTest">
    <!-- None -->
    <button
      type="button"
      class="swatch swatch--none"
      :class="{ 'swatch--active': !modelValue }"
      :title="t('dashboard.colorNone')"
      :aria-label="t('dashboard.colorNone')"
      :aria-pressed="!modelValue"
      :data-test="dataTest ? `${dataTest}-none` : undefined"
      @click.stop="select(null)"
    >
      <span class="swatch-slash" />
    </button>

    <!-- Curated swatches -->
    <button
      v-for="c in swatches"
      :key="c"
      type="button"
      class="swatch"
      :class="{ 'swatch--active': isActive(c) }"
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

    <!-- Custom (native color input) -->
    <label
      class="swatch swatch--custom"
      :class="{ 'swatch--active': isCustomActive }"
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
        class="swatch-native"
        :value="modelValue || '#1976d2'"
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

    return { t, isActive, isCustomActive, isDark: isColorDark, select };
  },
});
</script>

<style lang="scss" scoped>
.swatch-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.swatch {
  position: relative;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid rgba(128, 128, 128, 0.3);
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s, box-shadow 0.1s, border-color 0.1s;

  &:hover {
    transform: scale(1.12);
  }

  &--active {
    border-color: var(--color-primary-600, #1976d2);
    box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.28);
  }
}

// "No color" — checkerboard with a diagonal strike
.swatch--none {
  background: repeating-linear-gradient(
    45deg,
    rgba(128, 128, 128, 0.12),
    rgba(128, 128, 128, 0.12) 2px,
    transparent 2px,
    transparent 6px
  );

  .swatch-slash {
    position: absolute;
    inset: 0;
    &::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 1px;
      right: 1px;
      height: 1.5px;
      background: #e53935;
      transform: rotate(-45deg);
      transform-origin: center;
    }
  }
}

.swatch--custom {
  background:
    conic-gradient(
      from 0deg,
      #f44336,
      #ffeb3b,
      #4caf50,
      #2196f3,
      #9c27b0,
      #f44336
    );
}

.swatch-native {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: none;
  padding: 0;
}
</style>
