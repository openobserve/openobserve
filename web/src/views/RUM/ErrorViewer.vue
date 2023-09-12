<template>
  <div class="q-px-lg q-py-md">
    <ErrorHeader />
  </div>
  <q-separator class="full-width" />
  <div class="q-px-lg q-py-md">
    <ErrorTags />
    <ErrorSessionReplay />
    <ErrorEvents />
  </div>
</template>

<script setup lang="ts">
import ErrorHeader from "@/components/rum/errorTracking/view/ErrorHeader.vue";
import ErrorTags from "@/components/rum/errorTracking/view/ErrorTags.vue";
import ErrorEvents from "@/components/rum/errorTracking/view/ErrorEvents.vue";
import ErrorSessionReplay from "@/components/rum/errorTracking/view/ErrorSessionReplay.vue";
</script>

<style scoped></style>
