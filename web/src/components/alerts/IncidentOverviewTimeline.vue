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
  <OCard variant="glass" data-test="incident-overview-timeline">
    <OCardSection role="header" dense class="justify-between gap-3">
      <h2 class="text-text-heading text-sm font-semibold">
        {{ t("alerts.incidents.overview.timeline") }}
      </h2>
      <span class="flex min-w-0 items-center gap-2 text-xs">
        <span class="text-text-secondary shrink-0">{{ t("alerts.incidents.incidentId") }}</span>
        <OTruncatedText
          class="text-text-body font-mono"
          :tooltip="false"
          data-test="incident-overview-id"
          >{{ incident.id }}</OTruncatedText
        >
        <OButton
          variant="ghost"
          size="icon-xs-sq"
          icon-left="content-copy"
          :aria-label="t('alerts.incidents.overview.copyId')"
          data-test="incident-overview-copy-id"
          @click="copyToClipboard(incident.id, t)"
          ><OTooltip :content="t('alerts.incidents.overview.copyId')"
        /></OButton>
      </span>
    </OCardSection>
    <OCardSection role="body" dense class="flex flex-col gap-4">
      <ol class="relative grid grid-cols-3 gap-x-6">
        <span
          class="border-border-default absolute inset-x-0 top-1.25 border-t"
          aria-hidden="true"
        />
        <li
          v-for="step in steps"
          :key="step.key"
          class="relative flex min-w-0 flex-col gap-0.5"
          :data-test="`incident-overview-step-${step.key}`"
        >
          <span class="mb-2 size-2.5 rounded-full" :class="step.dot" aria-hidden="true" />
          <span class="text-text-secondary text-xs">{{ step.label }}</span>
          <span class="text-text-heading text-sm font-semibold tabular-nums">{{ step.time }}</span>
          <span class="text-text-secondary text-xs">{{ step.note }}</span>
        </li>
      </ol>
      <dl class="border-border-default grid grid-cols-3 gap-x-6 border-t pt-3">
        <div v-for="fact in facts" :key="fact.key" class="flex min-w-0 flex-col gap-0.5">
          <dt class="text-text-secondary text-xs">{{ fact.label }}</dt>
          <dd class="text-text-body text-sm" :data-test="`incident-overview-fact-${fact.key}`">
            {{ fact.value }}
          </dd>
        </div>
      </dl>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { getIntlLocale } from "@/locales";
import type { IncidentAlert, IncidentWithAlerts } from "@/services/incidents";
import {
  incidentAge,
  incidentFiringCounts,
  incidentTime,
  unfoldDuration,
} from "@/utils/incidents/incidentUnfold";
import { firingRate, incidentMoment, peakWindow } from "@/utils/incidents/incidentOverview";

const props = defineProps<{
  incident: Pick<
    IncidentWithAlerts,
    "id" | "status" | "first_alert_at" | "last_alert_at" | "updated_at" | "key_type"
  >;
  triggers: IncidentAlert[];
  zone: string;
  /** The header's server clock, microseconds. */
  now: number;
  correlatedBy: string;
}>();

const { t } = useI18nTyped();

const age = (us: number) => raw(incidentAge(us, props.now));
const clock = (us: number | undefined) => (us ? raw(incidentTime(props.zone, us)) : raw("—"));

const steps = computed(() => {
  const peak = peakWindow(props.triggers);
  const { first_alert_at: first, last_alert_at: last, status } = props.incident;
  return [
    {
      key: "first",
      label: t("alerts.incidents.overview.firstFiring"),
      time: clock(first),
      note: first ? age(first) : raw(""),
      dot: "bg-timeline-dot-success",
    },
    {
      key: "peak",
      label: t("alerts.incidents.overview.peak"),
      time: clock(peak?.at),
      note: peak
        ? t(
            "alerts.incidents.overview.peakWindow",
            { count: peak.count, window: unfoldDuration(t, peak.windowUs), age: age(peak.at) },
            peak.count,
          )
        : raw(""),
      dot: "bg-status-warning-text",
    },
    {
      key: "latest",
      label: t("alerts.incidents.overview.latestFiring"),
      time: clock(last),
      note: last ? age(last) : raw(""),
      dot: status === "resolved" ? "bg-timeline-dot-success" : "bg-timeline-dot-destructive",
    },
  ];
});

const facts = computed(() => {
  const { first_alert_at: first, last_alert_at: last, updated_at: updated } = props.incident;
  const span = first && last ? last - first : 0;
  const { firings } = incidentFiringCounts(props.triggers);
  const rate = firingRate(t, firings, span, getIntlLocale());
  const duration = unfoldDuration(t, span);
  return [
    {
      key: "active",
      label: t("alerts.incidents.overview.activeFor"),
      value: rate ? t("alerts.incidents.overview.activeForRate", { duration, rate }) : duration,
    },
    {
      key: "updated",
      label: t("alerts.incidents.overview.lastUpdate"),
      value: updated ? incidentMoment(t, props.zone, updated, props.now) : raw("—"),
    },
    {
      key: "correlated",
      label: t("alerts.incidents.overview.correlatedBy"),
      value: raw(props.correlatedBy),
    },
  ];
});
</script>
