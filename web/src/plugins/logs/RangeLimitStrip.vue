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
  <div class="flex h-full min-h-0 flex-col">
    <div
      role="alert"
      class="bg-status-warning-bg text-text-body border-border-default flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-0 border-b border-solid px-3 py-1.5 text-xs"
      :data-test="dataTest"
    >
      <OIcon name="warning" size="xs" class="text-warning shrink-0" aria-hidden="true" />
      <span class="min-w-0">{{ text }}</span>
      <OButton
        variant="outline"
        size="xs"
        class="ms-auto shrink-0"
        :data-test="`${dataTest}-show-btn`"
        @click="emit('show', refusal.allowedPeriod)"
        >{{ t("dateTime.showRange", { range: allowedLabel }) }}</OButton
      >
      <OButton
        variant="ghost"
        size="xs"
        class="text-text-link shrink-0"
        :data-test="`${dataTest}-pick-btn`"
        @click="emit('pick')"
        >{{ t("dateTime.pickARange") }}</OButton
      >
    </div>
    <p class="text-text-secondary m-0 py-10 text-center text-sm" :data-test="nothingRunTest">
      {{ t("dateTime.nothingWasRun") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { getIntlLocale } from "@/locales";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { RangeLimitRefusal } from "@/utils/logs/rangeLimitRefusal";
import { formatRangeLabel } from "@/utils/timeRangeLabel";
import { formatPeriodLabel } from "@/utils/timeRangeRail";

const props = defineProps<{
  refusal: RangeLimitRefusal;
  timezone?: string | null;
  dataTest: string;
  nothingRunTest: string;
}>();
const emit = defineEmits<{ show: [period: string]; pick: [] }>();
const { t } = useI18nTyped();

const askedLabel = computed(() =>
  props.refusal.period
    ? formatPeriodLabel(props.refusal.period, props.timezone, t, getIntlLocale())
    : raw(
        formatRangeLabel(
          { startUs: props.refusal.asked.startUs, endUs: props.refusal.asked.endUs },
          { timezone: props.timezone, surface: "summary", locale: getIntlLocale() },
        ),
      ),
);
const allowedLabel = computed(() =>
  formatPeriodLabel(props.refusal.allowedPeriod, props.timezone, t, getIntlLocale()),
);
const text = computed(() =>
  t("dateTime.linkOverLimit", {
    range: askedLabel.value,
    name: props.refusal.stream,
    limit: props.refusal.allowed,
  }),
);
</script>
