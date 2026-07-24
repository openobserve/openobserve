<template>
  <svg
    data-test="dashboard-icon-linear-svg"
    width="116"
    height="87"
    viewBox="0 0 116 87"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      data-test="dashboard-icon-linear-path"
      d="M5.5 81L58.5 5.5L111 81"
      stroke="currentColor"
      stroke-width="4"
    />
    <circle data-test="dashboard-icon-linear-circle" cx="59" cy="6" r="6" fill="currentColor" />
    <circle data-test="dashboard-icon-linear-circle" cx="110" cy="81" r="6" fill="currentColor" />
    <circle data-test="dashboard-icon-linear-circle" cx="6" cy="81" r="6" fill="currentColor" />
  </svg>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "LinearIcon",
});
</script>
