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

<!-- Every analysis attempt failed and none succeeded: a failure, so red; Retry stays secondary. -->
<template>
  <OBanner
    data-test="rca-failed-notice"
    data-variant="error-soft"
    variant="error-soft"
    icon="error-outline"
    inline-actions
  >
    <p data-test="rca-failed-title" class="text-banner-error-soft-text m-0 text-sm font-semibold">
      {{ title }}
    </p>
    <p class="text-banner-error-soft-text m-0 mt-0.5 text-sm">
      <template v-if="short">
        {{ t("alerts.incidents.rcaLight.lastTry", { time: lastTry }) }}
      </template>
      <template v-else>
        {{ t("alerts.incidents.rcaLight.failedText", { reason: firstReason }) }}
      </template>
    </p>
    <template v-if="!short">
      <OButton
        data-test="rca-failed-reasons-toggle"
        variant="ghost-primary"
        size="xs"
        class="mt-1 self-start"
        :aria-expanded="reasonsOpen"
        :aria-controls="reasonsId"
        @click="reasonsOpen = !reasonsOpen"
      >
        {{
          reasonsOpen
            ? t("alerts.incidents.rcaLight.hideWhatWentWrong")
            : t("alerts.incidents.rcaLight.whatWentWrong")
        }}
      </OButton>
      <ul
        v-if="reasonsOpen"
        :id="reasonsId"
        data-test="rca-failed-reasons"
        class="m-0 mt-1 flex max-w-120 list-none flex-col gap-0.5 p-0"
      >
        <li
          v-for="item in failed.reasons"
          :key="item.reason"
          data-test="rca-failed-reason"
          class="text-banner-error-soft-text flex justify-between gap-4 text-xs"
        >
          <span>{{ reasonText(item.reason) }}</span>
          <span class="tabular-nums">{{
            t("alerts.incidents.rcaLight.reasonCount", { count: item.count }, item.count)
          }}</span>
        </li>
      </ul>
    </template>
    <template #actions>
      <OButton
        v-if="short"
        data-test="rca-failed-open-analysis"
        variant="outline"
        size="sm"
        icon-left="arrow-forward"
        @click="$emit('open-analysis')"
      >
        {{ t("alerts.incidents.rcaLight.goToAnalysis") }}
      </OButton>
      <OTooltip v-else :content="startLockedReason" :disabled="!startLockedReason">
        <span class="inline-flex">
          <OButton
            data-test="rca-failed-retry"
            variant="outline"
            size="sm"
            :icon-left="startLockedReason ? 'lock' : 'refresh'"
            :loading="retrying"
            :disabled="!!startLockedReason"
            @click="$emit('retry')"
          >
            {{ t("alerts.incidents.rcaLight.retryAnalysis") }}
          </OButton>
        </span>
      </OTooltip>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import { timezoneAbbr } from "@/utils/formatters";
import type { RcaFailReason, RcaFailedAnalyses } from "./rcaLight";

const props = withDefaults(
  defineProps<{
    failed: RcaFailedAnalyses;
    /** The app's time zone. */
    timezone?: string;
    /** The Report tab's pointer to Incident Analysis, without Retry or reasons. */
    short?: boolean;
    retrying?: boolean;
    /** Why no new run can start: Retry stays visible, disabled, with this reason. */
    startLockedReason?: I18nText;
  }>(),
  { timezone: "UTC", short: false, retrying: false, startLockedReason: undefined },
);

defineEmits<{ retry: []; "open-analysis": [] }>();

const { t } = useI18nTyped();
const reasonsOpen = ref(false);
const reasonsId = useId();

const lastTry = computed(() => {
  const at = props.failed.lastAt;
  return `${formatTimestampInTimezone(at, "MMM D, HH:mm", props.timezone)} ${timezoneAbbr(props.timezone, new Date(at / 1000))}`;
});

const title = computed(() => {
  const count = props.failed.attempts;
  return props.short
    ? t("alerts.incidents.rcaLight.noReportFailed", { count }, count)
    : t("alerts.incidents.rcaLight.failedTitle", { count, time: lastTry.value }, count);
});

const reasonText = (reason: RcaFailReason): I18nText => {
  switch (reason) {
    case "noResponse":
      return t("alerts.incidents.rcaLight.failReason.noResponse");
    case "reanalysisNoStart":
      return t("alerts.incidents.rcaLight.failReason.reanalysisNoStart");
    case "noStart":
      return t("alerts.incidents.rcaLight.failReason.noStart");
    case "other":
      return t("alerts.incidents.rcaLight.failReason.other");
  }
};

const firstReason = computed(() => reasonText(props.failed.reasons[0]?.reason ?? "other"));
</script>
