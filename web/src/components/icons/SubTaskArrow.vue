<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#001495"
    stroke-opacity="0.5"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="lucide lucide-corner-down-right-icon lucide-corner-down-right"
  >
    <!-- Curved path instead of sharp corner -->
    <path d="M4 4 C4 15, 20 15, 20 15" />

    <!-- Arrowhead -->
    <path d="M15 10 L20 15 L15 20" />
  </svg>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "SubTaskArrow",
});
</script>