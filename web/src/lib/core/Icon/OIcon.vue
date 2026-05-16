<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
defineProps<{
  name: string;
  size?: string;
}>();
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="size ?? '1.25rem'"
    :height="size ?? '1.25rem'"
    fill="currentColor"
    aria-hidden="true"
  >
    <!-- search -->
    <path
      v-if="name === 'search'"
      d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
    />
    <!-- chevron_left -->
    <path
      v-else-if="name === 'chevron_left'"
      d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"
    />
    <!-- chevron_right -->
    <path
      v-else-if="name === 'chevron_right'"
      d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"
    />
    <!-- arrow_upward -->
    <path
      v-else-if="name === 'arrow_upward'"
      d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"
    />
    <!-- arrow_downward -->
    <path
      v-else-if="name === 'arrow_downward'"
      d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"
    />
    <!-- unfold_more -->
    <path
      v-else-if="name === 'unfold_more'"
      d="M12 5.83L15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z"
    />
    <!-- cancel -->
    <path
      v-else-if="name === 'cancel'"
      d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"
    />
    <!-- expand_less -->
    <path
      v-else-if="name === 'expand_less'"
      d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"
    />
    <!-- expand_more -->
    <path
      v-else-if="name === 'expand_more'"
      d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"
    />
    <!-- content_copy -->
    <path
      v-else-if="name === 'content_copy'"
      d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
    />
    <!-- check -->
    <path
      v-else-if="name === 'check'"
      d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
    />
    <!-- edit (pencil) -->
    <path
      v-else-if="name === 'edit'"
      d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
    />
    <!-- delete -->
    <path
      v-else-if="name === 'delete'"
      d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
    />
  </svg>
</template>
