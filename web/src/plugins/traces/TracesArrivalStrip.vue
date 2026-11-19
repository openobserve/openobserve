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
  <div
    role="status"
    class="bg-surface-subtle text-text-body border-border-default flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-0 border-b border-solid px-3 py-1.5 text-xs"
    data-test="traces-arrival-strip"
  >
    <OIcon name="history" size="xs" class="shrink-0" aria-hidden="true" />
    <span class="min-w-0" data-test="traces-arrival-range">{{ range }}</span>
    <span class="text-text-secondary shrink-0">{{ t("dateTime.fromPage", { page }) }}</span>
    <OButton
      variant="outline"
      size="xs"
      class="shrink-0"
      data-test="traces-arrival-apply-btn"
      @click="emit('apply')"
      >{{ t("common.apply") }}</OButton
    >
    <OButton
      variant="ghost"
      size="icon-xs"
      icon-left="close"
      class="ms-auto shrink-0"
      :aria-label="t('common.close')"
      data-test="traces-arrival-close-btn"
      @click="emit('close')"
    >
      <OTooltip :content="t('common.close')" />
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

defineProps<{ range: I18nText; page: I18nText }>();
const emit = defineEmits<{ apply: []; close: [] }>();
const { t } = useI18nTyped();
</script>
