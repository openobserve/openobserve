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
  <section class="flex flex-col gap-2" data-test="alerts-firing-history">
    <div class="flex items-center gap-2">
      <span class="text-text-heading flex-1 text-sm font-semibold">
        {{ t("alerts.firing.drawer.history") }} {{ raw("·") }} {{ windowLabel }}
      </span>
      <router-link
        v-if="viewAll"
        :to="viewAll"
        class="text-text-link text-xs underline"
        data-test="alerts-firing-history-view-all"
      >
        {{ t("alerts.firing.drawer.viewAll") }}
      </router-link>
    </div>

    <OText v-if="failed" variant="meta" data-test="alerts-firing-history-error">
      {{ t("alerts.firing.drawer.historyFailed") }}
    </OText>
    <OText
      v-else-if="!hits.length && !firingStartedAt"
      variant="meta"
      data-test="alerts-firing-history-empty"
    >
      {{ t("alerts.firing.drawer.historyEmpty") }}
    </OText>
    <template v-else>
      <div
        class="flex h-3 w-full gap-px overflow-hidden rounded-full"
        role="img"
        :aria-label="legend"
      >
        <div
          v-for="segment in bar.segments"
          :key="segment.startUs"
          :class="segmentClass[segment.state]"
          :style="{ width: `${segment.pct}%` }"
          :data-test="`alerts-firing-history-segment-${segment.state}`"
        />
      </div>
      <div class="text-text-secondary flex justify-between text-xs tabular-nums">
        <span>{{ raw(timeOf(startUs)) }}</span>
        <span>{{ legend }}</span>
        <span>{{ t("alerts.firing.drawer.now") }}</span>
      </div>
      <ol class="mt-1 flex flex-col">
        <li
          v-for="(event, index) in events"
          :key="`${event.at}-${event.key}`"
          class="flex gap-3"
          data-test="alerts-firing-history-event"
        >
          <span class="text-text-secondary w-12 shrink-0 pt-0.5 text-xs tabular-nums">
            {{ raw(timeOf(event.at)) }}
          </span>
          <div class="flex w-2 shrink-0 flex-col items-center">
            <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="dotClass(event)" />
            <span v-if="index < events.length - 1" class="bg-border-default mt-1 w-px flex-1" />
          </div>
          <div class="flex min-w-0 flex-col pb-3">
            <span class="text-text-heading text-sm">{{ title(event) }}</span>
            <span v-if="detail(event)" class="text-text-secondary text-xs tabular-nums">
              {{ detail(event) }}
            </span>
          </div>
        </li>
      </ol>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";
import OText from "@/lib/core/Typography/OText.vue";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { ackEventText } from "@/utils/alerts/ackState";
import { durationLabel } from "@/utils/alerts/firingAlerts";
import {
  historyEvents,
  statusBar,
  type AlertRun,
  type HistoryEvent,
} from "@/utils/alerts/firingHistory";
import { formatInZone } from "@/utils/oncall";

const WINDOW_US = 2 * 3_600_000_000;
const segmentClass = {
  firing: "bg-badge-error-solid-bg",
  ok: "bg-border-strong",
  unknown: "bg-hatched border-border-strong border border-dashed",
};

const props = defineProps<{
  hits: AlertRun[];
  nowUs: number;
  destinations: string[];
  firingStartedAt?: number;
  /** Absent for what has no detail page to send the user to. */
  viewAll?: RouteLocationRaw;
  failed?: boolean;
  /** The read holds only the newest runs of a longer history. */
  partial?: boolean;
}>();

const { t } = useI18nTyped();
const zone = useViewerTimezone();

const startUs = computed(() =>
  Math.min(props.nowUs - WINDOW_US, props.firingStartedAt ?? props.nowUs),
);
const stretched = computed(() => props.nowUs - startUs.value > WINDOW_US);
const bar = computed(() =>
  statusBar(props.hits, {
    startUs: startUs.value,
    nowUs: props.nowUs,
    firingStartedAt: props.firingStartedAt,
    partial: props.partial,
  }),
);
const events = computed(() =>
  historyEvents(props.hits, {
    // The oldest row of a partial read is the read's edge, not a firing's real start.
    windowStartUs: props.partial ? undefined : startUs.value,
    destinations: props.destinations,
    nowUs: props.nowUs,
    firingStartedAt: props.firingStartedAt,
  }),
);

const windowLabel = computed(() =>
  stretched.value
    ? t("alerts.firing.drawer.lastSpan", {
        span: raw(durationLabel((props.nowUs - startUs.value) / 1000)),
      })
    : t("alerts.firing.drawer.last2h"),
);
const legend = computed(() => {
  const spans: string[] = [];
  if (bar.value.firingMs) {
    spans.push(
      t("alerts.firing.drawer.barFiring", { span: raw(durationLabel(bar.value.firingMs)) }),
    );
  }
  if (bar.value.okMs) {
    spans.push(t("alerts.firing.drawer.barOk", { span: raw(durationLabel(bar.value.okMs)) }));
  }
  if (bar.value.unknownMs) {
    spans.push(
      t("alerts.firing.drawer.barUnknown", { span: raw(durationLabel(bar.value.unknownMs)) }),
    );
  }
  return raw(spans.join(" · "));
});

const timeOf = (micros: number) => formatInZone(micros, zone.value, { timeStyle: "short" });

const title = (event: HistoryEvent): I18nText => {
  const names = raw((event.names ?? []).join(", "));
  switch (event.kind) {
    case "started":
      return t("alerts.firing.drawer.eventStarted");
    case "recovered":
      return t("alerts.firing.drawer.eventRecovered");
    case "ack":
      return ackEventText(event.run ?? { status: "ack_event" }, t);
    case "failed":
      return event.names?.length
        ? t("alerts.firing.drawer.eventFailedTo", { names })
        : t("alerts.firing.drawer.eventFailed");
    default:
      return event.names?.length
        ? t("alerts.firing.drawer.eventNotifiedTo", { names })
        : t("alerts.firing.drawer.eventNotified");
  }
};

const dotClass = (event: HistoryEvent) => {
  if (event.kind === "started" || event.kind === "failed") return "bg-badge-error-solid-bg";
  return event.kind === "recovered" ? "bg-badge-success-solid-bg" : "bg-text-muted";
};

const detail = (event: HistoryEvent) => {
  const parts: string[] = event.condition ? [event.condition] : [];
  if (event.durationMs !== undefined) parts.push(duration(event));
  return raw(parts.join(" · "));
};

const duration = (event: HistoryEvent): I18nText => {
  const span = raw(durationLabel(event.durationMs ?? 0));
  if (event.kind === "recovered") return t("alerts.firing.drawer.okFor", { span });
  return event.open
    ? t("alerts.firing.drawer.soFar", { span })
    : t("alerts.firing.drawer.lasted", { span });
};
</script>
