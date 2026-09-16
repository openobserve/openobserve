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
  HostDetailDrawer — single-host deep dive (design 4.8): a right ODrawer holding
  the host's fixed inline v8 metrics dashboard. Opens from the Hosts page's ?host= param.
-->
<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  findHostMetricsDashboard,
  importHostMetricsDashboard,
} from "@/composables/useHostMetricsDashboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import DateTime from "@/components/DateTime.vue";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
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

/**
 * ViewDashboard never caches a range: it holds this ref and calls
 * getConsumableDateTime() at every point of use, because a RELATIVE window
 * recomputes against the wall clock per call (DateTime.vue:855).
 */
const dateTimePicker = ref<{
  getConsumableDateTime?: () => { startTime: number; endTime: number };
} | null>(null);

// Seeded from the page picker so the first paint has a window before the picker mounts.
const drawerRange = ref({ ...props.range });

/** Picker first, falling back to the seed only before the picker has mounted. */
const readRange = () => {
  const picked = dateTimePicker.value?.getConsumableDateTime?.();
  if (picked && picked.startTime > 0 && picked.endTime > picked.startTime) {
    drawerRange.value = { from: picked.startTime, to: picked.endTime };
  }
  return drawerRange.value;
};

// GETTERS, not snapshots: this instance is reused across ?host= switches and lastSeenUs lands after mount (§7.3).
const curated = useCuratedPage(hostsPage, {
  pins: () => ({ [GROUP.host]: props.hostName }),
  lastSeenUs: () => props.lastSeenUs ?? undefined,
});

const resolveMetrics = (force = false) => {
  const range = readRange();
  return curated.refresh({ orgId: org.value, start: range.from, end: range.to, force });
};

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

/**
 * RenderDashboardCharts scopes its panels to an INJECTED selectedTabId, defaulting
 * to the literal "default" (RenderDashboardCharts.vue:452,590). The curated builder
 * names tabs after their section (resolve.ts:765), so without this the renderer
 * matches no tab, finds zero panels and prints its "Add a panel" empty state.
 */
const selectedTabId = ref<string | null>(null);
provide("selectedTabId", selectedTabId);

watch(
  () => (hostDashboard.value?.tabs ?? []) as { tabId?: string }[],
  (tabs) => {
    if (tabs.length === 0) {
      selectedTabId.value = null;
      return;
    }
    if (!tabs.some((tab) => tab.tabId === selectedTabId.value)) {
      selectedTabId.value = tabs[0].tabId ?? null;
    }
  },
  { immediate: true },
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
  // The payload is a snapshot; the picker is the source of truth, so seed from it first.
  drawerRange.value = { from: date.startTime, to: date.endTime };
  // DateTime replays on mount with userChangedValue:false — "do not fetch" (DateTime.vue contract).
  if (date.userChangedValue === false) return;
  void resolveMetrics(false);
};

onMounted(() => void resolveMetrics(false));

// A ?host= edit while open reuses this instance, so the panels must be rebuilt for the new host.
watch(
  () => props.hostName,
  () => void resolveMetrics(true),
);

// The list is still in flight at mount, so without this the late last-seen never engages the badge override.
watch(
  () => props.lastSeenUs,
  (next, prev) => {
    if (next == null || next === prev) return;
    void resolveMetrics(false);
  },
);

// ── Footer — check first, ask before creating, then deep-link with host + range ──
const openingDashboard = ref(false);
const importing = ref(false);
const confirmingImport = ref(false);

const toastImportError = (kind: "forbidden" | "generic") => {
  toast({
    variant: "error",
    message: t(
      kind === "forbidden"
        ? "ingestion.setupCard.hostDashboardImportForbidden"
        : "ingestion.setupCard.hostDashboardImportFailed",
    ),
  });
};

const goToDashboard = (dashboardId: string, folderId: string) => {
  // Hand the dashboard the window the panels are actually showing, not the seed.
  const range = readRange();
  router.push({
    path: "/dashboards/view",
    query: {
      org_identifier: org.value,
      dashboard: dashboardId,
      folder: folderId,
      "var-host_name": props.hostName,
      from: String(range.from),
      to: String(range.to),
    },
  });
};

const openHostDashboard = async () => {
  if (openingDashboard.value) return;
  openingDashboard.value = true;
  try {
    // The user can reach this drawer without ever running the setup flow.
    const result = await findHostMetricsDashboard(org.value);
    if (result.status === "error") {
      toastImportError(result.kind);
      return;
    }
    // Creating a dashboard in the user's org is never done off an "open" click alone.
    if (result.status === "absent") {
      confirmingImport.value = true;
      return;
    }
    goToDashboard(result.dashboardId, result.folderId);
  } finally {
    openingDashboard.value = false;
  }
};

const confirmImport = async () => {
  if (importing.value) return;
  importing.value = true;
  try {
    const result = await importHostMetricsDashboard(org.value);
    if (result.status === "error") {
      toastImportError(result.kind);
      return;
    }
    goToDashboard(result.dashboardId, result.folderId);
  } finally {
    importing.value = false;
    confirmingImport.value = false;
  }
};

const cancelImport = () => {
  confirmingImport.value = false;
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
    size="xxl"
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
          ref="dateTimePicker"
          auto-apply
          menu-align="end"
          default-type="absolute"
          :default-absolute-time="{ startTime: range.from, endTime: range.to }"
          data-test-name="host-drawer-date-time"
          @on:date-change="onDateChange"
        />
      </div>

      <div class="border-border-default min-h-0 flex-1 overflow-y-auto border-t pt-2">
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
             a panel editor this read-only surface does not have. -->
        <div
          v-else-if="curated.face.value === 'undetected' || !hasPanels"
          class="flex flex-col gap-2 py-6"
          data-test="host-drawer-metrics-undetected"
        >
          <OText variant="meta">{{ t("infra.curated.partialTelemetryHosts") }}</OText>
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

    <ODialog
      v-if="confirmingImport"
      :open="true"
      persistent
      size="sm"
      :title="t('infra.hosts.importConfirmTitle')"
      data-test="host-drawer-import-confirm"
      @update:open="(open: boolean) => !open && cancelImport()"
    >
      <OText>{{ t("infra.hosts.importConfirmMessage") }}</OText>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            data-test="host-drawer-import-confirm-cancel"
            @click="cancelImport"
          >
            {{ t("infra.hosts.importConfirmCancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="importing"
            data-test="host-drawer-import-confirm-ok"
            @click="confirmImport"
          >
            {{ t("infra.hosts.importConfirmOk") }}
          </OButton>
        </div>
      </template>
    </ODialog>
  </ODrawer>
</template>
