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

 Unauthenticated standalone viewer — no app shell, no store user, no OPageLayout
 (deliberate: this page renders for anonymous visitors outside the authed app).
 Panels render through the authed dashboard's own grid (RenderDashboardCharts,
 view-only) fed with pre-built snapshots, so no query ever runs from here.
-->
<template>
  <div class="bg-surface-base flex min-h-screen flex-col">
    <div
      v-if="state === 'loading' || state === 'preparing'"
      class="flex min-h-[60vh] flex-col items-center justify-center gap-3"
      data-test="dashboards-public-dashboard-loading"
    >
      <OSpinner variant="dots" size="lg" />
      <div v-if="state === 'preparing'" class="text-text-secondary text-sm">
        {{ t("dashboard.publicDashboard.preparing") }}
      </div>
    </div>

    <div
      v-else-if="state === 'notfound' || state === 'unavailable'"
      class="flex min-h-[60vh] flex-col items-center justify-center"
      data-test="dashboards-public-dashboard-error"
    >
      <div class="text-text-secondary text-sm">
        {{
          state === "unavailable"
            ? t("dashboard.publicDashboard.unavailable")
            : t("dashboard.publicDashboard.notAvailable")
        }}
      </div>
    </div>

    <template v-else>
      <header class="px-page-edge flex items-center justify-between gap-3 pt-3">
        <div class="text-text-heading text-lg font-semibold">
          {{ config.title }}
        </div>
        <div class="flex items-center gap-3">
          <OSelect
            v-if="timeEditable && presetOptions.length"
            v-model="selectedPreset"
            :options="presetOptions"
            :label="t('dashboard.publicDashboard.timeRange')"
            label-position="left"
            data-test="dashboards-public-dashboard-preset-select"
            @update:model-value="loadData"
          />
          <div class="text-text-secondary flex shrink-0 flex-col text-xs whitespace-nowrap">
            <span v-if="builtAtLabel">{{ builtAtLabel }}</span>
            <span v-if="refreshInLabel" data-test="dashboards-public-dashboard-refresh-countdown">
              {{ refreshInLabel }}
            </span>
          </div>
        </div>
      </header>

      <RenderDashboardCharts
        class="min-h-0 flex-1"
        :frame="false"
        :view-only="true"
        :show-tabs="true"
        :dashboard-data="dashboardData"
        :dashboard-name="config.title"
        :current-time-obj="currentTimeObj"
        :should-refresh-without-cache-obj="{}"
        :injected-panel-data="injectedPanelData"
        :allow-alert-creation="false"
        :show-legends-button="true"
        data-test="dashboards-public-dashboard-charts"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, provide } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import publicDashboardsService from "@/services/public_dashboards";

interface PresetOption {
  label: I18nText;
  value: number;
}

const route = useRoute();
const store = useStore();
const { t } = useI18nTyped();
const slug = String(route.params.slug || "");

const state = ref<"loading" | "ready" | "preparing" | "notfound" | "unavailable">("loading");
const config = ref<Record<string, any>>({});
const snapshot = ref<Record<string, any>>({});
const selectedPreset = ref<number | null>(null);
// RenderDashboardCharts and TabList read and switch the active tab through this.
const selectedTabId = ref<string>("");
provide("selectedTabId", selectedTabId);

const tabs = computed<any[]>(() => (Array.isArray(config.value.layout) ? config.value.layout : []));
const timeEditable = computed(() => !!config.value?.time_range?.editable);
const presetOptions = computed<PresetOption[]>(() =>
  (config.value?.available_presets ?? [])
    .slice()
    .sort((a: number, b: number) => a - b)
    .map((secs: number) => ({ value: secs, label: presetLabel(secs) })),
);
const builtAt = computed<number | null>(
  () => snapshot.value?.built_at ?? config.value?.built_at ?? null,
);
const builtAtLabel = computed<I18nText | "">(() =>
  builtAt.value
    ? t("dashboard.publicDashboard.updatedAt", {
        time: raw(new Date(builtAt.value / 1000).toLocaleString()),
      })
    : "",
);

// Variables are frozen server-side, so the grid gets none and renders no selectors.
const dashboardData = computed(() => ({
  dashboardId: slug,
  title: config.value.title,
  version: 8,
  tabs: tabs.value,
  variables: { list: [] },
}));

// The window the snapshot was built for, so any time-aware chrome matches the data.
const currentTimeObj = computed(() => {
  const endMs = builtAt.value ? builtAt.value / 1000 : Date.now();
  const startMs = endMs - (selectedPreset.value ?? 0) * 1000;
  return { __global: { start_time: new Date(startMs), end_time: new Date(endMs) } };
});

// Each panel renders its snapshot instead of querying; withheld panels carry a message.
const injectedPanelData = computed(() => {
  const out: Record<string, unknown> = {};
  for (const tab of tabs.value) {
    for (const panel of tab?.panels ?? []) {
      const snap = snapshot.value?.panels?.[panel.id];
      out[panel.id] =
        snap?.state?.state === "ok"
          ? {
              data: snap.data ?? [],
              metadata: snap.metadata ?? { queries: [] },
              resultMetaData: snap.resultMetaData ?? [],
            }
          : {
              data: [],
              metadata: { queries: [] },
              resultMetaData: [],
              errorDetail: { message: t("dashboard.publicDashboard.panelNotAvailable"), code: "" },
            };
    }
  }
  return out;
});

function presetLabel(secs: number): I18nText {
  const range =
    secs % 86400 === 0
      ? `${secs / 86400}d`
      : secs % 3600 === 0
        ? `${secs / 3600}h`
        : secs % 60 === 0
          ? `${secs / 60}m`
          : `${secs}s`;
  return t("dashboard.publicDashboard.past", { range: raw(range) });
}

const pickDefaultPreset = (): number | null => {
  const def = config.value?.time_range?.default_range_secs;
  const presets: number[] = config.value?.available_presets ?? [];
  if (def && presets.includes(def)) return def;
  return presets.slice().sort((a, b) => a - b)[0] ?? null;
};

const mapError = (e: unknown) => {
  const status = (e as { response?: { status?: number } })?.response?.status;
  state.value = status === 503 ? "unavailable" : "notfound";
};

const loadData = async () => {
  // No preset resolved yet means no snapshot has been built — show "preparing"
  // rather than hanging on the loading spinner forever.
  if (selectedPreset.value == null) {
    state.value = "preparing";
    return;
  }
  try {
    const res = await publicDashboardsService.getData(slug, selectedPreset.value);
    if (res.status === 202) {
      state.value = "preparing";
      return;
    }
    snapshot.value = res.data ?? {};
    state.value = "ready";
  } catch (e: unknown) {
    mapError(e);
  }
};

const applyConfig = (next: Record<string, any>) => {
  // Keep the layout reference when unchanged so the grid is not rebuilt on every refresh.
  const sameLayout = JSON.stringify(next.layout) === JSON.stringify(config.value.layout);
  config.value = sameLayout ? { ...next, layout: config.value.layout } : next;
  // Anonymous viewers only get the minimal /config bootstrap, which lacks the
  // timestamp column the renderer needs to detect time-series axes.
  if (next.timestamp_column && store.state.zoConfig?.timestamp_column !== next.timestamp_column) {
    store.dispatch("setConfig", {
      ...store.state.zoConfig,
      timestamp_column: next.timestamp_column,
    });
  }
  if (!tabs.value.some((tab) => tab.tabId === selectedTabId.value)) {
    selectedTabId.value = tabs.value[0]?.tabId ?? "";
  }
};

const load = async () => {
  try {
    const res = await publicDashboardsService.getConfig(slug);
    applyConfig(res.data ?? {});
    selectedPreset.value = pickDefaultPreset();
    await loadData();
  } catch (e: unknown) {
    mapError(e);
  }
};

let refreshTimer: ReturnType<typeof setInterval> | null = null;
const refreshSecs = computed(() => Number(config.value?.refresh_secs) || 0);
// Seconds until the next re-read; counts down on the author's "Refresh every" cadence.
const secondsLeft = ref(0);
const refreshInLabel = computed<I18nText | "">(() =>
  refreshSecs.value > 0 && state.value === "ready"
    ? t("dashboard.publicDashboard.refreshIn", { secs: raw(String(secondsLeft.value)) })
    : "",
);

// Re-read on the author's "Refresh every" cadence — the same interval the snapshot rebuilds on.
const refresh = async () => {
  if (state.value !== "ready") return;
  try {
    const res = await publicDashboardsService.getConfig(slug);
    applyConfig(res.data ?? {});
    await loadData();
  } catch (e: unknown) {
    mapError(e);
  }
};

// Paused while the tab is hidden, so a background tab never polls.
const tick = async () => {
  if (document.hidden || refreshSecs.value <= 0) return;
  secondsLeft.value -= 1;
  if (secondsLeft.value > 0) return;
  secondsLeft.value = refreshSecs.value;
  await refresh();
};

onMounted(async () => {
  await load();
  secondsLeft.value = refreshSecs.value;
  refreshTimer = setInterval(tick, 1000);
});

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>
