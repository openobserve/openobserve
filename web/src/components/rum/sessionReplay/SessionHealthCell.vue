<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="flex items-center gap-1.5" data-test="rum-session-health-cell">
    <template v-if="errorCount > 0 || frustrationCount > 0">
      <OTag
        v-if="errorCount > 0"
        variant="error-soft"
        icon="error-outline"
        size="sm"
        :title="t('rum.errorCountTooltip', { count: errorCount })"
        data-test="rum-session-health-error-tag"
        >{{ errorCount }}</OTag
      >
      <OTag
        v-if="frustrationCount > 0"
        variant="warning-soft"
        icon="sentiment-very-dissatisfied"
        size="sm"
        :title="t('rum.frustrationCountTooltip', { count: frustrationCount })"
        data-test="rum-session-health-frustration-tag"
        >{{ frustrationCount }}</OTag
      >
    </template>
    <OTag
      v-else
      variant="success-soft"
      icon="check-circle-outline"
      size="sm"
      :title="t('rum.cleanTooltip')"
      data-test="rum-session-health-clean-tag"
      >{{ t("rum.clean") }}</OTag
    >
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OTag from "@/lib/core/Badge/OTag.vue";

defineProps<{
  errorCount: number;
  frustrationCount: number;
}>();

const { t } = useI18n();
</script>
