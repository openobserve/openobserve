<template>
  <div>
    <img
      :alt="column.category"
      :src="typeIcons"
      style="width: 22px; height: 22px"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import error from "@/assets/images/rum/events/error.png";
import navigation from "@/assets/images/rum/events/navigation.png";
import user from "@/assets/images/rum/events/user.png";
import xhr from "@/assets/images/rum/events/xhr.png";

const props = defineProps({
  column: {
    type: Object,
    required: true,
  },
});

const typeIcons = computed(() => {
  if (props.column.category.toLowerCase() === "error") {
    return error;
  } else if (props.column.category.toLowerCase() === "xhr") {
    return xhr;
  } else if (props.column.category.toLowerCase() === "navigation") {
    return navigation;
  } else if (props.column.category.toLowerCase() === "click") {
    return user;
  } else if (props.column.category.toLowerCase() === "reload") {
    return navigation;
  }
  return error;
});
</script>

<style scoped></style>
