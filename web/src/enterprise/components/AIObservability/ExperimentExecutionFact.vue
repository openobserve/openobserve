<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <div>
    <dt>{{ label }}</dt>
    <dd class="text-text-primary mt-0.5 break-all">{{ value }}</dd>
  </div>
</template>
<script setup lang="ts">
defineProps<{ label: string; value: string }>();
</script>
