<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import SecurityAccessLock from "@/components/security/SecurityAccessLock.vue";
import { useSecurityAccess } from "@/composables/security/useSecurityAccess";
import { viewDenial } from "@/composables/useAccessStore";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const access = useSecurityAccess();
const denials = [viewDenial("security", "get")];
</script>

<template>
  <div class="flex h-full items-center justify-center p-4" data-test="security-page-gate">
    <OEmptyState
      v-if="access.failed.value"
      preset="load-error"
      size="hero"
      :title="t('siem.access.checkFailedTitle')"
      :description="t('siem.access.checkFailedHint')"
      data-test="security-page-gate-failed"
    >
      <template #actions>
        <EmptyStateActionCard
          icon="refresh"
          :label="t('emptyState.loadError.action')"
          :sublabel="t('emptyState.loadError.actionDesc')"
          data-test="security-page-gate-retry"
          @click="access.retry"
        />
      </template>
    </OEmptyState>
    <SecurityAccessLock v-else :denials="denials" size="hero" data-test="security-page-lock" />
  </div>
</template>
