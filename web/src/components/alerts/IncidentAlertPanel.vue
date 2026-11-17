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
  <ODrawer
    :open="open ?? !!summary"
    side="right"
    size="md"
    seamless
    :modal="false"
    :show-close="false"
    :anchor="anchor"
    :aria-label="summary ? raw(summary.name) : undefined"
    data-test="incident-alert-panel"
    @update:open="(open: boolean) => !open && emit('close')"
  >
    <template #header>
      <div
        v-if="summary"
        class="flex min-w-0 flex-col gap-1"
        data-test="incident-alert-panel-header"
      >
        <div class="flex min-w-0 items-start gap-2">
          <OIcon name="notifications" size="sm" class="mt-0.5" :class="TONE_INK[summary.tone]" />
          <OTruncatedText
            :lines="2"
            class="text-text-heading text-base font-semibold break-words"
            data-test="incident-alert-panel-name"
            ><template v-for="(part, i) in identifierBreaks(summary.name)" :key="i"
              ><wbr v-if="i" />{{ part }}</template
            ></OTruncatedText
          >
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="close"
            class="ms-auto shrink-0"
            :aria-label="t('components.drawer.closeDrawer')"
            data-test="incident-alert-panel-close"
            @click="emit('close')"
          />
        </div>
        <div class="flex min-w-0 flex-wrap items-center gap-2 ps-6">
          <OText v-if="place" variant="meta">{{ place }}</OText>
          <OTag
            v-if="summary.tag"
            :variant="summary.tone === 'danger' ? 'error-soft' : 'primary-soft'"
            size="sm"
            icon="flag"
            :label="t(summary.tag)"
            data-test="incident-alert-panel-tag"
          />
        </div>
      </div>
    </template>

    <div v-if="summary" class="flex flex-col gap-5" data-test="incident-alert-panel-body">
      <section class="flex flex-col gap-1.5" data-test="incident-alert-panel-incident">
        <div class="flex min-w-0 items-center gap-2">
          <p class="text-text-body m-0 min-w-0 flex-1 text-sm tabular-nums">
            <span class="text-text-heading font-semibold" data-test="incident-alert-panel-count"
              >{{ countText }}<OTooltip :content="countTooltip"
            /></span>
            <span> · {{ rangeText }}</span>
            <span v-if="everyText"> · {{ everyText }}</span>
          </p>
          <OSkeleton
            v-if="nativeAlert && rowsState === 'loading'"
            animation="none"
            class="h-5 w-24 shrink-0 rounded-full"
            :aria-label="t('common.loading')"
          />
          <span
            v-else-if="nativeAlert && rowsState === 'error'"
            class="inline-flex shrink-0 items-center gap-1"
            data-test="incident-alert-panel-state-error"
          >
            <OTag variant="error-soft" size="sm" :label="t('alerts.incidents.panel.stateError')" />
            <OButton
              variant="ghost-primary"
              size="xs"
              data-test="incident-alert-panel-state-retry"
              @click="emit('retry-state')"
              >{{ t("common.retry") }}</OButton
            >
          </span>
          <span
            v-else-if="nativeAlert"
            class="inline-flex shrink-0 cursor-default"
            data-test="incident-alert-panel-state"
          >
            <OTag :variant="stateChip.variant" :dot="stateChip.dot" size="sm"
              >{{ stateChip.label }}<OIcon name="info-outline" size="xs" aria-hidden="true"
            /></OTag>
            <OTooltip :content="stateChip.tooltip" />
          </span>
        </div>
        <div
          v-if="summary.histogram"
          class="flex flex-col gap-1"
          data-test="incident-alert-panel-histogram"
        >
          <OSparkline
            :points="summary.histogram.points"
            shape="bar"
            size="sm"
            :tone="SPARK_TONE[summary.tone]"
            :aria-label="summary.histogram.caption"
          />
          <div class="text-text-secondary flex justify-between text-xs tabular-nums">
            <span v-for="(tick, i) in summary.histogram.ticks" :key="i">{{ tick }}</span>
          </div>
        </div>
        <router-link
          v-if="firedAgain"
          :to="firedAgain.to"
          class="text-accent inline-flex w-fit items-center gap-1 text-xs hover:underline"
          data-test="incident-alert-panel-fired-again"
          >{{ firedAgain.label }}<OIcon name="arrow-forward" size="xs" aria-hidden="true"
        /></router-link>
      </section>

      <section v-if="nativeAlert" class="flex flex-col gap-2" data-test="incident-alert-panel-week">
        <div class="flex items-center gap-2">
          <h4 class="text-text-heading m-0 flex-1 text-sm font-semibold">
            {{ t("alerts.incidents.panel.lastWeek") }}
          </h4>
          <span
            v-if="week?.complete && week.total"
            class="text-text-secondary inline-flex cursor-default items-center gap-1 text-xs tabular-nums"
            data-test="incident-alert-panel-week-total"
          >
            <span class="text-text-heading text-sm font-semibold">{{ n(week.total) }}</span>
            <span>· {{ weekDaysText }}</span>
            <OIcon name="info-outline" size="xs" aria-hidden="true" />
            <OTooltip :content="weekTooltip" />
          </span>
        </div>
        <OSkeleton
          v-if="weekQuery.isPending.value"
          animation="none"
          class="h-16 w-full"
          :aria-label="t('common.loading')"
          data-test="incident-alert-panel-week-loading"
        />
        <OBanner
          v-else-if="weekQuery.isError.value"
          variant="error-soft"
          icon="error-outline"
          dense
          inline-actions
          class="h-16"
          :content="weekError"
          data-test="incident-alert-panel-week-error"
        >
          <template #actions>
            <OButton
              variant="outline"
              size="xs"
              icon-left="refresh"
              data-test="incident-alert-panel-week-retry"
              @click="weekQuery.refetch()"
              >{{ t("alerts.incidents.panel.tryAgain") }}</OButton
            >
          </template>
        </OBanner>
        <OBanner
          v-else-if="week && !week.complete"
          variant="error-soft"
          icon="error-outline"
          dense
          class="h-16"
          data-test="incident-alert-panel-week-incomplete"
        >
          <span>{{ t("alerts.incidents.panel.weekIncomplete") }}</span>
          <div class="flex justify-between text-xs tabular-nums">
            <span v-for="day in week.days" :key="day.day">
              {{ day.known ? n(day.n) : raw("—") }}
              <OTooltip :content="dayTooltip(day)" />
            </span>
          </div>
        </OBanner>
        <div
          v-else-if="week"
          class="flex h-16 flex-col gap-1"
          data-test="incident-alert-panel-week-bars"
        >
          <div class="border-border-default relative flex h-11 items-end gap-2 border-b">
            <OTooltip v-for="(day, i) in week.days" :key="day.day" :content="dayTooltip(day)">
              <span
                class="flex h-full flex-1 cursor-default items-end"
                :data-test="`incident-alert-panel-week-day-${i}`"
              >
                <span
                  class="w-full rounded-t-xs"
                  :class="i === week.days.length - 1 ? 'bg-accent/50' : 'bg-accent'"
                  :style="{ height: `${(day.n / weekMax) * 100}%` }"
                />
              </span>
            </OTooltip>
            <span
              v-if="!week.total"
              class="text-text-secondary pointer-events-none absolute inset-0 flex items-center justify-center text-xs"
              >{{ t("alerts.incidents.panel.weekNone") }}</span
            >
          </div>
          <div class="text-text-secondary flex justify-between text-xs tabular-nums">
            <span>{{ dayLabel(week.days[0].at) }}</span>
            <span>{{ t("alerts.incidents.panel.today") }}</span>
          </div>
        </div>
      </section>

      <section v-if="nativeAlert" class="flex flex-col gap-2" data-test="incident-alert-panel-why">
        <h4 class="text-text-heading m-0 text-sm font-semibold">
          {{ t("alerts.incidents.panel.whyFired") }}
        </h4>
        <OSkeleton
          v-if="!info && definition.isPending.value"
          animation="none"
          class="h-16 w-full"
        />
        <OBanner
          v-else-if="!info"
          variant="error-soft"
          icon="error-outline"
          dense
          inline-actions
          class="h-16"
          :content="t('alerts.incidents.panel.definitionError')"
        >
          <template #actions>
            <OButton
              variant="outline"
              size="xs"
              icon-left="refresh"
              data-test="incident-alert-panel-why-retry"
              @click="definition.refetch()"
              >{{ t("alerts.incidents.panel.tryAgain") }}</OButton
            >
          </template>
        </OBanner>
        <template v-else>
          <div v-if="info.description" class="flex flex-col items-start gap-0.5">
            <p
              ref="descriptionEl"
              class="text-text-body m-0 text-sm"
              :class="descriptionOpen ? '' : 'line-clamp-2'"
              data-test="incident-alert-panel-description"
            >
              {{ raw(info.description) }}
            </p>
            <OButton
              v-if="descriptionClamped || descriptionOpen"
              variant="ghost-primary"
              size="xs"
              :aria-expanded="descriptionOpen"
              data-test="incident-alert-panel-description-toggle"
              @click="descriptionOpen = !descriptionOpen"
              >{{
                descriptionOpen
                  ? t("alerts.incidents.rcaLight.showLess")
                  : t("alerts.incidents.rcaLight.showMore")
              }}</OButton
            >
          </div>
          <div class="flex min-h-6 items-center gap-1.5">
            <OSkeleton
              v-if="valueLine === 'loading'"
              animation="none"
              class="h-5 w-48"
              data-test="incident-alert-panel-value-loading"
            />
            <OInlineNotice
              v-else-if="lastHit.isError.value"
              variant="error"
              :text="t('alerts.incidents.panel.valueError')"
              :action-label="t('alerts.incidents.panel.tryAgain')"
              data-test="incident-alert-panel-value-error"
              action-data-test="incident-alert-panel-value-retry"
              @action="lastHit.refetch()"
            />
            <p
              v-else
              class="text-text-body m-0 text-sm tabular-nums"
              data-test="incident-alert-panel-value"
            >
              <template v-if="valueLine"
                ><span class="text-text-heading font-semibold"
                  >{{ valueLine.value
                  }}<OTooltip
                    v-if="valueLine.capped"
                    :content="t('alerts.incidents.panel.rowCap', { value: valueLine.raw })" /></span
                >{{ " " }}{{ t("alerts.incidents.panel.valueAt", { time: valueLine.at })
                }}<template v-if="needs"> · {{ needs }}</template></template
              ><template v-else-if="needsLead">{{ needsLead }}</template>
            </p>
            <span
              v-if="valueLine !== 'loading'"
              class="text-text-secondary inline-flex shrink-0 cursor-default"
              data-test="incident-alert-panel-schedule"
              ><OIcon name="info-outline" size="xs" :aria-label="scheduleTooltip" /><OTooltip
                :content="scheduleTooltip"
            /></span>
          </div>
          <div v-if="query" class="flex min-w-0 items-start gap-1.5">
            <OCollapsible
              v-model="queryOpen"
              class="border-border-default rounded-default min-w-0 flex-1 border"
              data-test="incident-alert-panel-query"
            >
              <template #trigger>
                <span class="flex min-w-0 items-center gap-2 font-mono text-xs">
                  <span class="text-text-secondary shrink-0">{{ query.label }}</span>
                  <span v-if="!queryOpen" class="text-text-body truncate">{{
                    raw(query.code)
                  }}</span>
                </span>
              </template>
              <OCodeBlock
                :code="query.code"
                lang="plaintext"
                chrome="editor"
                :filename="query.label"
                wrap
                inset
                data-test="incident-alert-panel-query-code"
              />
            </OCollapsible>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="content-copy"
              :aria-label="t('alerts.incidents.panel.copyQuery')"
              data-test="incident-alert-panel-query-copy"
              @click="copyQuery"
              ><OTooltip :content="t('alerts.incidents.panel.copyQuery')"
            /></OButton>
          </div>
        </template>
      </section>

      <section v-if="nativeAlert" data-test="incident-alert-panel-notifies">
        <OSkeleton v-if="definition.isPending.value" animation="none" class="h-4 w-48" />
        <p
          v-else-if="definitionData"
          class="text-text-body m-0 inline-flex cursor-default items-center gap-1.5 text-sm"
        >
          <OIcon name="notifications" size="xs" class="text-text-secondary" aria-hidden="true" />
          <span>{{ notifiesText }}</span>
          <OTooltip v-if="notifiesTooltip" :content="notifiesTooltip" />
        </p>
      </section>
    </div>

    <template #footer>
      <div v-if="summary" class="flex w-full justify-end gap-2">
        <OButton
          v-if="!nativeAlert && summary.sourceUrl"
          as="a"
          variant="outline"
          size="sm"
          icon-left="open-in-new"
          :href="summary.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          data-test="incident-alert-panel-source"
          >{{ t("alerts.incidents.panel.openSource") }}</OButton
        >
        <OButton
          v-if="logsHref"
          as="a"
          variant="outline"
          size="sm"
          icon-left="open-in-new"
          :href="logsHref"
          target="_blank"
          rel="noopener"
          data-test="incident-alert-panel-logs"
          >{{ t("alerts.incidents.panel.viewLogs") }}<OTooltip :content="logsTooltip"
        /></OButton>
        <OButton
          variant="outline"
          size="sm"
          icon-left="open-in-new"
          v-if="nativeAlert"
          data-test="incident-alert-panel-open-alert"
          @click="openAlert"
          >{{ t("alerts.incidents.panel.openAlert") }}</OButton
        >
      </div>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import { isElementTruncated } from "@/lib/overlay/Tooltip/useIsTruncated";
import alertsService from "@/services/alerts";
import type { SparklineTone } from "@/lib/data/Sparkline/OSparkline.types";
import type { UnfoldTone } from "@/components/autoobserve/unfold.types";
import { LIVE_STALE_TIME, useOrgId } from "@/composables/query";
import { getIntlLocale } from "@/locales";
import {
  alertDetailQuery,
  alertHistoryQuery,
  alertHistorySummaryQuery,
  alertSqlQuery,
} from "@/services/alerts.queries";
import { alertKeys } from "@/services/alerts.querykeys";
import { incidentsQuery } from "@/services/incidents.queries";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { formatTimestampInTimezone } from "@/utils/date";
import { identifierBreaks, timezoneAbbr } from "@/utils/formatters";
import { b64EncodeUnicode } from "@/utils/zincutils";
import {
  alertNeedsWords,
  alertQueryOf,
  alertScheduleWords,
  firingRange,
  firingValueOf,
  firingValueWords,
  isRowCount,
  lastWeekOf,
  lastWeekWindow,
  WEEK_BUCKET_SECONDS,
  type FiringHit,
  type IncidentAlertListRow,
  type PanelDefinition,
  type WeekDay,
} from "@/utils/incidents/incidentAlertPanel";
import {
  alertLiveState,
  alertLiveWords,
  incidentTime,
  unfoldDuration,
  type IncidentAlertSummary,
} from "@/utils/incidents/incidentUnfold";

const props = withDefaults(
  defineProps<{
    /** The alert shown; the page keeps the last one while the panel slides out. */
    summary: IncidentAlertSummary | null;
    /** Open or closed; unset follows `summary`. */
    open?: boolean;
    /** The alert's row in the alert list; unset while it loads, or when the list lacks it. */
    row?: IncidentAlertListRow;
    rowsState: "loading" | "error" | "ready";
    /** This incident, so a later firing elsewhere can link to its own. */
    incidentId: string;
    zone: string;
    /** Microseconds. */
    now: number;
    anchor?: HTMLElement | null;
  }>(),
  { open: undefined, row: undefined, anchor: undefined },
);

const emit = defineEmits<{ close: []; "retry-state": [] }>();

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();
const locale = computed(() => getIntlLocale());
const n = (value: number) => value.toLocaleString(locale.value);

const MINUTE_US = 60_000_000;
const OTHER_INCIDENTS = 50;
const NEAR_FIRINGS = 50;
const EVALUATION_WINDOW_US = 15 * MINUTE_US;

const TONE_INK: Record<UnfoldTone, string> = {
  danger: "text-status-error-text",
  warning: "text-status-warning-text",
  info: "text-accent",
  success: "text-status-positive",
  neutral: "text-text-secondary",
  team: "text-section-accent-secondary",
};
const SPARK_TONE: Record<UnfoldTone, SparklineTone> = {
  danger: "danger",
  warning: "warning",
  info: "default",
  success: "success",
  neutral: "neutral",
  team: "neutral",
};
const STATE_VARIANT: Record<UnfoldTone, "warning-soft" | "error-soft" | "default-outline"> = {
  danger: "error-soft",
  warning: "warning-soft",
  info: "default-outline",
  success: "default-outline",
  neutral: "default-outline",
  team: "default-outline",
};
const KIND: Record<string, I18nKey> = {
  logs: "alerts.incidents.panel.kind.logs",
  metrics: "alerts.incidents.panel.kind.metrics",
  traces: "alerts.incidents.panel.kind.traces",
};
const QUERY_LABEL: Record<string, I18nKey> = {
  sql: "alerts.incidents.panel.query.sql",
  promql: "alerts.incidents.panel.query.promql",
  custom: "alerts.incidents.panel.query.custom",
};

const nativeAlert = computed(
  () => !props.summary?.alertKind || props.summary.alertKind === "internal",
);
const alertId = computed(() => props.summary?.alertId ?? "");

const definition = useQuery(() =>
  Object.assign(alertDetailQuery(orgId.value, alertId.value), {
    enabled: nativeAlert.value && !!orgId.value && !!alertId.value,
  }),
);
const definitionData = computed(() => definition.data.value as PanelDefinition | undefined);

// The list row paints at once; the alert's own GET fills what the row lacks.
const info = computed(() => {
  if (!nativeAlert.value) return null;
  const def = definitionData.value;
  const row = props.row;
  if (!def && !row) return null;
  return {
    description: def?.description || row?.description,
    streamType: def?.stream_type ?? row?.stream_type,
    streamName: def?.stream_name ?? row?.stream_name,
    owner: def?.owner ?? row?.owner,
    alert: {
      query_condition: def?.query_condition ?? row?.condition,
      trigger_condition: def?.trigger_condition ?? row?.trigger_condition,
    },
    realTime: !!(def?.is_real_time ?? row?.is_real_time),
  };
});

const zoneName = computed(() => timezoneAbbr(props.zone, new Date(props.now / 1000)));
const when = (us: number) => incidentTime(props.zone, us, props.now);

const place = computed<I18nText | null>(() => {
  const i = info.value;
  if (!i) return null;
  const kind = i.streamType && KIND[i.streamType] ? t(KIND[i.streamType]) : undefined;
  const parts = [kind, i.streamName, props.row?.folder_name].filter(Boolean);
  return parts.length ? raw(parts.join(" · ")) : null;
});

const countText = computed(() => {
  const s = props.summary;
  if (!s) return "";
  return s.count === 1
    ? t("alerts.incidents.unfold.firedOnce")
    : t("autoobserve.unfold.times", { count: n(s.count) });
});
const rangeText = computed(() => {
  const s = props.summary;
  if (!s) return "";
  return s.count === 1 ? when(s.first) : firingRange(props.zone, s.first, s.last, props.now);
});
const everyText = computed(() => {
  const median = props.summary?.medianInterval;
  return median ? t("alerts.incidents.panel.every", { interval: unfoldDuration(t, median) }) : null;
});
// How the firings were grouped and spread, all in this incident; the zone once.
const countTooltip = computed(() => {
  const s = props.summary;
  if (!s) return raw("");
  const parts: I18nText[] = [];
  if (s.groupedBy) parts.push(t("alerts.incidents.panel.tipGrouped", { how: s.groupedBy }));
  if (s.count > 1 && s.times) {
    parts.push(
      t("alerts.incidents.panel.tipTimes", {
        times: new Intl.ListFormat(locale.value, { type: "unit", style: "narrow" }).format(s.times),
      }),
    );
  } else if (s.count > 1) {
    parts.push(
      t("alerts.incidents.panel.tipFirst", { time: when(s.first) }),
      t("alerts.incidents.panel.tipLast", { time: when(s.last) }),
    );
  }
  if (s.longestGap) {
    parts.push(t("alerts.incidents.panel.tipGap", { gap: unfoldDuration(t, s.longestGap) }));
  }
  parts.push(t("alerts.incidents.panel.timesIn", { zone: zoneName.value }));
  return raw(parts.join(" · "));
});

const stateChip = computed(() => {
  if (!props.row) {
    return {
      variant: "default-outline" as const,
      dot: false,
      label: t("alerts.incidents.panel.stateUnknown"),
      tooltip: t("alerts.incidents.panel.notListed"),
    };
  }
  const words = alertLiveWords(t, alertLiveState(props.row, props.now));
  return {
    variant: STATE_VARIANT[words.tone],
    dot: true,
    label: words.state === "error" ? t("alerts.incidents.unfold.cantRunLong") : words.label,
    tooltip: words.tooltip,
  };
});

// The alert list keeps only the latest firing; it links when an incident in the list holds it.
const firedLater = computed(() => {
  const last = props.row?.last_satisfied_at;
  return !!props.summary && !!last && last > props.summary.last + MINUTE_US;
});
const otherIncidents = useQuery(() =>
  Object.assign(incidentsQuery(orgId.value, "", OTHER_INCIDENTS, 0), {
    enabled: !!orgId.value && firedLater.value,
  }),
);
const firedAgain = computed(() => {
  const s = props.summary;
  const last = props.row?.last_satisfied_at;
  if (!s || !last || !firedLater.value) return null;
  const other = otherIncidents.data.value?.incidents?.find(
    (incident) =>
      incident.id !== props.incidentId &&
      incident.alert_groups?.some((g) => g.alert_id === s.alertId) &&
      incident.first_alert_at - MINUTE_US <= last &&
      last <= incident.last_alert_at + MINUTE_US,
  );
  if (!other) return null;
  return {
    label: t("alerts.incidents.panel.firedAgain", { time: when(last) }),
    to: {
      name: "incidentDetail",
      params: { id: other.id },
      query: { org_identifier: orgId.value },
    },
  };
});

// The incident's last firing's own evaluation: the value the alert saw.
const lastHit = useQuery(() => {
  const s = props.summary;
  return Object.assign(
    alertHistoryQuery(
      orgId.value,
      {
        alert_id: alertId.value,
        outcome: "firing",
        start_time: s?.last ?? 0,
        end_time: (s?.last ?? 0) + EVALUATION_WINDOW_US,
        from: 0,
        size: NEAR_FIRINGS,
        sort_by: "timestamp",
        sort_order: "asc",
      },
      true,
    ),
    { enabled: nativeAlert.value && !!orgId.value && !!s, retry: false },
  );
});

// History rows carry processing time, and the scheduler queue can delay it past a check interval.
const selectedHit = computed(() => {
  const hits = (lastHit.data.value as { hits?: FiringHit[] } | undefined)?.hits ?? [];
  const firedAt = props.summary?.last ?? 0;
  return hits
    .filter((h) => h.timestamp >= firedAt)
    .reduce<FiringHit | undefined>(
      (best, h) => (!best || h.timestamp < best.timestamp ? h : best),
      undefined,
    );
});
const valueLine = computed(() => {
  if (lastHit.isPending.value && lastHit.fetchStatus.value !== "idle") return "loading" as const;
  const hit = selectedHit.value;
  const alert = info.value?.alert;
  if (!hit || !alert) return null;
  const words = firingValueWords(t, hit, isRowCount(alert), locale.value);
  if (!words) return null;
  return {
    ...words,
    raw: n(firingValueOf(hit) ?? 0),
    at: formatTimestampInTimezone(hit.timestamp, "HH:mm", props.zone),
  };
});
const needs = computed(() => {
  const hit = selectedHit.value;
  // The record carries no evaluation window, so today's period stays in the tooltip only.
  if (hit?.threshold_value != null && hit.threshold_operator) {
    return alertNeedsWords(
      t,
      { trigger_condition: { operator: hit.threshold_operator, threshold: hit.threshold_value } },
      locale.value,
      false,
    );
  }
  return nowNeeds.value;
});
const nowNeeds = computed(() =>
  info.value ? alertNeedsWords(t, info.value.alert, locale.value, "current") : null,
);
const needsLead = computed(() =>
  info.value ? alertNeedsWords(t, info.value.alert, locale.value, true) : null,
);
const schedule = computed(() =>
  alertScheduleWords(t, info.value?.alert.trigger_condition, !!info.value?.realTime),
);

const scheduleTooltip = computed(() => {
  const current = nowNeeds.value;
  const recorded = info.value && alertNeedsWords(t, info.value.alert, locale.value, false);
  if (lastHit.isError.value && recorded) return raw(`${schedule.value} · ${recorded}`);
  const hit = selectedHit.value;
  return hit?.threshold_value != null &&
    hit.threshold_operator &&
    current &&
    recorded !== needs.value
    ? raw(`${schedule.value} · ${current}`)
    : schedule.value;
});

const descriptionEl = ref<HTMLElement | null>(null);
const descriptionOpen = ref(false);
const descriptionClamped = ref(false);
let descriptionObserver: ResizeObserver | null = null;
const measureDescription = () => {
  descriptionClamped.value = isElementTruncated(descriptionEl.value, true);
};
watch(descriptionEl, (el) => {
  descriptionObserver?.disconnect();
  if (!el) return;
  if (typeof ResizeObserver !== "undefined") {
    descriptionObserver = new ResizeObserver(measureDescription);
    descriptionObserver.observe(el);
  }
  measureDescription();
});
watch(alertId, () => {
  descriptionOpen.value = false;
  queryOpen.value = false;
  void nextTick(measureDescription);
});
onBeforeUnmount(() => descriptionObserver?.disconnect());

// A filter-built alert shows the SQL the app generates from its conditions.
const customAlert = computed(() => {
  const i = info.value;
  return i?.streamName && i.streamType && i.alert.query_condition?.type === "custom" ? i : null;
});
const generatedSql = useQuery(() =>
  Object.assign(
    alertSqlQuery(orgId.value, alertId.value, {
      stream_name: customAlert.value?.streamName ?? "",
      stream_type: customAlert.value?.streamType ?? "logs",
      query_condition: customAlert.value?.alert.query_condition,
    }),
    {
      enabled: !!customAlert.value,
      retry: false,
      // While the definition's SQL regenerates, the same alert keeps its line instead of blinking.
      placeholderData: (previous: string | undefined, prior?: { queryKey: readonly unknown[] }) =>
        alertKeys.detail(orgId.value, alertId.value).every((part, i) => prior?.queryKey[i] === part)
          ? previous
          : undefined,
    },
  ),
);
const queryOpen = ref(false);
const query = computed(() => {
  const i = info.value;
  if (!i) return null;
  const own = alertQueryOf(i.alert);
  const code = own?.code ?? (customAlert.value ? generatedSql.data.value : undefined);
  const type = own?.lang ?? "custom";
  return code ? { code, label: t(QUERY_LABEL[type] ?? QUERY_LABEL.sql) } : null;
});
const copyQuery = () => {
  if (query.value) void copyToClipboard(query.value.code, t);
};

// Fixed each time an alert opens, so the minute tick neither refetches nor blanks the bars.
const weekNow = ref(props.now);
const isOpen = computed(() => props.open ?? !!props.summary);
watch([alertId, isOpen], () => {
  if (isOpen.value) weekNow.value = props.now;
});
const weekWindow = computed(() => lastWeekWindow(props.zone, weekNow.value));
const weekClient = useQueryClient();
const weekOptions = computed(() => {
  const { start, end } = weekWindow.value;
  const query = {
    start_time: start,
    end_time: end,
    interval: WEEK_BUCKET_SECONDS,
    alert_ids: alertId.value,
  };
  // The server widens buckets beyond 500; two midnight-aligned windows preserve local days.
  const middle = start + 4 * 24 * 60 * MINUTE_US;
  const options = alertHistorySummaryQuery(orgId.value, query);
  return {
    queryKey: [...options.queryKey, "panel-week-coverage"],
    staleTime: LIVE_STALE_TIME,
    enabled: isOpen.value && nativeAlert.value && !!orgId.value && !!alertId.value,
    retry: false,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const pages = await Promise.all(
        [
          [start, middle],
          [middle, end],
        ].map(async ([from, to]) => {
          const { data } = await alertsService.getHistorySummary(
            orgId.value,
            {
              ...query,
              start_time: from,
              end_time: to,
            },
            signal,
          );
          if (data.interval && data.interval !== WEEK_BUCKET_SECONDS)
            throw new Error("Unexpected history bucket interval");
          const start = Math.max(from, data.start_time);
          const end = Math.min(to, data.end_time);
          return {
            rows: data.rows ?? [],
            coverage: data.is_partial === false && start < end ? [{ start, end }] : [],
          };
        }),
      );
      return {
        rows: pages.flatMap((page) => page.rows),
        coverage: pages.flatMap((page) => page.coverage),
        end,
      };
    },
  };
});
const weekQuery = useQuery(weekOptions);
watch(isOpen, (open) => {
  if (!open) void weekClient.cancelQueries({ queryKey: weekOptions.value.queryKey, exact: true });
});
const week = computed(() =>
  weekQuery.data.value
    ? lastWeekOf(
        weekQuery.data.value.rows,
        alertId.value,
        props.zone,
        // A cached answer from earlier in the minute is complete up to the end it asked for.
        { ...weekWindow.value, end: weekQuery.data.value.end },
        weekQuery.data.value.coverage,
      )
    : null,
);
const weekMax = computed(() => Math.max(1, ...(week.value?.days.map((d) => d.n) ?? [])));
const weekDaysText = computed(() =>
  t("alerts.incidents.panel.daysOf", {
    count: n(week.value?.firingDays ?? 0),
    total: n(week.value?.days.length ?? 0),
  }),
);
const weekTooltip = computed(() => {
  const w = week.value;
  const parts: I18nText[] = [];
  if (w?.silenced) {
    parts.push(
      t(
        "alerts.incidents.panel.weekSilenced",
        { count: n(w.silenced), total: n(w.total) },
        w.silenced,
      ),
    );
  }
  parts.push(t("alerts.incidents.panel.weekDays", { zone: zoneName.value }));
  return raw(parts.join(" "));
});
const dayLabel = (us: number) => formatTimestampInTimezone(us, "MMM D", props.zone);
const dayTooltip = (day: WeekDay) =>
  !day.known
    ? t("alerts.incidents.panel.weekDayUnknown", {
        day: formatTimestampInTimezone(day.at, "EEE, MMM D", props.zone),
      })
    : t(
        "alerts.incidents.panel.weekDay",
        { day: formatTimestampInTimezone(day.at, "EEE, MMM D", props.zone), count: n(day.n) },
        day.n,
      );
// A busy search answers 429 or 503, or names its circuit breaker; anything else is a plain failure.
const weekError = computed(() => {
  const error = weekQuery.error.value as {
    response?: { status?: number; data?: unknown };
    message?: string;
  } | null;
  const status = error?.response?.status;
  const text = `${JSON.stringify(error?.response?.data ?? "")} ${error?.message ?? ""}`;
  const busy = status === 429 || status === 503 || /circuit ?breaker|too many|busy/i.test(text);
  return busy ? t("alerts.incidents.panel.weekBusy") : t("alerts.incidents.panel.weekError");
});

// An alert also delivers to its on-call team and workflows, with or without a destination.
const notifyTargets = computed(() => {
  const def = definitionData.value;
  const targets: I18nText[] = (def?.destinations ?? []).map(raw);
  if (def?.oncall_team?.trim()) targets.push(t("alerts.alertSettings.oncallTeamTarget"));
  const workflows = def?.workflows?.length ?? 0;
  if (workflows) {
    targets.push(t("alert_dependencies.countWorkflow", { count: n(workflows) }, workflows));
  }
  return targets;
});
const notifiesText = computed(() => {
  const names = notifyTargets.value;
  if (!names.length) return t("alerts.incidents.panel.notifiesNone");
  return names.length === 1
    ? t("alerts.incidents.panel.notifiesOne", { name: names[0] })
    : t("alerts.incidents.panel.notifiesMore", { name: names[0], count: n(names.length - 1) });
});
const notifiesTooltip = computed(() => {
  const def = definitionData.value;
  const parts: I18nText[] = [];
  const names = notifyTargets.value;
  if (names.length > 1) {
    parts.push(
      t("alerts.incidents.panel.tipDestinations", {
        names: new Intl.ListFormat(locale.value).format(names),
      }),
    );
  }
  if (info.value?.owner) {
    parts.push(t("alerts.incidents.panel.tipOwner", { owner: raw(info.value.owner) }));
  }
  if (def?.notify_on_recovery) parts.push(t("alerts.incidents.panel.tipRecovery"));
  return parts.length ? raw(parts.join(" · ")) : null;
});

// Logs alerts only: the app links SQL to the Logs page, and a filter-built alert through its generated SQL.
const logsAlert = computed(() => {
  const i = info.value;
  const type = i?.alert.query_condition?.type;
  return i?.streamType === "logs" && i.streamName && (type === "sql" || type === "custom")
    ? i
    : null;
});
const logsSql = computed(() => {
  const qc = logsAlert.value?.alert.query_condition;
  return qc?.type === "sql" ? (qc.sql ?? "") : (generatedSql.data.value ?? "");
});
const logsWindow = computed(() => {
  const at = props.summary?.first ?? 0;
  const lookback = (logsAlert.value?.alert.trigger_condition?.period ?? 0) * MINUTE_US;
  return { from: at - lookback, to: at };
});
const logsHref = computed(() => {
  const alert = logsAlert.value;
  if (!alert || !logsSql.value) return "";
  return router.resolve({
    path: "/logs",
    query: {
      stream_type: "logs",
      stream: alert.streamName,
      from: logsWindow.value.from,
      to: logsWindow.value.to,
      sql_mode: "true",
      query: b64EncodeUnicode(logsSql.value),
      org_identifier: orgId.value,
      // Logs reads an absent quick_mode as on, which drops every field but the trace ids.
      quick_mode: "false",
    },
  }).href;
});
const logsTooltip = computed(() =>
  t("alerts.incidents.panel.logsRange", {
    from: when(logsWindow.value.from),
    to: when(logsWindow.value.to),
    zone: zoneName.value,
  }),
);

const openAlert = () =>
  router.push({
    name: "alertDetail",
    params: { alert_id: alertId.value },
    query: { org_identifier: orgId.value, folder: props.row?.folder_id },
  });
</script>
