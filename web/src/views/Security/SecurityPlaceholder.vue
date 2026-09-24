<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

defineProps<{
  title: string;
  icon?: IconName;
  description?: string;
}>();
</script>

<template>
  <OPageLayout :title="title" :icon="icon" data-test="security-placeholder">
    <div class="flex min-h-0 flex-1 items-center justify-center">
      <OEmptyState
        size="hero"
        :icon="icon ?? 'info-outline'"
        :title="title"
        :description="description"
      />
    </div>
  </OPageLayout>
</template>
