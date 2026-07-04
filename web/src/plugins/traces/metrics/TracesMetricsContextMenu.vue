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
    v-if="visible"
    ref="menuRef"
    class="tw:fixed tw:z-[9999] tw:bg-white tw:border tw:border-solid tw:border-[var(--o2-border)] tw:rounded tw:shadow-[0_2px_8px_rgba(0,0,0,0.15)] tw:min-w-[200px] tw:py-1 tw:dark:bg-[#2c2c2c] tw:dark:border-[#404040] tw:dark:shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
    :style="menuStyle"
    @click.stop
    data-test="traces-metrics-context-menu"
  >
    <div
      class="tw:flex tw:items-center tw:px-4 tw:py-2 tw:cursor-pointer tw:transition-colors tw:text-[13px] tw:text-[#333] tw:select-none tw:dark:text-[var(--o2-border)] tw:hover:bg-[#f5f5f5] tw:dark:hover:bg-[#383838] tw:active:bg-[var(--o2-border)] tw:dark:active:bg-[#404040]"
      @click="handleMenuItemClick('gte')"
      @mouseenter="hoveredItem = 'gte'"
      @mouseleave="hoveredItem = null"
      :class="{ 'tw:bg-[#f5f5f5]! tw:dark:bg-[#383838]!': hoveredItem === 'gte' }"
      data-test="context-menu-gte"
    >
      <OIcon name="arrow-upward" size="xs" class="tw:mr-2" />
      <span>{{ fieldName }} >= {{ formattedValue }}</span>
    </div>
    <div
      class="tw:flex tw:items-center tw:px-4 tw:py-2 tw:cursor-pointer tw:transition-colors tw:text-[13px] tw:text-[#333] tw:select-none tw:dark:text-[var(--o2-border)] tw:hover:bg-[#f5f5f5] tw:dark:hover:bg-[#383838] tw:active:bg-[var(--o2-border)] tw:dark:active:bg-[#404040]"
      @click="handleMenuItemClick('lte')"
      @mouseenter="hoveredItem = 'lte'"
      @mouseleave="hoveredItem = null"
      :class="{ 'tw:bg-[#f5f5f5]! tw:dark:bg-[#383838]!': hoveredItem === 'lte' }"
      data-test="context-menu-lte"
    >
      <OIcon name="arrow-downward" size="xs" class="tw:mr-2" />
      <span>{{ fieldName }} &lt;= {{ formattedValue }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onBeforeUnmount } from 'vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: 'TracesMetricsContextMenu',
  components: {
    OIcon,
  },
  props: {
    visible: {
      type: Boolean,
      default: false,
    },
    x: {
      type: Number,
      required: true,
    },
    y: {
      type: Number,
      required: true,
    },
    value: {
      type: [Number, String],
      required: true,
    },
    fieldName: {
      type: String,
      default: 'Value',
    },
  },
  emits: ['select', 'close'],
  setup(props, { emit }) {
    const menuRef = ref<HTMLElement | null>(null);
    const hoveredItem = ref<string | null>(null);

    const formattedValue = computed(() => {
      if (typeof props.value === 'number') {
        return props.value.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        });
      }
      return props.value;
    });

    const menuStyle = computed(() => ({
      left: `${props.x}px`,
      top: `${props.y}px`,
    }));

    const handleMenuItemClick = (condition: 'gte' | 'lte') => {
      emit('select', {
        condition,
        value: props.value,
        fieldName: props.fieldName,
      });
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
        emit('close');
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        emit('close');
      }
    };

    watch(
      () => props.visible,
      (newVisible) => {
        if (newVisible) {
          setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
            document.addEventListener('keydown', handleEscape);
          }, 0);
        } else {
          document.removeEventListener('click', handleClickOutside);
          document.removeEventListener('keydown', handleEscape);
        }
      },
    );

    onBeforeUnmount(() => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    });

    return {
      menuRef,
      hoveredItem,
      formattedValue,
      menuStyle,
      handleMenuItemClick,
    };
  },
});
</script>

