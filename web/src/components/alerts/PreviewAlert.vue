<template>
  <div ref="chartPanelRef" style="height: 100%; position: relative">
    <chart-renderer />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import { usePanelDataLoader } from "@/composables/dashboard/usePanelDataLoader";

const chartPanelRef = ref(null);
const chartData = ref({});

let { data, loading, errorDetail, metadata } = usePanelDataLoader(
  panelSchema,
  selectedTimeObj,
  variablesData,
  chartPanelRef
);
</script>

<style scoped></style>
