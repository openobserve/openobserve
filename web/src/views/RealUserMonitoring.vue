<template>
  <div :style="{ height: 'calc(100vh - 57px)', overflow: 'hidden' }">
    <SessionViewer />
  </div>
</template>

<script setup lang="ts">
import SessionViewer from "@/components/rum/SessionViewer.vue";
</script>

<style scoped></style>
