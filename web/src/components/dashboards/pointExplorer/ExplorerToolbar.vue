<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- The explorer drawer's toolbar: time picker, query toggle, Open in the signal's page, and Run. -->
<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import DateTime from "@/components/DateTime.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { useLicenseLocks } from "@/composables/useFeatureLock";

const props = defineProps<{
  rangeStart: number;
  rangeEnd: number;
  queryLabel: I18nText;
  queryIcon: IconName;
  queryOpen: boolean;
  openLabel: I18nText;
  /** The licence feature the Open in button needs. */
  openFeature: string;
  loading: boolean;
  dataTestPrefix: string;
}>();

const emit = defineEmits<{
  dateChange: [range: { startTime: number; endTime: number }];
  toggleQuery: [];
  open: [];
  run: [];
}>();

const { t } = useI18nTyped();
const licenseLocks = useLicenseLocks();
const openLocked = computed(() => licenseLocks.isLocked(props.openFeature));
const openLockedReason = computed(() =>
  openLocked.value ? licenseLocks.lockedReason(props.openFeature) : raw(""),
);

// DateTime reports its initial value while mounting; only a user's change reruns the search.
let ready = false;
onMounted(() => (ready = true));
const onDateChange = (d: { startTime: number; endTime: number }) => {
  if (!ready) return;
  const startTime = Number.isFinite(d.startTime) ? Math.trunc(d.startTime) : props.rangeStart;
  const endTime = Number.isFinite(d.endTime) ? Math.trunc(d.endTime) : props.rangeEnd;
  if (startTime === props.rangeStart && endTime === props.rangeEnd) return;
  emit("dateChange", { startTime, endTime });
};
</script>

<template>
  <div class="border-border-default flex min-w-0 shrink-0 flex-col border-b">
    <div class="flex min-w-0 items-center gap-2 px-2 pt-3 pb-2">
      <slot name="leading" />
      <div class="flex-1" />
      <DateTime
        default-type="absolute"
        :default-absolute-time="{ startTime: rangeStart, endTime: rangeEnd }"
        :data-test-name="`${dataTestPrefix}-date-time`"
        @on:date-change="onDateChange"
      />
      <OButton
        size="sm"
        :variant="queryOpen ? 'primary' : 'outline'"
        :icon-left="queryIcon"
        :data-test="`${dataTestPrefix}-query-toggle`"
        @click="emit('toggleQuery')"
      >
        {{ queryLabel }}
      </OButton>
      <OTooltip v-if="openLocked" :content="openLockedReason">
        <span class="inline-flex">
          <OButton size="sm" variant="outline" disabled :data-test="`${dataTestPrefix}-open`">
            <template #icon-left>
              <OIcon
                name="lock"
                class="text-icon-locked"
                size="sm"
                :data-test="`${dataTestPrefix}-open-lock`"
              />
            </template>
            {{ openLabel }}
          </OButton>
        </span>
      </OTooltip>
      <OButton
        v-else
        size="sm"
        variant="outline"
        icon-left="open-in-new"
        :data-test="`${dataTestPrefix}-open`"
        @click="emit('open')"
      >
        {{ openLabel }}
      </OButton>
      <OButton
        size="icon-sm"
        variant="outline"
        icon-left="refresh"
        :loading="loading"
        :aria-label="t('panel.logExplorer.runQuery')"
        :data-test="`${dataTestPrefix}-run`"
        @click="emit('run')"
      >
        <OTooltip :content="t('panel.logExplorer.runQuery')" />
      </OButton>
    </div>
    <slot />
  </div>
</template>
