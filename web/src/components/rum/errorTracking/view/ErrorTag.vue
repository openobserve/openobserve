<template>
  <div class="tag-block row items-center wrap q-mr-sm q-mt-sm">
    <div class="q-px-md">{{ tag.key }}</div>
    <q-separator vertical />
    <div class="q-px-md tag-bg">{{ tag.value }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps({
  tag: {
    type: Object,
    required: true,
  },
});
</script>

<style lang="scss" scoped>
.tag-block {
  border: 1px solid #e0e0e0;
  border-radius: 4px;
}

.tag-bg {
  background-color: #e7e8f0b2;
  color: #5960b2;
}
</style>
