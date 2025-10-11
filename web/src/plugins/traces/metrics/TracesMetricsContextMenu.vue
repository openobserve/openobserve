<!-- Copyright 2023 OpenObserve Inc.

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
    class="traces-metrics-context-menu"
    :style="menuStyle"
    @click.stop
    data-test="traces-metrics-context-menu"
  >
    <div
      class="menu-item"
      @click="handleMenuItemClick('gte')"
      @mouseenter="hoveredItem = 'gte'"
      @mouseleave="hoveredItem = null"
      :class="{ 'hovered': hoveredItem === 'gte' }"
      data-test="context-menu-gte"
    >
      <q-icon name="arrow_upward" size="xs" class="q-mr-sm" />
      <span>{{ fieldName }} >= {{ formattedValue }}</span>
    </div>
    <div
      class="menu-item"
      @click="handleMenuItemClick('lte')"
      @mouseenter="hoveredItem = 'lte'"
      @mouseleave="hoveredItem = null"
      :class="{ 'hovered': hoveredItem === 'lte' }"
      data-test="context-menu-lte"
    >
      <q-icon name="arrow_downward" size="xs" class="q-mr-sm" />
      <span>{{ fieldName }} &lt;= {{ formattedValue }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onBeforeUnmount } from 'vue';

export default defineComponent({
  name: 'TracesMetricsContextMenu',
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

<style scoped lang="scss">
.traces-metrics-context-menu {
  position: fixed;
  z-index: 9999;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  min-width: 200px;
  padding: 4px 0;

  .menu-item {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    cursor: pointer;
    transition: background-color 0.2s;
    font-size: 13px;
    color: #333;

    &.hovered,
    &:hover {
      background-color: #f5f5f5;
    }

    &:active {
      background-color: #e0e0e0;
    }

    span {
      user-select: none;
    }
  }
}

body.body--dark {
  .traces-metrics-context-menu {
    background: #2c2c2c;
    border-color: #404040;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);

    .menu-item {
      color: #e0e0e0;

      &.hovered,
      &:hover {
        background-color: #383838;
      }

      &:active {
        background-color: #404040;
      }
    }
  }
}
</style>
