<template>
  <div>
    <div class="tags-title text-grey-8 text-bold q-ml-xs">Tags</div>
    <div class="row items-center">
      <div class="q-mr-lg">
        <span class="q-pl-xs">195.72.146.249 </span>
      </div>
      <q-separator vertical />
      <div class="q-mx-lg">
        <div class="q-pl-xs">Chrome</div>
        <div class="q-pl-xs">Version 2.6.2</div>
      </div>
      <q-separator vertical />
      <div class="q-ml-lg">
        <div class="q-pl-xs">Mac OS X</div>
        <div class="q-pl-xs">Version 2.6.2</div>
      </div>
    </div>
    <div class="row items-center wrap q-mt-lg">
      <template v-for="(value, tag) in tags" :key="tag">
        <div class="tag-block row items-center wrap q-mr-sm">
          <div class="q-px-md">{{ tag }}</div>
          <q-separator vertical />
          <div class="q-px-md bg-grey-2">{{ value }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps({
  tags: {
    type: Object,
    default: () => ({
      browser: "Chrome",
      device: "Mac",
      enviornment: "Production",
    }),
  },
});
</script>

<style scoped>
.tags-title {
  font-size: 16px;
}

.tag-block {
  border: 1px solid #e0e0e0;
  border-radius: 4px;
}
</style>
