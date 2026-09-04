<template>
  <svg
    data-test="dashboard-icon-step-middle-svg"
    width="82"
    height="83"
    viewBox="0 0 82 83"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      data-test="dashboard-icon-step-middle-path"
      d="M80 77V6.5H39V77H0"
      stroke="currentColor"
      stroke-width="4"
    />
    <circle
      data-test="dashboard-icon-step-middle-circle"
      cx="6"
      cy="6"
      r="6"
      transform="matrix(-1 0 0 1 65 0)"
      fill="currentColor"
    />
    <circle
      data-test="dashboard-icon-step-middle-circle"
      cx="6"
      cy="6"
      r="6"
      transform="matrix(-1 0 0 1 26 71)"
      fill="currentColor"
    />
  </svg>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "StepMiddle",
});
</script>
