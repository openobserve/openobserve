<template>
  <div class="sidebar" :class="{ open: isOpen }">
    <div v-if="!isOpen" class="sidebar-header-collapsed" @click="toggleSidebar">
      <div class="collapsed-icon">+</div>
      <div class="collapsed-title">{{ title }}</div>
    </div>
    <div v-else class="sidebar-header-expanded">
      <div class="expanded-title">{{ title }}</div>
      <button class="collapse-button" @click="toggleSidebar">-</button>
    </div>
    <div class="sidebar-content" v-if="isOpen">
      <q-separator />
      <slot></slot>
    </div>
  </div>
</template>

<script lang="ts">
import { ref, watch } from 'vue';

export default {
  props: {
    title: {
      type: String,
      required: true
    },
    modelValue: {
      type: Boolean,
      required: true
    }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const isOpen = ref(props.modelValue);

    const toggleSidebar = () => {
      isOpen.value = !isOpen.value;
      emit('update:modelValue', isOpen.value);
    };

    watch(
      () => props.modelValue,
      (value) => {
        isOpen.value = value;
      }
    );

    return {
      isOpen,
      toggleSidebar
    };
  }
};
</script>

<style scoped>
.sidebar {
  position: relative;
  width: 50px;
  height: 100%;
}

.sidebar.open {
  width: 300px;
}

.sidebar-header-collapsed {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  width: 50px;
  height: 100%;
  cursor: pointer;
}

.sidebar-header-expanded {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 10px;
}

.collapsed-icon {
  margin-top: 10px;
  font-size: 20px;
}

.collapsed-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-weight: bold;
}

.expanded-title {
  font-weight: bold;
}

.collapse-button {
  padding: 0px 5px;
}

.sidebar-content {
  padding: 0px 10px;
}
</style>
