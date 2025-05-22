<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="50"
    viewBox="0 0 12 50"
    fill="none"
    class="tw-absolute"
  >
    <path
      d="M1 0V20C1 40 2 48 11 48H11"
      stroke="#001495"
      stroke-opacity="0.5"
      stroke-width="1"
    />
    <path
      d="M11.1768 48.1768C11.2744 48.0791 11.2744 47.9209 11.1768 47.8232L9.58579 46.2322C9.48816 46.1346 9.32986 46.1346 9.23223 46.2322C9.1346 46.3299 9.1346 46.4882 9.23223 46.5858L10.6464 48L9.23223 49.4142C9.1346 49.5118 9.1346 49.6701 9.23223 49.7678C9.32986 49.8654 9.48816 49.8654 9.58579 49.7678L11.1768 48.1768Z"
      fill="#001495"
      fill-opacity="0.5"
    />
  </svg>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "SubTaskArrow",
  props: {
    height: {
      type: Number,
      default: 50,
    },
  },
});
</script>
