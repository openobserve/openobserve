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
import { computed, ref, watch } from "vue";
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
import DateTime from "@/components/DateTime.vue";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import {
  buildHostDashboard,
  buildLogsPreviewSql,
  HOST_LOGS_STREAM,
  LOGS_PREVIEW_LIMIT,
  sqlEscape,
} from "./useHostDetail";

const props = defineProps<{
  hostName: string;
  status?: string;
  /** The row's os_type — renders as a header chip when present (design 4.8). */
  osType?: string | null;
  /** Time range (microseconds) the Hosts page picker held when the row opened. */
  range: { from: number; to: number };
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

const hostDashboard = computed(() => buildHostDashboard(props.hostName));
const currentTimeObj = computed(() => ({
  __global: {
    start_time: new Date(drawerRange.value.from / 1000),
    end_time: new Date(drawerRange.value.to / 1000),
  },
}));

const onDateChange = (date: { startTime: number; endTime: number; userChangedValue?: boolean }) => {
  // DateTime replays on mount with userChangedValue:false — "do not fetch" (DateTime.vue contract).
  if (date.userChangedValue === false) return;
  drawerRange.value = { from: date.startTime, to: date.endTime };
  if (logsLoaded.value) fetchLogs();
};

// ── Logs preview (lazy — fetched on first open of the Logs tab) ─────────────
const logsHits = ref<any[]>([]);
const logsLoading = ref(false);
const logsLoaded = ref(false);

// search takes no AbortSignal — a host/date change mid-flight must drop the stale response.
let logsGeneration = 0;

const fetchLogs = async () => {
  const gen = ++logsGeneration;
  logsLoading.value = true;
  logsLoaded.value = true;
  try {
    const res = await searchService.search(
      {
        org_identifier: org.value,
        query: {
          query: {
            sql: buildLogsPreviewSql(props.hostName),
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

// A ?host= edit while open reuses this instance — the previous host's logs must not linger.
watch(
  () => props.hostName,
  () => {
    logsHits.value = [];
    logsLoaded.value = false;
    if (activeTab.value === "logs") fetchLogs();
  },
);

const logLine = (hit: any): string =>
  String(hit?.log ?? hit?.message ?? hit?.body ?? JSON.stringify(hit));

const exploreLogsHref = computed(
  () =>
    router.resolve({
      path: "/logs",
      query: {
        stream_type: "logs",
        stream: HOST_LOGS_STREAM,
        from: String(drawerRange.value.from),
        to: String(drawerRange.value.to),
        sql_mode: "true",
        query: b64EncodeUnicode(buildLogsPreviewSql(props.hostName)) ?? "",
        org_identifier: org.value,
        quick_mode: "false",
        show_histogram: "false",
      },
    }).href,
);

const exploreTracesHref = computed(
  () =>
    router.resolve({
      path: "/traces",
      query: {
        org_identifier: org.value,
        from: String(drawerRange.value.from),
        to: String(drawerRange.value.to),
        // The traces page b64-decodes ?query= (plugins/traces/Index.vue restoreUrlQueryParams).
        query: b64EncodeUnicode(`host_name = '${sqlEscape(props.hostName)}'`) ?? "",
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
          <RenderDashboardCharts
            :dashboardData="hostDashboard"
            :currentTimeObj="currentTimeObj"
            :viewOnly="true"
            searchType="dashboards"
          />
        </div>

        <div v-else-if="activeTab === 'logs'" class="flex flex-col gap-2">
          <div class="flex justify-end">
            <a
              :href="exploreLogsHref"
              target="_blank"
              data-test="host-drawer-explore-logs"
              class="text-text-link text-sm"
              >{{ t("infra.hosts.exploreInLogs") }}</a
            >
          </div>
          <div v-if="logsLoading" class="flex justify-center py-6"><OSpinner size="md" /></div>
          <div
            v-else-if="logsHits.length === 0"
            data-test="host-drawer-logs-empty"
            class="text-text-secondary py-6 text-center text-sm"
          >
            {{ t("infra.hosts.logsEmpty", { stream: HOST_LOGS_STREAM }) }}
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
