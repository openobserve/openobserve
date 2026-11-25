<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- The explorers' failed-search notice: a short title, the backend's cleaned message, then the
     query that ran. -->
<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineProps<{
  message: string;
  /** The SQL or filter that ran; omitted when there is none. */
  sql?: string;
}>();

const { t } = useI18nTyped();
</script>

<template>
  <div class="flex shrink-0 items-start gap-2 px-4 py-3" role="alert">
    <OIcon name="error-outline" size="sm" class="text-error-500 mt-0.5 shrink-0" />
    <div class="flex min-w-0 flex-col gap-1">
      <span class="text-error-500 text-sm font-medium" data-test="explorer-error-title">{{
        t("panel.logExplorer.queryFailed")
      }}</span>
      <span
        class="text-text-body text-xs break-all whitespace-pre-wrap"
        data-test="explorer-error-message"
        >{{ message }}</span
      >
      <code
        v-if="sql"
        class="text-text-secondary font-mono text-xs break-all whitespace-pre-wrap"
        data-test="explorer-error-sql"
        >{{ sql }}</code
      >
    </div>
  </div>
</template>
