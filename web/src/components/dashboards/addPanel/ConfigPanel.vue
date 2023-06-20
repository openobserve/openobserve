<template>
  <div>
    <q-toggle v-if="dashboardPanelData.data.type != 'table'" v-model="dashboardPanelData.data.config.show_legends" 
      label="Show Legends" />

    <q-select outlined v-model="dashboardPanelData.data.config.legends_position" :options="legendsPositionOptions" dense>
    </q-select>
    
  </div>
</template>

<script lang="ts">
import useDashboardPanelData from '@/composables/useDashboardPanel';
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
    const { dashboardPanelData} = useDashboardPanelData()

    // options for legends position
    const legendsPositionOptions = [
      {
        label: 'Top',
        value: 'top'
      },
      {
        label: 'Bottom',
        value: 'bottom'
      },
      {
        label: 'Left',
        value: 'left'
      },
      {
        label: 'Right',
        value: 'right'
      },
    ]
    return {
      dashboardPanelData,

      // legends position options
      legendsPositionOptions,

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
