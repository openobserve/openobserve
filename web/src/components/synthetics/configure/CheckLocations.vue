<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { useI18n } from 'vue-i18n'
import type { BrowserCheck } from '@/types/synthetics'
import OIcon from '@/lib/core/Icon/OIcon.vue'

defineProps<{ check: BrowserCheck }>()
defineEmits<{ 'update:check': [value: BrowserCheck] }>()

const { t } = useI18n()
</script>

<template>
  <div class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-6 tw:mb-4">
    <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:mb-4">
      {{ t('synthetics.locations.title') }}
    </h3>
    <div class="tw:flex tw:flex-col tw:gap-2">
      <div class="tw:flex tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:px-3 tw:py-2">
        <OIcon name="check-circle" size="sm" class="tw:text-[var(--o2-status-success-text)]" />
        <span class="tw:text-sm tw:text-[var(--o2-text-body)]">{{ t('synthetics.locations.locationAwsEast') }}</span>
      </div>
      <div
        class="tw:flex tw:items-center tw:justify-center tw:rounded-md tw:border tw:border-dashed tw:border-[var(--o2-border-color)] tw:px-3 tw:py-3 tw:text-sm tw:text-[var(--o2-text-muted)]"
      >
        {{ t('synthetics.locations.comingSoon') }}
      </div>
    </div>
  </div>
</template>
