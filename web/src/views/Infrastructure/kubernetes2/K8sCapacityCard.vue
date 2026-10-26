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
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { formatBytes, formatPct } from "./kubernetesModel";
import { capacityScale, pctOf } from "./overviewModel";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import { SEGMENT_SWATCH } from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import type {
  SegmentedBarMarker,
  SegmentedBarSegment,
} from "@/lib/data/SegmentedBar/OSegmentedBar.types";

const props = defineProps<{
  kind: "cpu" | "memory";
  usage: number | null;
  requests: number | null;
  limits: number | null;
  allocatable: number | null;
}>();

const { t } = useI18nTyped();

const scale = computed(() =>
  capacityScale(props.usage, props.requests, props.limits, props.allocatable),
);

const columns = computed(() =>
  [
    {
      id: "usage",
      label: t("infra.k8s2.overviewUsage"),
      value: props.usage,
      swatch: SEGMENT_SWATCH.default,
    },
    {
      id: "requests",
      label: t("infra.k8s2.overviewRequests"),
      value: props.requests,
      swatch: SEGMENT_SWATCH.info,
    },
    {
      id: "limits",
      label: t("infra.k8s2.overviewLimits"),
      value: props.limits,
      swatch: SEGMENT_SWATCH.danger,
    },
  ].map((col) => ({
    ...col,
    text: valueText(col.value),
    over: col.id === "limits" && !!scale.value?.overPct,
  })),
);

const segments = computed<SegmentedBarSegment[]>(() => [
  { id: "usage", pct: scale.value?.usagePct ?? 0, variant: "default" },
]);

const markers = computed<SegmentedBarMarker[]>(() => {
  const s = scale.value;
  if (!s) return [];
  const out: SegmentedBarMarker[] = [
    { id: "allocatable", pct: s.allocatablePct, variant: "contrast" },
  ];
  if (s.requestsPct != null) {
    out.push({ id: "requests", pct: s.requestsPct, variant: "info" });
  }
  if (s.limitsPct != null) out.push({ id: "limits", pct: s.limitsPct, variant: "danger" });
  return out;
});

function valueText(value: number | null): I18nText {
  if (value == null) return raw("—");
  const pct = formatPct(pctOf(value, props.allocatable));
  return props.kind === "cpu"
    ? t("infra.k8s2.overviewCoresPct", { value: value.toFixed(2), pct })
    : t("infra.k8s2.overviewBytesPct", { value: formatBytes(value), pct });
}

const allocatableText = computed<I18nText>(() => {
  if (props.allocatable == null) return raw("—");
  return props.kind === "cpu"
    ? t("infra.k8s2.overviewAllocatableCores", { value: props.allocatable.toFixed(2) })
    : t("infra.k8s2.overviewAllocatableBytes", { value: formatBytes(props.allocatable) });
});
</script>

<template>
  <section
    class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-3 border p-3"
    :data-test="`k8s2-overview-${kind}-card`"
  >
    <div class="flex min-w-0 items-baseline justify-between gap-2">
      <OText variant="card-title">{{
        kind === "cpu" ? t("infra.k8s2.overviewCpu") : t("infra.k8s2.overviewMemory")
      }}</OText>
      <OText
        variant="meta"
        class="text-text-secondary"
        :data-test="`k8s2-overview-${kind}-allocatable`"
        >{{ allocatableText }}</OText
      >
    </div>
    <OSegmentedBar
      :segments="segments"
      :markers="markers"
      size="md"
      :data-test="`k8s2-overview-${kind}-bar`"
    />
    <div class="grid grid-cols-3 gap-2">
      <div
        v-for="col in columns"
        :key="col.id"
        class="flex min-w-0 flex-col gap-0.5"
        :data-test="`k8s2-overview-${kind}-${col.id}`"
      >
        <span class="text-text-secondary flex items-center gap-1.5 text-xs">
          <span class="rounded-default size-2 shrink-0" :class="col.swatch" />{{ col.label }}
        </span>
        <span
          class="text-compact font-semibold tabular-nums"
          :class="col.over ? 'text-status-error-text' : 'text-text-heading'"
          >{{ col.text }}</span
        >
      </div>
    </div>
    <div
      v-if="scale?.overPct"
      class="text-status-error-text flex items-start gap-1.5 text-xs"
      :data-test="`k8s2-overview-${kind}-limits-higher`"
    >
      <OIcon name="warning" size="xs" class="mt-0.5 shrink-0" />
      <span>{{ t("infra.k8s2.overviewLimitsOver", { pct: scale.overPct }) }}</span>
    </div>
  </section>
</template>
