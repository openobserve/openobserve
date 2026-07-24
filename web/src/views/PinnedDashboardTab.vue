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
  <div class="pinned-dashboard-tab h-full flex flex-col min-h-0">
    <!-- Skeleton mirrors the loaded layout (toolbar + panels grid) so the
         transition to real content is stable, instead of flat full-width bars. -->
    <div v-if="isLoading" class="flex flex-col h-full min-h-0">
      <div
        class="flex justify-end items-center gap-2 px-4 py-2 shrink-0 border-b border-border-default"
      >
        <div class="w-48"><OSkeleton class="h-8" /></div>
        <div class="w-24"><OSkeleton class="h-8" /></div>
        <div class="w-8"><OSkeleton class="h-8" /></div>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden p-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
          <div
            v-for="i in 4"
            :key="i"
            class="flex flex-col gap-3 rounded-default border border-border-default p-4 min-h-40"
          >
            <div class="flex items-center justify-between">
              <div class="w-40"><OSkeleton class="h-4" /></div>
              <div class="w-4"><OSkeleton class="h-4" /></div>
            </div>
            <OSkeleton class="flex-1 min-h-24" />
          </div>
        </div>
      </div>
    </div>
    <template v-else-if="dashboardData">
      <div class="flex justify-end items-center gap-2 px-4 py-2 shrink-0 border-b border-border-default">
        <DateTimePickerDashboard
          v-if="selectedDate"
          ref="dateTimePicker"
          size="sm"
          v-model="selectedDate"
          @hide="setTime"
          data-test="pinned-dashboard-date-time-picker"
        />
        <AutoRefreshInterval
          v-model="refreshInterval"
          trigger
          :min-refresh-interval="store.state?.zoConfig?.min_auto_refresh_interval || 5"
          @trigger="refreshData"
          size="sm"
        />
        <OButton
          variant="outline"
          size="icon-toolbar"
          icon-left="refresh"
          data-test="pinned-dashboard-refresh-btn"
          @click="refreshData"
        >
          <OTooltip :content="t('common.refresh')" />
        </OButton>
      </div>
      <div class="flex-1 min-h-0 overflow-auto">
        <RenderDashboardCharts
          ref="renderRef"
          :view-only="true"
          :show-tabs="true"
          :frame="false"
          :dashboard-data="dashboardData"
          :current-time-obj="currentTimeObj"
          :initial-variable-values="{}"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, provide } from "vue";
import { useStore } from "vuex";
import { getConsumableRelativeTime } from "@/utils/date";
import { getDashboard } from "@/utils/commons";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{ dashboardId: string; folderId: string }>();
const emit = defineEmits<{
  (e: "update-label", label: string): void;
  (e: "unavailable", dashboardId: string): void;
}>();

const store = useStore();
const isLoading = ref(true);
const dashboardData = ref<any>(null);
// RenderDashboardCharts expects currentTimeObj keyed per-panel, falling back
// to the "__global" key when no panel-specific override exists. We only
// ever set the global time here (read-only embedded view, no per-panel UI).
const currentTimeObj = ref<Record<string, { start_time?: Date; end_time?: Date }>>({});
const refreshInterval = ref(0);
const dateTimePicker = ref<any>(null);
const renderRef = ref<any>(null);

// RenderDashboardCharts reads the active tab via inject("selectedTabId").
// ViewDashboard provides it; we must too, or it falls back to "default" and
// filters panels to an empty set (→ "No panels here yet") for any dashboard
// whose panels live on a tab whose id isn't literally "default". We provide a
// reactive ref and set it to the dashboard's first tab id once loaded, mirroring
// ViewDashboard's initial-tab resolution.
const selectedTabId = ref<string | null>(null);
provide("selectedTabId", selectedTabId);

const LS_TIME_KEY = () => `o2_home_pin_time_${props.dashboardId}`;

const selectedDate = ref<any>(loadSavedDate());

function loadSavedDate() {
  try {
    const raw = localStorage.getItem(LS_TIME_KEY());
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore malformed localStorage entries
  }
  return {
    valueType: "relative",
    startTime: null,
    endTime: null,
    relativeTimePeriod: "15m",
  };
}

// Resolve the current window (in epoch-µs) from selectedDate WITHOUT depending
// on the DateTimePickerDashboard ref. The picker mounts a render cycle after
// dashboardData is set, so on initial load its ref is still null when panels
// first ask for the time — relying on it left currentTimeObj empty ({}), and
// every panel bailed in usePanelDataLoader with "invalid/missing time → no
// query". Computing straight from selectedDate makes the __global time
// available immediately, so panels fire their queries on first render.
const resolveWindow = (): { startTime: number; endTime: number } | null => {
  const d = selectedDate.value;
  if (!d) return null;
  const type = d.valueType ?? d.type;
  if (type === "relative" && d.relativeTimePeriod) {
    const rel = getConsumableRelativeTime(d.relativeTimePeriod);
    if (rel?.startTime && rel?.endTime) {
      return { startTime: rel.startTime, endTime: rel.endTime };
    }
  }
  // absolute: startTime/endTime already epoch-µs
  if (d.startTime && d.endTime) {
    return { startTime: d.startTime, endTime: d.endTime };
  }
  return null;
};

const setTime = () => {
  const win = resolveWindow();
  if (win) {
    // win.{start,end}Time are epoch-MICROSECONDS. The panel pipeline expects
    // __global Dates whose .getTime() yields the microsecond value directly
    // (ViewDashboard does new Date(getConsumableDateTime().startTime) with the
    // same µs input). Do NOT divide by 1000 — that produced a millisecond Date,
    // so the query sent a 1000×-too-small window (≈1970) and matched no data
    // ("No Data" despite the query firing). Pass the µs value straight to Date.
    currentTimeObj.value = {
      __global: {
        start_time: new Date(win.startTime),
        end_time: new Date(win.endTime),
      },
    };
  }
  try {
    localStorage.setItem(LS_TIME_KEY(), JSON.stringify(selectedDate.value));
  } catch {
    // ignore storage failures (e.g. quota, private mode)
  }
};

const refreshData = () => {
  setTime();
};

const load = async () => {
  isLoading.value = true;
  try {
    // Use the shared getDashboard util (same as ViewDashboard) — NOT the raw
    // service. It unwraps the versioned API envelope (data.v5), runs schema
    // conversion to the current tabs[].panels shape, and ensures variables.
    // The raw service returns {version, v5:{...}} whose top level has no `tabs`,
    // which made RenderDashboardCharts render "No panels here yet".
    const dashboard = await getDashboard(
      store,
      props.dashboardId,
      props.folderId,
    );

    // getDashboard returns {} (not a throw) for a missing/deleted dashboard.
    if (!dashboard || typeof dashboard !== "object" || !dashboard.title) {
      emit("unavailable", props.dashboardId);
      return;
    }

    dashboardData.value = dashboard;
    emit("update-label", dashboard.title);
    // Select the first tab so RenderDashboardCharts renders its panels (the
    // read-only embed has no tab UI to pick another). Without this the injected
    // selectedTabId stays null/"default" and the panel list resolves empty.
    selectedTabId.value = dashboard.tabs?.[0]?.tabId ?? "default";
    await nextTick();
    setTime();
  } catch {
    emit("unavailable", props.dashboardId);
  } finally {
    isLoading.value = false;
  }
};

onMounted(load);
watch(() => props.dashboardId, load);

// Recompute the window whenever the selected range changes. The
// DateTimePickerDashboard updates its v-model (selectedDate) on Apply /
// relative-period / absolute change, but only emits @hide when the dropdown
// closes — relying on @hide alone meant clicking Apply did not rebuild
// currentTimeObj, so panels never re-queried for the new range. Watching
// selectedDate directly (deep) covers every change path. Skip while the initial
// dashboard load is still running — load() calls setTime() itself.
watch(
  selectedDate,
  () => {
    if (!isLoading.value) setTime();
  },
  { deep: true },
);
</script>
