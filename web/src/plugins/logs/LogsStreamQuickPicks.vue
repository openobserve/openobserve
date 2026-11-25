<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="mt-1 w-full">
    <OEmptyState
      data-test="logs-search-no-stream-selected"
      preset="no-stream-selected"
      size="inline"
      icon="database"
    >
      <template v-if="groups.length" #extra>
        <div data-test="logs-search-stream-quick-pick" class="flex w-full flex-col gap-1">
          <template v-for="group in groups" :key="group.id">
            <OSelectHeaderRow
              v-if="group.header"
              :data-test="`logs-search-stream-group-header-${group.id}`"
              :label="group.header.label"
              :count="group.header.headerCount"
              :action="group.header.headerAction"
              :action-aria-label="group.header.headerActionAriaLabel"
              @action="source.onPickerHeaderAction(group.header)"
            />
            <span
              v-else
              :data-test="`logs-search-stream-group-label-${group.id}`"
              class="text-text-secondary mb-0.5 text-left text-xs font-medium"
            >
              {{ group.label }}
            </span>
            <OButton
              v-for="stream in group.streams"
              :key="stream.value"
              :data-test="`logs-search-stream-quick-pick-${stream.value}`"
              variant="outline"
              size="sm"
              icon-left="database"
              class="w-full justify-start"
              @click="source.quickSelectStream(stream.value)"
            >
              <OTruncatedText class="flex-1 text-left">{{ stream.label }}</OTruncatedText>
            </OButton>
          </template>
          <span
            v-if="moreCount > 0"
            data-test="logs-search-stream-quick-pick-more"
            class="text-text-secondary mt-0.5 text-center text-xs"
          >
            {{ t("search.quickPickMoreStreams", { count: moreCount }) }}
          </span>
        </div>
      </template>
    </OEmptyState>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSelectHeaderRow from "@/lib/forms/Select/OSelectHeaderRow.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { LogsFieldSource } from "@/components/common/fieldPanel/useLogsFieldSource";

const props = defineProps<{ source: LogsFieldSource }>();

const { t } = useI18nTyped();

const groups = computed(() => props.source.quickPickGroups.value);
const moreCount = computed(() => props.source.quickPickMoreCount.value);
</script>
