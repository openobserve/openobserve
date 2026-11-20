<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import { useI18nTyped } from "@/types/i18n";

defineProps<{ dataTest: string }>();

const { t } = useI18nTyped();
</script>

<template>
  <ODropdown align="end">
    <template #trigger>
      <OButton
        icon-only
        variant="ghost"
        icon="more-horiz"
        :aria-label="t('siem.common.moreActions')"
        :data-test="dataTest"
      />
    </template>
    <slot />
  </ODropdown>
</template>
