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
  <teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="tw:fixed tw:z-9999 tw:bg-white tw:dark:bg-[#2c2c2c] tw:border tw:border-(--o2-border) tw:dark:border-[#404040] tw:rounded tw:shadow-[0_2px_8px_rgba(0,0,0,0.15)] tw:dark:shadow-[0_2px_8px_rgba(0,0,0,0.4)] tw:min-w-70 tw:py-1 tw:px-0"
      :style="menuStyle"
      @click.stop
      data-test="alert-context-menu"
    >
      <div
        class="tw:flex tw:items-center tw:py-2 tw:px-4 tw:cursor-pointer tw:[transition:background-color_0.2s] tw:text-sm tw:text-[#333] tw:hover:bg-[#f5f5f5] tw:active:bg-[var(--o2-border)] tw:dark:text-[var(--o2-border)] tw:dark:hover:bg-[#383838] tw:dark:active:bg-[#404040]"
        @click="handleMenuItemClick('above')"
        data-test="alert-context-menu-above"
      >
        <OIcon name="arrow-upward" size="sm" class="tw:mr-2" />
        <span class="tw:select-none">Create Alert with threshold above {{ formattedValue }}</span>
      </div>
      <div
        class="tw:flex tw:items-center tw:py-2 tw:px-4 tw:cursor-pointer tw:[transition:background-color_0.2s] tw:text-sm tw:text-[#333] tw:hover:bg-[#f5f5f5] tw:active:bg-[var(--o2-border)] tw:dark:text-[var(--o2-border)] tw:dark:hover:bg-[#383838] tw:dark:active:bg-[#404040]"
        @click="handleMenuItemClick('below')"
        data-test="alert-context-menu-below"
      >
        <OIcon name="arrow-downward" size="sm" class="tw:mr-2" />
        <span class="tw:select-none">Create Alert with threshold below {{ formattedValue }}</span>
      </div>
    </div>
  </teleport>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: 'AlertContextMenu',
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
  },
  emits: ['select', 'close'],
  setup(props, { emit }) {
    const menuRef = ref<HTMLElement | null>(null);

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

    const handleMenuItemClick = (condition: 'above' | 'below') => {
      emit('select', {
        condition,
        threshold: props.value,
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
      formattedValue,
      menuStyle,
      handleMenuItemClick,
    };
  },
});
</script>

