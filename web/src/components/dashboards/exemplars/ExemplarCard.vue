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
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import { formatTimestampInTimezone } from "@/utils/date";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import { INTERNAL_FIELDS } from "@/utils/metrics/metricFamily";
import { SPAN_ID_LABEL, TRACE_ID_LABEL } from "@/utils/dashboard/exemplars/buildExemplarMarkers";
import { exemplarCardPosition } from "@/utils/dashboard/exemplars/exemplarCardPosition";
import type { ExemplarMarker, TraceVerdict } from "@/ts/interfaces/exemplars";

export interface ExemplarQueryLabel {
  index: number;
  name: string;
  query: string;
}

const props = withDefaults(
  defineProps<{
    marker: ExemplarMarker;
    queryLabels: ExemplarQueryLabel[];
    unit?: string;
    unitCustom?: string;
    decimals?: number;
    timezone?: string;
    verdict: TraceVerdict;
    anchor?: DOMRect | null;
    clamped?: "top" | "bottom" | false;
  }>(),
  {
    unit: undefined,
    unitCustom: undefined,
    decimals: undefined,
    timezone: "UTC",
    anchor: null,
    clamped: false,
  },
);

const emit = defineEmits<{
  (e: "open-trace"): void;
  (e: "enter"): void;
  (e: "leave"): void;
}>();

const { t } = useI18nTyped();

const formattedValue = computed(() =>
  formatUnitValue(
    getUnitValue(props.marker.value, props.unit ?? "", props.unitCustom ?? "", props.decimals),
  ),
);

const formattedTime = computed(() =>
  formatTimestampInTimezone(
    props.marker.tsMs * 1000,
    "yyyy-MM-dd HH:mm:ss.SSS",
    props.timezone || "UTC",
  ),
);

const tags = computed(() =>
  props.marker.queryIndexes.map(
    (index) =>
      props.queryLabels.find((q) => q.index === index) ?? {
        index,
        name: String(index + 1),
        query: "",
      },
  ),
);

// trace_id sits beside the trace action and span_id is carried by the link, so neither repeats as a row.
const labelEntries = computed(() =>
  Object.entries(props.marker.labels).filter(
    ([key]) => key !== TRACE_ID_LABEL && key !== SPAN_ID_LABEL && !INTERNAL_FIELDS.has(key),
  ),
);

const unverifiedReason = computed(() => {
  if (props.verdict.state !== "unverified") return "";
  switch (props.verdict.reason) {
    case "timeout":
      return t("dashboard.exemplars.unverifiedTimeout");
    case "forbidden":
      return t("dashboard.exemplars.unverifiedForbidden");
    case "partial":
      return t("dashboard.exemplars.unverifiedPartial");
    default:
      return t("dashboard.exemplars.unverifiedError");
  }
});

const CARD_WIDTH_REM = 20;
const position = computed(() => {
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return exemplarCardPosition(
    props.anchor,
    { width: window.innerWidth, height: window.innerHeight },
    CARD_WIDTH_REM * rootPx,
  );
});
</script>

<template>
  <Teleport to="body">
    <div
      class="rounded-surface bg-surface-overlay border-border-subtle fixed z-9999999 flex w-80 max-w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-2 overflow-x-hidden overflow-y-auto border p-3 shadow-md"
      :style="position"
      role="dialog"
      :aria-label="t('dashboard.exemplars.cardTitle')"
      data-test="dashboard-panel-exemplar-tooltip"
      :data-trace-state="verdict.state"
      @mouseenter="emit('enter')"
      @mouseleave="emit('leave')"
    >
      <div class="text-text-secondary text-2xs">{{ t("dashboard.exemplars.cardTitle") }}</div>
      <div
        class="text-text-heading text-lg font-semibold"
        data-test="dashboard-panel-exemplar-value"
      >
        {{ formattedValue }}
      </div>
      <div
        v-if="clamped"
        class="text-text-secondary text-2xs"
        data-test="dashboard-panel-exemplar-clamped-note"
      >
        {{
          clamped === "top"
            ? t("dashboard.exemplars.aboveRange")
            : t("dashboard.exemplars.belowRange")
        }}
      </div>
      <div class="text-text-secondary text-xs" data-test="dashboard-panel-exemplar-time">
        {{ formattedTime }}
      </div>

      <div class="flex flex-wrap items-center gap-1">
        <OTag
          v-for="tag in tags"
          :key="tag.index"
          variant="default-soft"
          size="sm"
          :title="tag.query"
          :data-query-index="tag.index"
          data-test="dashboard-panel-exemplar-query"
        >
          {{ tag.name }}
        </OTag>
        <span
          v-if="tags.length > 1"
          class="text-text-secondary text-xs"
          data-test="dashboard-panel-exemplar-returned-by"
        >
          {{ t("dashboard.exemplars.returnedBy", { count: tags.length }, tags.length) }}
        </span>
      </div>

      <div class="flex flex-col gap-1" data-test="dashboard-panel-exemplar-trace">
        <div
          v-if="verdict.state === 'none'"
          class="text-text-secondary text-2xs"
          data-test="dashboard-panel-exemplar-no-trace"
        >
          {{ t("dashboard.exemplars.noTraceId", { label: raw("trace_id") }) }}
        </div>
        <div
          v-else-if="verdict.state === 'not_available'"
          class="text-text-secondary flex min-w-0 items-start gap-1.5 text-xs break-words whitespace-normal"
          aria-disabled="true"
          data-test="dashboard-panel-exemplar-trace-unavailable"
        >
          <OIcon name="info-outline" size="xs" class="mt-0.5 shrink-0" />
          <span class="min-w-0">{{ t("dashboard.exemplars.traceNotAvailable") }}</span>
        </div>
        <div v-else class="flex min-w-0 flex-wrap items-center gap-2">
          <OButton
            v-if="verdict.state === 'checking'"
            variant="outline"
            size="sm"
            disabled
            data-test="dashboard-panel-exemplar-trace-checking"
          >
            <template #icon-left><OSpinner size="xs" /></template>
            {{ t("dashboard.exemplars.checkingTrace") }}
          </OButton>
          <OButton
            v-else-if="verdict.state === 'found'"
            variant="primary"
            size="sm"
            icon-left="account-tree"
            data-test="dashboard-panel-exemplar-open-trace"
            @click="emit('open-trace')"
          >
            {{ t("dashboard.exemplars.openTrace") }}
          </OButton>

          <OButton
            v-else-if="verdict.state === 'unverified'"
            variant="outline"
            size="sm"
            icon-left="account-tree"
            :data-reason="verdict.reason"
            data-test="dashboard-panel-exemplar-open-trace-unverified"
            @click="emit('open-trace')"
          >
            {{ t("dashboard.exemplars.openTraceUnverified") }}
          </OButton>
        </div>
        <div
          v-if="marker.traceId"
          class="text-text-secondary text-2xs min-w-0 font-mono break-all whitespace-normal select-text"
          data-test="dashboard-panel-exemplar-trace-id"
        >
          {{ marker.traceId }}
        </div>
        <div v-if="verdict.state === 'found'" class="text-text-secondary text-2xs">
          {{ t("dashboard.exemplars.openTraceHint") }}
        </div>
        <div
          v-else-if="verdict.state === 'unverified'"
          class="text-text-secondary text-2xs break-words whitespace-normal"
          data-test="dashboard-panel-exemplar-unverified-reason"
        >
          {{ unverifiedReason }}
        </div>
      </div>

      <template v-if="labelEntries.length">
        <OSeparator />
        <ODescriptionList dense data-test="dashboard-panel-exemplar-labels">
          <ODescriptionItem
            v-for="[key, value] in labelEntries"
            :key="key"
            :label="raw(key)"
            stacked
            :data-test="`dashboard-panel-exemplar-label-${key}`"
          >
            <template #label>
              <span class="text-text-secondary text-2xs font-mono">{{ key }}</span>
            </template>
            <span class="text-text-body text-2xs font-mono break-all select-text">{{ value }}</span>
          </ODescriptionItem>
        </ODescriptionList>
      </template>
    </div>
  </Teleport>
</template>
