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
  <span class="flex size-5 items-center justify-center" :data-test="dataTest">
    <OCheckbox
      v-if="!result"
      size="sm"
      :model-value="checked"
      :disabled="disabled"
      :aria-label="label"
      @update:model-value="(v) => emit('update', v === true)"
    />
    <OSpinner
      v-else-if="result.status === 'creating'"
      size="xs"
      :aria-label="t('insight.bulk.status.creating')"
    />
    <OIcon
      v-else-if="result.status === 'created'"
      name="check-circle"
      size="sm"
      class="text-status-success-text"
      role="img"
      :aria-label="t('insight.bulk.status.created')"
      :data-test="`${dataTest}-created`"
    />
    <OIcon
      v-else-if="result.status === 'failed'"
      name="error-outline"
      size="sm"
      class="text-status-error-text"
      role="img"
      :aria-label="t('insight.bulk.status.failed')"
      :data-test="`${dataTest}-failed`"
    />
    <OIcon
      v-else-if="result.status === 'exists'"
      name="check-circle"
      size="sm"
      class="text-text-secondary"
      role="img"
      :aria-label="t('insight.bulk.status.exists')"
      :data-test="`${dataTest}-exists`"
    />
    <span
      v-else
      class="bg-border-default size-2 rounded-full"
      role="img"
      :aria-label="t('insight.bulk.status.queued')"
    />
  </span>
</template>

<script setup lang="ts">
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { RowResult } from "./useBulkCreate";

defineProps<{
  result: RowResult | undefined;
  checked: boolean;
  disabled: boolean;
  label: I18nText;
  dataTest: string;
}>();

const emit = defineEmits<{ update: [on: boolean] }>();
const { t } = useI18nTyped();
</script>
