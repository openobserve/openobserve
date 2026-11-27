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
    v-if="streams.length > 0"
    class="border-border-default mt-1 border-t pt-1"
    data-test="telemetry-correlation-no-data-group"
  >
    <OButton
      variant="ghost"
      size="chip"
      class="text-text-secondary w-full justify-start gap-1.5 px-2 text-xs"
      :aria-expanded="open"
      :aria-controls="listId"
      data-test="telemetry-correlation-no-data-group-toggle"
      @click="emit('update:open', !open)"
    >
      <OIcon :name="open ? 'expand-more' : 'chevron-right'" size="sm" />
      <span>{{ t("correlation.noDataInScope") }}</span>
      <OTag type="fieldTag" class="ms-1">{{ streams.length }}</OTag>
    </OButton>
    <div :id="listId">
      <template v-if="open">
        <p class="text-text-secondary m-0 px-2 ps-7 pb-1 text-xs">
          {{ t("correlation.noDataInScopeReason") }}
        </p>
        <div
          v-for="stream in streams"
          :key="stream.stream_name"
          data-test="telemetry-correlation-metric-stream-item"
          class="hover:bg-surface-subtle flex cursor-pointer items-center gap-2 px-2 py-1"
          @click="emit('toggle', stream)"
        >
          <div class="flex shrink-0 items-center">
            <OCheckbox
              :model-value="selectedNames.has(stream.stream_name)"
              size="xs"
              @update:model-value="emit('toggle', stream)"
            />
          </div>
          <OTruncatedText class="text-text-secondary! min-w-0 flex-1 cursor-pointer text-sm">{{
            stream.stream_name
          }}</OTruncatedText>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useId } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { StreamInfo } from "@/services/service_streams";

defineProps<{
  streams: StreamInfo[];
  selectedNames: Set<string>;
  open: boolean;
}>();

const listId = useId();

const emit = defineEmits<{
  "update:open": [value: boolean];
  toggle: [stream: StreamInfo];
}>();

const { t } = useI18nTyped();
</script>
