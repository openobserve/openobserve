<!-- Copyright 2026 OpenObserve Inc. SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import SecurityPlaceholder from "./SecurityPlaceholder.vue";

const { t } = useI18nTyped();
</script>
<template>
  <SecurityPlaceholder
    :title="t('siem.sources.title')"
    icon="cloud-upload"
    :description="t('siem.sources.comingSoon')"
  />
</template>
