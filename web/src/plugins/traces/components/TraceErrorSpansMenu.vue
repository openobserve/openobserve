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

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { formatLargeNumber } from "@/utils/zincutils";
import { raw, useI18nTyped } from "@/types/i18n";
import type { ErrorSpanSummary } from "../utils/traceErrorSummary";
import { useErrorSpanLabel } from "./useErrorSpanLabel";

withDefaults(defineProps<{ errors: ErrorSpanSummary[]; compact?: boolean }>(), {
  compact: false,
});
const emit = defineEmits<{ (e: "select", spanId: string): void }>();

const { t } = useI18nTyped();
const spanLabel = useErrorSpanLabel();
</script>

<template>
  <ODropdown
    v-if="errors.length"
    side="bottom"
    align="start"
    content-class="max-h-[60vh] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto"
  >
    <template #trigger>
      <OButton variant="cell" class="w-auto!">
        <OTag
          type="logsResultChip"
          value="error"
          :size="compact ? 'sm' : undefined"
          data-test="trace-details-error-spans-count"
          :class="compact ? 'py-1!' : ''"
        >
          <span class="inline-flex items-center gap-0.5"
            >{{ formatLargeNumber(errors.length) }} {{ t("traces.errorsLabel") }}
            <OIcon name="expand-more" size="xs"
          /></span>
        </OTag>
        <OTooltip :content="raw(errors.length + ' ' + t('traces.errorsLabel'))" />
      </OButton>
    </template>
    <ODropdownGroup :label="t('traces.errorStrip.menuTitle')">
      <ODropdownItem
        v-for="error in errors"
        :key="error.spanId"
        :data-test="`trace-details-error-spans-item-${error.spanId}`"
        @select="emit('select', error.spanId)"
      >
        <OIcon name="error" size="sm" class="text-status-error-text shrink-0 self-start" />
        <span class="flex min-w-0 flex-1 flex-col">
          <OTruncatedText class="text-text-body">{{ spanLabel(error) }}</OTruncatedText>
          <OTruncatedText v-if="error.message" class="text-status-error-text text-xs">{{
            error.message
          }}</OTruncatedText>
        </span>
      </ODropdownItem>
    </ODropdownGroup>
  </ODropdown>
</template>
