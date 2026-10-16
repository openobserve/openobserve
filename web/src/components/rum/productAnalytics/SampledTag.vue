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
  <OPopover
    v-model:open="open"
    side="bottom"
    align="end"
    content-class="p-3 w-80 max-w-[calc(100vw-1.5rem)]"
  >
    <template #trigger>
      <OTag
        :label="exact ? t('rum.analytics.exact') : t('rum.analytics.sampled', { ratio })"
        :variant="exact ? 'default-outline' : 'info-outline'"
        :icon="exact ? '' : 'filter-alt'"
        size="sm"
        clickable
        data-test="rum-analytics-sampled-tag"
      />
    </template>
    <div class="flex flex-col gap-2 text-sm" data-test="rum-analytics-sampled-popover">
      <p class="text-text-body">
        {{ t("rum.analytics.sampledReason", { rows: addCommasToNumber(vaRows) }) }}
      </p>
      <p class="text-text-secondary text-xs">{{ t("rum.analytics.sampledRule") }}</p>
      <template v-if="exact">
        <OButton
          variant="outline"
          size="sm"
          data-test="rum-analytics-use-sampling-btn"
          @click="toggle(false)"
          >{{ t("rum.analytics.useSampling") }}</OButton
        >
      </template>
      <template v-else>
        <p class="text-text-secondary text-xs">{{ t("rum.analytics.runExactWarning") }}</p>
        <OButton
          variant="outline"
          size="sm"
          data-test="rum-analytics-run-exact-btn"
          @click="toggle(true)"
          >{{ t("rum.analytics.runExact") }}</OButton
        >
      </template>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { ref } from "vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import type { SampleRatio } from "@/utils/rum/productAnalyticsQueries";

defineProps<{ ratio: SampleRatio; vaRows: number; exact: boolean }>();
const emit = defineEmits<{ "update:exact": [boolean] }>();
const { t } = useI18nTyped();
const open = ref(false);

const toggle = (value: boolean) => {
  open.value = false;
  emit("update:exact", value);
};
</script>
