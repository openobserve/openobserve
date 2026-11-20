<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  /** Lower-case noun phrase for what failed, such as "cases". */
  what: string;
  /** What to do next; defaults to a generic retry hint. */
  hint?: string;
  size?: "region" | "compact";
}>();
const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();
</script>

<template>
  <OEmptyState
    kind="error"
    :size="size ?? 'region'"
    :title="t('siem.loadError.title', { what: props.what })"
    :text="props.hint ? raw(props.hint) : t('siem.loadError.hint', { what: props.what })"
    data-test="security-load-error"
    @action="emit('retry')"
  />
</template>
