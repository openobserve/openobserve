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
  <div class="flex shrink-0 flex-col gap-1" data-test="assistant-history-footer">
    <OText
      v-if="retentionLine"
      variant="meta"
      as="p"
      class="px-2"
      data-test="assistant-history-retention"
    >
      {{ retentionLine }}
    </OText>
    <template v-if="downloadable || $slots.shares || clearable">
      <OSeparator />
      <div class="flex min-w-0 flex-wrap items-center gap-1 px-1">
        <OButton
          v-if="downloadable"
          variant="ghost"
          size="sm"
          :icon-left="assistantGlyph.download"
          :loading="downloading"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-history-download-all"
          @click="emit('download-all')"
        >
          {{ t("assistant.history.downloadAll") }}
        </OButton>
        <slot name="shares" />
        <span class="flex-1" />
        <OButton
          v-if="clearable"
          variant="ghost"
          size="sm"
          class="text-status-error-text max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-history-clear-all"
          @click="emit('clear-all')"
        >
          {{ t("assistant.history.clearAll.action") }}
        </OButton>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
export interface AssistantHistoryFooterProps {
  mode: "server" | "local";
  /** Rows exist, so there is something to download or delete. */
  hasRows: boolean;
  /** Older pages remain; the retention line waits for the end of the list. */
  hasMore: boolean;
  retentionDays?: number;
  readonly?: boolean;
  downloading?: boolean;
}
</script>

<script setup lang="ts">
import { computed } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantHistoryFooterProps>(), {
  retentionDays: undefined,
  readonly: false,
  downloading: false,
});

const emit = defineEmits<{ "download-all": []; "clear-all": [] }>();

defineSlots<{ shares?: () => unknown }>();

const { t } = useI18nTyped();

const downloadable = computed(() => props.mode === "local" && props.hasRows);
const clearable = computed(() => props.hasRows && !props.readonly);
const retentionLine = computed(() => {
  if (props.mode !== "server" || props.hasMore || !props.hasRows) return null;
  return props.retentionDays
    ? t("assistant.history.retention", { days: props.retentionDays })
    : t("assistant.history.retentionNone");
});
</script>
