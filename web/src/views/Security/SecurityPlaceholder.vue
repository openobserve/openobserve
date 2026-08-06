<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";

defineProps<{
  title: string;
  icon?: IconName;
  description?: string;
}>();
</script>

<template>
  <div class="placeholder-wrap">
    <div class="placeholder-card">
      <div class="placeholder-ico">
        <OIcon :name="icon ?? 'info-outline'" size="xl" />
      </div>
      <h2 class="placeholder-title">{{ title }}</h2>
      <p class="placeholder-desc">{{ description ?? "Coming in a future sprint" }}</p>
    </div>
  </div>
</template>

<style scoped>
.placeholder-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px;
}

.placeholder-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  max-width: 360px;
}

.placeholder-ico {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(109, 92, 224, 0.08);
  color: #6d5ce0;
}

.placeholder-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
}

.placeholder-desc {
  font-size: 13px;
  opacity: 0.55;
  margin: 0;
}
</style>
