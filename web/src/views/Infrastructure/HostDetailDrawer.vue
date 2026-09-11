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

<!--
  HostDetailDrawer — single-host deep dive (design 4.8): a right ODrawer with
  Metrics (fixed inline v8 dashboard) / Logs (last-100 preview + handoff) /
  Traces (scoped handoff) tabs. Opens from the Hosts page's ?host= param.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import searchService from "@/services/search";
import { importHostMetricsDashboard } from "@/composables/useHostMetricsDashboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import { b64EncodeUnicode } from "@/utils/zincutils";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import DateTime from "@/components/DateTime.vue";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import {
  buildLogsPreviewSql,
  LOGS_PREVIEW_LIMIT,
  sqlEscape,
  useHostLogsTarget,
} from "./useHostDetail";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { durationParts } from "./curated/resolve";
import { useCuratedPage } from "./curated/useCuratedPage";
import { hostsPage } from "./curated/packs/hosts.page";
import { GROUP } from "./curated/types";

const props = defineProps<{
  hostName: string;
  status?: string;
  /** The row's os_type — renders as a header chip when present (design 4.8). */
  osType?: string | null;
  /** Time range (microseconds) the Hosts page picker held when the row opened. */
  range: { from: number; to: number };
  /**
   * This host's OWN last-seen, µs. Stream stats are fleet-wide, so a dead host
   * behind a live fleet would otherwise render un-badged (§5.3, §7.3).
   */
  lastSeenUs?: number | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const store = useStore();
const router = useRouter();
const { t } = useI18nTyped();

const org = computed(() => store.state.selectedOrganization?.identifier ?? "");

const activeTab = ref<string | number>("metrics");
// Seeded from the page picker — the drawer opens on the window the row was computed over.
const drawerRange = ref({ ...props.range });

// GETTERS, not snapshots: this instance is reused across ?host= switches and lastSeenUs lands after mount (§7.3).
const curated = useCuratedPage(hostsPage, {
  pins: () => ({ [GROUP.host]: props.hostName }),
  lastSeenUs: () => props.lastSeenUs ?? undefined,
});

const resolveMetrics = (force = false) =>
  curated.refresh({
    orgId: org.value,
    start: drawerRange.value.from,
    end: drawerRange.value.to,
    force,
  });

/**
 * A row the list reports ACTIVE is live by an independent liveness query, so
 * the panels must not contradict it: eight amber badges behind an ACTIVE row
 * would destroy badge trust everywhere (§7.3, pass-4 finding 18).
 */
const suppressBadges = computed(() => props.status === "ACTIVE");

const hostDashboard = computed(() => {
  const built = curated.dashboard.value as any;
  if (!built || !suppressBadges.value) return built;
  return {
    ...built,
    tabs: (built.tabs ?? []).map((tab: any) => ({
      ...tab,
      panels: (tab.panels ?? []).map((panel: any) => {
        if (!panel.config?.curated_badge) return panel;
        const { curated_badge: _dropped, ...config } = panel.config;
        return { ...panel, config };
      }),
    })),
  };
});

const staleGroups = computed(() => (suppressBadges.value ? [] : curated.staleGroups.value));

/**
 * A curated tab is READ-ONLY, so RenderDashboardCharts' generic empty state — "Add
 * a panel to start visualizing…" — is an instruction the user cannot follow here.
 * It leaked whenever resolution produced no tab, so the non-ready faces are named
 * explicitly and the renderer is only ever handed a dashboard that has panels.
 */
const hasPanels = computed(() =>
  ((hostDashboard.value?.tabs ?? []) as { panels?: unknown[] }[]).some(
    (tab) => (tab.panels ?? []).length > 0,
  ),
);

/** Streams that exist but stopped reporting — the dormant face's evidence. */
const dormantStreams = computed(() =>
  curated.hiddenGroups.value.flatMap((hidden) =>
    hidden.missingStreams.filter((entry) => entry.state === "stale"),
  ),
);

const dormantDate = computed(() => {
  const seen = dormantStreams.value
    .map((entry) => entry.lastSeenUs ?? 0)
    .filter((value) => value > 0);
  if (seen.length === 0) return "";
  return timestampToTimezoneDate(
    Math.floor(Math.max(...seen) / 1000),
    store.state.timezone ?? "UTC",
  );
});

/**
 * The banner's own copy, not the group's capability sentence: under a warning
 * chrome, a neutral description of what a group DOES says nothing about the
 * outage. Same key, same params and same clock as the full page's banner.
 */
const staleBanners = computed(() =>
  staleGroups.value.map((stale) => {
    // A listed stream whose stats never flushed serializes doc_time_max: 0, which formats as the Unix epoch.
    const noDataYet = stale.noDataYet === true || !stale.lastSeenUs;
    // Same reference as CuratedPageView.humanDuration — measured against the later
    // of window-end and wall clock, so one page never shows two different ages.
    const parts = durationParts(
      stale.lastSeenUs,
      Math.max(drawerRange.value.to, Date.now() * 1000),
    );
    return {
      id: stale.group.id,
      key: noDataYet ? "infra.curated.staleNoDataBanner" : "infra.curated.staleBanner",
      capability: t(stale.group.capabilityKey),
      duration: noDataYet ? "" : t(`infra.curated.${parts.key}` as never, { count: parts.count }),
      date: noDataYet
        ? ""
        : timestampToTimezoneDate(
            Math.floor(stale.lastSeenUs / 1000),
            store.state.timezone ?? "UTC",
          ),
    };
  }),
);
// MICROSECOND epoch, undivided — usePanelDataLoader reads these back as µs.
const currentTimeObj = computed(() => ({
  __global: {
    start_time: new Date(drawerRange.value.from),
    end_time: new Date(drawerRange.value.to),
  },
}));

const onDateChange = (date: { startTime: number; endTime: number; userChangedValue?: boolean }) => {
  // DateTime replays on mount with userChangedValue:false — "do not fetch" (DateTime.vue contract).
  if (date.userChangedValue === false) return;
  drawerRange.value = { from: date.startTime, to: date.endTime };
  void resolveMetrics(false);
  if (logsLoaded.value) fetchLogs();
};

// ── Logs preview (lazy — fetched on first open of the Logs tab) ─────────────
const logsHits = ref<any[]>([]);
const logsLoading = ref(false);
const logsLoaded = ref(false);

const { target: logsTarget, resolve: resolveLogsTarget } = useHostLogsTarget();

// Both the Logs tab and the metrics `undetected` link need the target; whichever renders first pays for it once.
let logsTargetInFlight: Promise<unknown> | null = null;
const ensureLogsTarget = () => {
  if (!logsTargetInFlight) logsTargetInFlight = resolveLogsTarget(org.value);
  return logsTargetInFlight;
};

/**
 * Null until the schema walk settles, so the template can tell "still resolving"
 * from "resolved to nothing" — rendering the miss copy on the former would flash
 * a false negative on every open.
 */
const logsMiss = computed(() => logsTarget.value?.reason ?? null);

/** The resolved pair, or null while unresolved — the single source for SQL and the handoff. */
const logsQueryTarget = computed(() => {
  const resolved = logsTarget.value;
  if (!resolved?.stream || !resolved.field) return null;
  return { stream: resolved.stream, field: resolved.field };
});

const logsPreviewSql = computed(() =>
  logsQueryTarget.value ? buildLogsPreviewSql(props.hostName, logsQueryTarget.value) : "",
);

// search takes no AbortSignal — a host/date change mid-flight must drop the stale response.
let logsGeneration = 0;

const fetchLogs = async () => {
  const gen = ++logsGeneration;
  logsLoading.value = true;
  logsLoaded.value = true;
  try {
    await ensureLogsTarget();
    const resolved = logsTarget.value;
    if (gen !== logsGeneration || !resolved) return;
    // An unresolvable org gets the named reason, never a query against a guessed stream.
    if (!resolved.stream || !resolved.field) {
      logsHits.value = [];
      return;
    }
    const res = await searchService.search(
      {
        org_identifier: org.value,
        query: {
          query: {
            sql: buildLogsPreviewSql(props.hostName, {
              stream: resolved.stream,
              field: resolved.field,
            }),
            start_time: drawerRange.value.from,
            end_time: drawerRange.value.to,
            from: 0,
            size: LOGS_PREVIEW_LIMIT,
          },
        },
        page_type: "logs",
      },
      "ui",
    );
    if (gen !== logsGeneration) return;
    logsHits.value = res?.data?.hits ?? [];
  } catch {
    if (gen !== logsGeneration) return;
    logsHits.value = [];
  } finally {
    if (gen === logsGeneration) logsLoading.value = false;
  }
};

watch(activeTab, (tab) => {
  if (tab === "logs" && !logsLoaded.value) fetchLogs();
});

// The undetected face offers Explore-in-Logs, a dead href until the target resolves. Not
// `immediate`: at mount the face is still `unknown`, and resolving there would make the
// Metrics tab await a logs schema walk it never needs.
watch(
  () =>
    activeTab.value === "metrics" &&
    curated.face.value !== "unknown" &&
    (curated.face.value === "undetected" || !hasPanels.value),
  (offersLogsLink) => {
    if (offersLogsLink) void ensureLogsTarget();
  },
);

onMounted(() => void resolveMetrics(false));

// A ?host= edit while open reuses this instance — the previous host's logs must not linger.
watch(
  () => props.hostName,
  () => {
    logsHits.value = [];
    logsLoaded.value = false;
    void resolveMetrics(true);
    if (activeTab.value === "logs") fetchLogs();
  },
);

// The list is still in flight at mount, so without this the late last-seen never engages the badge override.
watch(
  () => props.lastSeenUs,
  (next, prev) => {
    if (next == null || next === prev) return;
    void resolveMetrics(false);
  },
);

const logLine = (hit: any): string =>
  String(hit?.log ?? hit?.message ?? hit?.body ?? JSON.stringify(hit));

// OTel resource attrs land as `service_host_name` (traces/mod.rs resource_attribute_key +
// flatten.rs format_key), but the JSON ingest path keeps a caller's bare `host_name`.
const tracesHostFilter = (hostName: string): string => {
  const escaped = sqlEscape(hostName);
  return `(service_host_name = '${escaped}' OR host_name = '${escaped}')`;
};

const exploreLogsHref = computed(() => {
  const resolved = logsQueryTarget.value;
  if (!resolved) return "";
  return router.resolve({
    path: "/logs",
    query: {
      stream_type: "logs",
      stream: resolved.stream,
      from: String(drawerRange.value.from),
      to: String(drawerRange.value.to),
      sql_mode: "true",
      query: b64EncodeUnicode(logsPreviewSql.value) ?? "",
      org_identifier: org.value,
      quick_mode: "false",
      show_histogram: "false",
    },
  }).href;
});

const exploreTracesHref = computed(
  () =>
    router.resolve({
      path: "/traces",
      query: {
        org_identifier: org.value,
        from: String(drawerRange.value.from),
        to: String(drawerRange.value.to),
        // The traces page b64-decodes ?query= (plugins/traces/Index.vue restoreUrlQueryParams).
        query: b64EncodeUnicode(tracesHostFilter(props.hostName)) ?? "",
      },
    }).href,
);

// ── Footer — create-if-absent, then deep-link with the host + range preset ──
const openingDashboard = ref(false);

const openHostDashboard = async () => {
  openingDashboard.value = true;
  try {
    // The user can reach this drawer without ever running the setup flow.
    const result = await importHostMetricsDashboard(org.value);
    if (result.status === "error") {
      toast({
        variant: "error",
        message: t(
          result.kind === "forbidden"
            ? "ingestion.setupCard.hostDashboardImportForbidden"
            : "ingestion.setupCard.hostDashboardImportFailed",
        ),
      });
      return;
    }
    router.push({
      path: "/dashboards/view",
      query: {
        org_identifier: org.value,
        dashboard: result.dashboardId,
        folder: result.folderId,
        "var-host_name": props.hostName,
        from: String(drawerRange.value.from),
        to: String(drawerRange.value.to),
      },
    });
  } finally {
    openingDashboard.value = false;
  }
};

const statusVariant = computed(() =>
  props.status === "ACTIVE"
    ? "success-soft"
    : props.status === "INACTIVE"
      ? "default-soft"
      : "amber-soft",
);
const statusLabel = computed(() =>
  props.status === "ACTIVE"
    ? t("infra.hosts.statusActive")
    : props.status === "INACTIVE"
      ? t("infra.hosts.statusInactive")
      : t("infra.hosts.statusUnknown"),
);
</script>

<template>
  <ODrawer
    :open="true"
    side="right"
    size="xl"
    :title="raw(hostName)"
    data-test="host-detail-drawer"
    @update:open="(open: boolean) => !open && emit('close')"
  >
    <div class="flex h-full flex-col">
      <div class="flex items-center justify-between gap-2 pb-2">
        <div class="flex items-center gap-2">
          <OTag :variant="statusVariant" size="sm">{{ statusLabel }}</OTag>
          <OTag v-if="osType" variant="default-soft" size="sm" data-test="host-drawer-os-chip">{{
            raw(osType)
          }}</OTag>
        </div>
        <DateTime
          auto-apply
          menu-align="end"
          default-type="absolute"
          :default-absolute-time="{ startTime: range.from, endTime: range.to }"
          data-test-name="host-drawer-date-time"
          @on:date-change="onDateChange"
        />
      </div>

      <!-- Reka activates on mousedown; the click fallback keeps keyboard/AT/synthetic clicks working. -->
      <OTabs v-model="activeTab" align="left" class="border-border-default border-b">
        <OTab
          name="metrics"
          :label="t('search.metrics')"
          data-test="host-drawer-tab-metrics"
          @click="activeTab = 'metrics'"
        />
        <OTab
          name="logs"
          :label="t('common.logs')"
          data-test="host-drawer-tab-logs"
          @click="activeTab = 'logs'"
        />
        <OTab
          name="traces"
          :label="t('menu.traces')"
          data-test="host-drawer-tab-traces"
          @click="activeTab = 'traces'"
        />
      </OTabs>

      <div class="min-h-0 flex-1 overflow-y-auto pt-2">
        <div v-if="activeTab === 'metrics'">
          <div
            v-if="curated.face.value === 'unknown' && curated.loadError.value"
            class="flex flex-col items-center gap-2 py-6"
          >
            <OText variant="meta">{{ t("infra.curated.pageError") }}</OText>
            <OButton
              variant="outline"
              size="sm-action"
              data-test="host-drawer-metrics-retry"
              @click="resolveMetrics(true)"
            >
              {{ t("infra.curated.retry") }}
            </OButton>
          </div>
          <div
            v-else-if="curated.face.value === 'unknown'"
            class="flex justify-center py-6"
            data-test="host-drawer-metrics-spinner"
          >
            <OSpinner size="md" />
          </div>
          <!-- The streams exist and merely stopped reporting: "install a collector"
               is the wrong instruction for a host that already had one. -->
          <div
            v-else-if="curated.face.value === 'dormant'"
            class="flex flex-col gap-2 py-6"
            data-test="host-drawer-metrics-dormant"
          >
            <OText tag="h3" class="text-lg font-semibold">{{
              t("infra.curated.dormantHeadline", { workload: t("menu.hosts") })
            }}</OText>
            <OText variant="meta">{{ t("infra.curated.dormantBody") }}</OText>
            <OBanner
              v-if="dormantStreams.length"
              variant="warning"
              dense
              data-test="host-drawer-metrics-dormant-streams"
              :content="
                t('infra.curated.streamsStale', {
                  list: raw(dormantStreams.map((entry) => entry.name).join(', ')),
                  date: dormantDate,
                })
              "
            />
          </div>

          <!-- No host metrics at all: name the missing receiver rather than offering
               a panel editor this read-only tab does not have. -->
          <div
            v-else-if="curated.face.value === 'undetected' || !hasPanels"
            class="flex flex-col gap-2 py-6"
            data-test="host-drawer-metrics-undetected"
          >
            <OText variant="meta">{{ t("infra.curated.partialTelemetryHosts") }}</OText>
            <a
              v-if="exploreLogsHref"
              :href="exploreLogsHref"
              target="_blank"
              class="text-text-link text-sm"
              data-test="host-drawer-metrics-undetected-logs"
              >{{ t("infra.hosts.exploreInLogs") }}</a
            >
          </div>

          <RenderDashboardCharts
            v-else
            :dashboardData="hostDashboard"
            :currentTimeObj="currentTimeObj"
            :viewOnly="true"
            searchType="dashboards"
          >
            <template #before_panels>
              <div
                v-if="curated.hiddenGroups.value.length || curated.partialGroups.value.length"
                class="border-border-default rounded-surface mb-2 flex flex-col gap-1 border p-2"
                data-test="curated-strip"
              >
                <OText
                  v-for="hidden in curated.hiddenGroups.value"
                  :key="hidden.group.id"
                  variant="meta"
                  >{{ t(hidden.group.capabilityKey) }}</OText
                >
                <OText
                  v-for="partial in curated.partialGroups.value"
                  :key="`partial-${partial.group.id}`"
                  variant="meta"
                  >{{
                    t("infra.curated.streamsMissing", {
                      count: partial.missingStreams.length,
                      list: raw(partial.missingStreams.map((s) => s.name).join(", ")),
                    })
                  }}</OText
                >
              </div>
              <OBanner
                v-for="stale in staleBanners"
                :key="stale.id"
                variant="warning"
                dense
                data-test="curated-stale-banner"
                :content="
                  t(stale.key as never, {
                    capability: stale.capability,
                    duration: stale.duration,
                    date: stale.date,
                  })
                "
              />
            </template>
          </RenderDashboardCharts>
        </div>

        <div v-else-if="activeTab === 'logs'" class="flex flex-col gap-2">
          <div v-if="exploreLogsHref" class="flex justify-end">
            <a
              :href="exploreLogsHref"
              target="_blank"
              data-test="host-drawer-explore-logs"
              class="text-text-link text-sm"
              >{{ t("infra.hosts.exploreInLogs") }}</a
            >
          </div>
          <div v-if="logsLoading" class="flex justify-center py-6"><OSpinner size="md" /></div>
          <!-- Named before the zero-row state: "no logs found" would blame the range for an org that has no host field at all. -->
          <div
            v-else-if="logsMiss"
            data-test="host-drawer-logs-unresolved"
            :data-reason="logsMiss"
            class="text-text-secondary py-6 text-center text-sm"
          >
            {{
              t(
                logsMiss === "no-log-streams"
                  ? "infra.hosts.logsNoStreams"
                  : "infra.hosts.logsNoHostField",
              )
            }}
          </div>
          <div
            v-else-if="logsHits.length === 0 && logsQueryTarget"
            data-test="host-drawer-logs-empty"
            class="text-text-secondary py-6 text-center text-sm"
          >
            {{ t("infra.hosts.logsEmpty", { stream: raw(logsQueryTarget.stream) }) }}
          </div>
          <div v-else class="flex flex-col gap-1">
            <div
              v-for="(hit, i) in logsHits"
              :key="i"
              class="text-text-body border-border-default truncate border-b py-1 font-mono text-xs"
            >
              {{ raw(logLine(hit)) }}
            </div>
          </div>
        </div>

        <div v-else class="flex flex-col items-start gap-2 py-4">
          <a
            :href="exploreTracesHref"
            target="_blank"
            data-test="host-drawer-traces-link"
            class="text-text-link text-sm"
            >{{ t("infra.hosts.exploreTraces") }}</a
          >
          <OText variant="meta">{{ t("infra.hosts.tracesScopeNote") }}</OText>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full justify-end">
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="dashboard"
          :loading="openingDashboard"
          data-test="host-drawer-open-dashboard"
          @click="openHostDashboard"
        >
          {{ t("infra.hosts.openDashboard") }}
        </OButton>
      </div>
    </template>
  </ODrawer>
</template>
