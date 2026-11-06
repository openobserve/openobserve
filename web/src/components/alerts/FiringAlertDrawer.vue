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
    :open="!!alertId"
    side="right"
    size="lg"
    seamless
    :modal="false"
    :title="raw(view?.name ?? alertId ?? '')"
    data-test="alerts-firing-drawer"
    @update:open="(open: boolean) => !open && emit('close')"
  >
    <template #header>
      <div class="flex min-w-0 flex-col gap-1" data-test="alerts-firing-drawer-title">
        <div class="flex min-w-0 items-center gap-2">
          <OTag v-if="view?.priority" type="alertPriority" :value="`p${view.priority}`" />
          <OTruncatedText class="text-text-heading text-base font-semibold">
            {{ raw(view?.name ?? alertId ?? "") }}
          </OTruncatedText>
          <template v-if="view">
            <OTag
              v-if="view.active_downtime"
              variant="default-soft"
              icon="notifications-paused"
              size="sm"
              :label="t('alerts.firing.chipMuted')"
            />
            <OTag v-else type="alertState" :value="titleState" size="sm" />
          </template>
        </div>
        <OText v-if="view" variant="meta">{{ raw(place) }}</OText>
      </div>
    </template>

    <div
      v-if="unreadable"
      class="flex h-full items-center justify-center"
      data-test="alerts-firing-drawer-error"
    >
      <OEmptyState preset="load-error" hide-action />
    </div>

    <div v-else-if="view" class="flex flex-col gap-3" data-test="alerts-firing-drawer-body">
      <div class="flex items-start gap-3">
        <section
          v-if="destinations.length || delivery"
          class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1"
          data-section="notified"
        >
          <template v-if="confirmed.length">
            <OText variant="meta">{{ t("alerts.firing.drawer.notified") }}</OText>
            <div class="flex flex-wrap items-center gap-1.5" data-group="confirmed">
              <OTag
                v-for="name in confirmed"
                :key="name"
                variant="success-soft"
                icon="check"
                size="sm"
                :label="raw(name)"
                :data-test="`alerts-firing-drawer-dest-${name}`"
              />
            </div>
          </template>
          <template v-if="unconfirmed.length || delivery?.names.length">
            <OText variant="meta">{{ t("alerts.destinationsLabel") }}</OText>
            <div class="flex flex-wrap items-center gap-1.5" data-group="unconfirmed">
              <OTag
                v-for="name in unconfirmed"
                :key="name"
                variant="default-soft"
                size="sm"
                :label="raw(name)"
                :data-test="`alerts-firing-drawer-dest-${name}`"
              />
              <OTag
                v-for="name in delivery?.names ?? []"
                :key="name"
                variant="error-soft"
                size="sm"
                :label="t('alerts.firing.drawer.notDeliveredTo', { name: raw(name) })"
                :data-test="`alerts-firing-drawer-failed-${name}`"
              />
            </div>
          </template>
          <OText
            v-if="delivery && !delivery.names.length && delivery.error"
            variant="meta"
            data-test="alerts-firing-drawer-delivery-error"
          >
            {{ raw(delivery.error) }}
          </OText>
        </section>
        <div class="ms-auto flex shrink-0 items-center gap-1.5" data-section="actions">
          <OButton
            v-if="showAcknowledge"
            variant="primary"
            size="xs"
            icon-left="check"
            :disabled="actions.pending.value"
            data-test="alerts-firing-drawer-ack"
            @click="onAcknowledge"
          >
            {{ t("alerts.ack.acknowledge") }}
          </OButton>
          <OButton
            v-if="showTakeOver"
            variant="primary"
            size="xs"
            :disabled="actions.pending.value"
            data-test="alerts-firing-drawer-take-over"
            @click="onTakeOver"
          >
            {{ t("alerts.ack.takeOver") }}
          </OButton>
          <OButton
            v-if="logsHref"
            as="a"
            variant="outline"
            size="xs"
            icon-left="open-in-new"
            :href="logsHref"
            target="_blank"
            rel="noopener"
            data-test="alerts-firing-drawer-logs"
          >
            {{ t("alerts.firing.drawer.openInLogs") }}
          </OButton>
          <OButton
            v-if="showMute"
            variant="outline"
            size="xs"
            icon-left="notifications-paused"
            data-test="alerts-firing-drawer-mute"
            @click="muteOpen = true"
          >
            {{ t("alerts.firing.mute") }}
          </OButton>
        </div>
      </div>

      <div
        v-if="view.incident"
        class="rounded-surface border-border-default text-text-body border px-3 py-2 text-sm"
        data-section="incident"
        data-test="alerts-firing-drawer-incident"
      >
        <div>
          {{ t("alerts.firing.drawer.partOfIncident") }}
          <router-link :to="incidentLink" class="text-text-link underline">
            {{ raw(view.incident.title || view.incident.id) }}
          </router-link>
        </div>
        <div v-if="incidentNote" class="text-text-secondary">{{ incidentNote }}</div>
      </div>

      <div
        class="grid grid-cols-3 gap-2"
        data-section="tiles"
        data-test="alerts-firing-drawer-tiles"
      >
        <div
          v-for="tile in tiles"
          :key="tile.key"
          class="rounded-surface border-border-default flex min-w-0 flex-col gap-1 border px-3 py-2"
          :data-test="tile.dataTest"
        >
          <OTruncatedText class="text-text-secondary text-xs">{{ tile.label }}</OTruncatedText>
          <span
            class="text-xl font-semibold tabular-nums"
            :class="tile.alarming ? 'text-icon-chip-error-text' : 'text-text-heading'"
          >
            {{ raw(String(tile.value)) }}
          </span>
          <OTruncatedText v-if="tile.sub" class="text-text-secondary text-xs">
            {{ tile.sub }}
          </OTruncatedText>
        </div>
      </div>

      <AckChip
        v-if="view.ack"
        :ack="view.ack"
        class="self-start"
        data-test="alerts-firing-drawer-ack-chip"
      />

      <div
        v-if="chartAlert"
        class="rounded-surface border-border-default border p-3"
        data-section="chart"
      >
        <AlertGroupChart
          :key="alertId ?? ''"
          :alert="chartAlert"
          :firing-since-us="firing ? (view.firing_started_at ?? undefined) : undefined"
          compact
        />
      </div>

      <div data-section="history">
        <FiringAlertHistory
          :hits="hits"
          :now-us="nowUs"
          :destinations="destinations"
          :firing-started-at="view.firing_started_at"
          :view-all="viewAll"
          :failed="historyRead.isError.value && !hits.length"
          :partial="partialRead"
        />
      </div>
    </div>

    <QuickMuteDialog
      v-if="downtimesEnabled"
      v-model:open="muteOpen"
      :selection="muteSelection"
      :alert="target"
      @muted="emit('changed')"
    />
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import AckChip from "./AckChip.vue";
import AlertGroupChart from "./AlertGroupChart.vue";
import FiringAlertHistory from "./FiringAlertHistory.vue";
import QuickMuteDialog from "./downtimes/QuickMuteDialog.vue";
import { useAlertActions } from "@/composables/alerts/useAlertActions";
import { FIRING_CLOCK_MS } from "@/composables/alerts/useFiringAlerts";
import { useDowntimesEnabled } from "@/composables/downtimes/useDowntimesEnabled";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { useOrgId } from "@/composables/query";
import {
  alertAcksQuery,
  alertDetailQuery,
  alertHistoryQuery,
  alertSqlQuery,
} from "@/services/alerts.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  ackBody,
  canAcknowledge,
  firingForLabel,
  isFiringNow,
  type FiringRow,
} from "@/utils/alerts/firingAlerts";
import {
  OPENING_RUN_MARGIN_US,
  deliveredNames,
  failedDelivery,
  flapCount,
  latestReading,
  latestState,
  type AlertRun,
} from "@/utils/alerts/firingHistory";
import { formatInZone } from "@/utils/oncall";
import { b64EncodeUnicode } from "@/utils/zincutils";

const FLAP_WINDOW_US = 6 * 3_600_000_000;
const HISTORY_SIZE = 1000;
const MINUTE_US = 60_000_000;

defineOptions({ name: "FiringAlertDrawer" });

const props = defineProps<{
  /** The `?alert=` id; the drawer is open while this is set. */
  alertId: string | null;
  /** That alert's row from any live view, or null when none has listed it. */
  row: FiringRow | null;
  /** When the list last came back, so a refresh re-reads the history too. */
  refreshedAt?: number;
}>();

const emit = defineEmits<{
  close: [];
  /** Asks the page to re-read after an action. */
  changed: [];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();
const zone = useViewerTimezone();
const actions = useAlertActions();
const downtimesEnabled = useDowntimesEnabled();

const muteOpen = ref(false);

const nowMs = ref(Date.now());
const nowUs = computed(() => nowMs.value * 1000);
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clock = setInterval(() => (nowMs.value = Date.now()), FIRING_CLOCK_MS);
});
onBeforeUnmount(() => clearInterval(clock));

const isAnomaly = computed(() => props.row?.alert_type === "anomaly_detection");

const detailRead = useQuery(() =>
  Object.assign(alertDetailQuery(orgId.value, props.alertId ?? "", props.row?.folder_id), {
    enabled: !!props.alertId && !isAnomaly.value,
    retry: false,
  }),
);
const detail = computed<any>(() =>
  props.alertId && !isAnomaly.value ? detailRead.data.value : null,
);

const acksRead = useQuery(() =>
  Object.assign(alertAcksQuery(orgId.value, props.alertId ?? "", detail.value?.folder_id), {
    enabled: !!props.alertId && !props.row,
  }),
);

// The label clock must not reach the query key, or every tick would be a fresh read.
const historyEndUs = ref(nowUs.value);
watch([() => props.alertId, () => props.refreshedAt], () => {
  historyEndUs.value = Date.now() * 1000;
});

const historyQuery = computed(() => {
  const started = props.row?.firing_started_at ?? historyEndUs.value;
  const id = props.alertId ?? "";
  return {
    ...(isAnomaly.value ? { anomaly_id: id } : { alert_id: id }),
    start_time: Math.min(historyEndUs.value - FLAP_WINDOW_US, started - OPENING_RUN_MARGIN_US),
    end_time: historyEndUs.value,
    from: 0,
    size: HISTORY_SIZE,
  };
});
const historyRead = useQuery(() =>
  Object.assign(alertHistoryQuery(orgId.value, historyQuery.value), {
    enabled: !!props.alertId,
    // A window change keeps the shown runs until the new read lands; another alert's runs must never show here.
    placeholderData: (previous: any, query: any) => {
      const read = query?.queryKey.at(-1);
      return (read?.alert_id ?? read?.anomaly_id) === props.alertId ? previous : undefined;
    },
  }),
);
const hits = computed<AlertRun[]>(() => historyRead.data.value?.hits ?? []);
const partialRead = computed(() => (historyRead.data.value?.total ?? 0) > hits.value.length);

// A same-minute refresh keeps the bucketed key, so nothing else would re-read; an in-flight read is reused.
watch(
  () => props.refreshedAt,
  async () => {
    await nextTick();
    if (props.alertId) void historyRead.refetch({ cancelRefetch: false });
  },
);

// A row the chip dropped still opens from a link, so its live fields come from history and acks.
const fromDetail = computed<FiringRow | null>(() => {
  const alert = detail.value;
  if (!alert) return null;
  const acks = acksRead.data.value ?? [];
  return {
    alert_id: props.alertId ?? "",
    folder_id: alert.folder_id ?? "",
    folder_name: alert.folder_name ?? "",
    name: alert.name,
    alert_type: alert.alert_type ?? "scheduled",
    stream_name: alert.stream_name,
    priority: alert.priority ?? undefined,
    last_outcome: latestState(hits.value),
    condition: alert.query_condition ?? alert.condition,
    ack: acks[0] ? { ...acks[0], groups_acked: acks.length } : undefined,
  };
});
const view = computed(() => props.row ?? fromDetail.value);
const unreadable = computed(() => !props.row && detailRead.isError.value);

const place = computed(() =>
  [view.value?.folder_name, view.value?.stream_name].filter(Boolean).join(" · "),
);
const firing = computed(() => !!view.value && isFiringNow(view.value));
const titleState = computed(() => {
  if (!firing.value) return "normal";
  return view.value?.last_outcome === "notify_failed" ? "notify_failed" : "firing";
});

const showAcknowledge = computed(() => firing.value && !!view.value && canAcknowledge(view.value));
const showTakeOver = computed(
  () =>
    firing.value &&
    !showAcknowledge.value &&
    !!view.value?.ack &&
    view.value.ack.acked_by !== actions.me.value,
);
const showMute = computed(
  () => downtimesEnabled.value && firing.value && !isAnomaly.value && !view.value?.active_downtime,
);

const target = computed(() => ({
  alertId: props.alertId ?? "",
  name: view.value?.name ?? "",
  folderId: view.value?.folder_id || undefined,
}));
const muteSelection = computed(() => [{ module: "alerts" as const, ids: [props.alertId ?? ""] }]);

const after = (ok: boolean) => {
  if (ok) emit("changed");
};
const groupOptions = () => {
  const body = view.value ? ackBody(view.value) : {};
  return body.all_groups ? { allGroups: true } : { firingStartedAt: body.firing_started_at };
};
const onAcknowledge = async () => after(await actions.acknowledge(target.value, groupOptions()));
const onTakeOver = async () => after(await actions.takeOver(target.value, groupOptions()));

// ack.rs resolves an alert in an open incident to the incident, and a take-over moves it all.
const incidentNote = computed(() => {
  if (showAcknowledge.value) return t("alerts.firing.drawer.incidentAck");
  return showTakeOver.value ? t("alerts.firing.drawer.incidentTakeOver") : "";
});
const incidentLink = computed(() => ({
  name: "incidentDetail",
  params: { id: view.value?.incident?.id ?? "" },
  query: { org_identifier: orgId.value },
}));

const reading = computed(() => latestReading(hits.value));
const flaps = computed(() => {
  if (!hits.value.length) return "—";
  const sinceUs = nowUs.value - FLAP_WINDOW_US;
  const count = flapCount(hits.value, sinceUs);
  return partialRead.value && !hits.value.some((run) => run.timestamp <= sinceUs)
    ? `${count}+`
    : count;
});
const tiles = computed<
  {
    key: string;
    label: I18nText;
    value: string | number;
    sub?: I18nText;
    alarming?: boolean;
    dataTest: string;
  }[]
>(() => {
  const started = view.value?.firing_started_at;
  return [
    {
      key: "now",
      label: t("alerts.firing.drawer.now"),
      value: reading.value?.value ?? "—",
      alarming: firing.value && !!reading.value?.value,
      sub: reading.value?.threshold
        ? t("alerts.firing.drawer.threshold", { value: raw(reading.value.threshold) })
        : undefined,
      dataTest: "alerts-firing-drawer-now",
    },
    {
      key: "firing-for",
      label: t("alerts.firing.columnFiringFor"),
      value: firingForLabel(started ?? undefined, nowMs.value),
      sub: started
        ? t("alerts.firing.drawer.since", {
            time: raw(formatInZone(started, zone.value, { timeStyle: "short" })),
          })
        : undefined,
      dataTest: "alerts-firing-drawer-firing-for",
    },
    {
      key: "flaps",
      label: t("alerts.firing.drawer.flaps"),
      value: flaps.value,
      sub: t("alerts.firing.drawer.flapsUnit"),
      dataTest: "alerts-firing-drawer-flaps",
    },
  ];
});

const chartAlert = computed(() =>
  detail.value?.stream_name && detail.value?.query_condition ? detail.value : null,
);

const destinations = computed<string[]>(
  () => props.row?.destinations ?? detail.value?.destinations ?? [],
);
const delivery = computed(() =>
  view.value?.last_outcome === "notify_failed" ? failedDelivery(hits.value) : null,
);
// A failure naming no destination leaves every delivery in doubt, so none can show as confirmed.
const deliveryUnknown = computed(
  () => view.value?.last_outcome === "notify_failed" && !delivery.value?.names.length,
);
const reached = computed(() =>
  destinations.value.filter((name) => !delivery.value?.names.includes(name)),
);
// A firing's own runs are the only evidence for it; earlier sends say nothing about this one.
const delivered = computed(() =>
  deliveryUnknown.value
    ? []
    : deliveredNames(
        hits.value,
        destinations.value,
        firing.value ? (view.value?.firing_started_at ?? 0) : 0,
      ),
);
const confirmed = computed(() => reached.value.filter((name) => delivered.value.includes(name)));
const unconfirmed = computed(() => reached.value.filter((name) => !delivered.value.includes(name)));

const logsAlert = computed(() => {
  const alert = detail.value;
  const type = alert?.query_condition?.type;
  return alert?.stream_name &&
    alert?.stream_type === "logs" &&
    (type === "sql" || type === "custom")
    ? alert
    : null;
});
const sqlRead = useQuery(() =>
  Object.assign(alertSqlQuery(orgId.value, props.alertId ?? "", logsAlert.value), {
    enabled: logsAlert.value?.query_condition?.type === "custom",
    retry: false,
  }),
);
const logsSql = computed<string>(() =>
  logsAlert.value?.query_condition?.type === "sql"
    ? (logsAlert.value.query_condition.sql ?? "")
    : (sqlRead.data.value ?? ""),
);
// The evaluation that fired read one period back, so the window opens there.
const logsHref = computed(() => {
  const alert = logsAlert.value;
  if (!alert || !logsSql.value) return "";
  const lookback = (alert.trigger_condition?.period ?? 0) * MINUTE_US;
  const started = view.value?.firing_started_at ?? nowUs.value - 60 * MINUTE_US;
  return router.resolve({
    path: "/logs",
    query: {
      stream_type: "logs",
      stream: alert.stream_name,
      from: started - lookback,
      to: nowUs.value,
      sql_mode: "true",
      query: b64EncodeUnicode(logsSql.value),
      org_identifier: orgId.value,
      // Logs reads an absent quick_mode as on, which drops every field but the trace ids.
      quick_mode: "false",
    },
  }).href;
});

const viewAll = computed(() =>
  isAnomaly.value
    ? undefined
    : {
        name: "alertDetail",
        params: { alert_id: props.alertId ?? "" },
        query: { org_identifier: orgId.value, folder: view.value?.folder_id },
      },
);
</script>
