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
  <div class="bg-surface-base flex h-screen flex-col">
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
      <OPageHeader
        :title="raw(config.title)"
        icon="dashboard"
        title-data-test="dashboards-public-dashboard-title"
      >
        <template #title-trail>
          <div class="flex h-8 self-center max-md:hidden">
            <OSeparator vertical />
          </div>
          <PoweredByOpenObserve size="md" class="max-md:hidden" />
        </template>
        <template #actions>
          <ODropdown v-if="presetOptions.length" side="bottom" align="end">
            <template #trigger>
              <OButton
                variant="outline"
                size="sm-toolbar"
                class="h-8!"
                icon-left="schedule"
                :icon-right="timeEditable ? 'keyboard-arrow-down' : undefined"
                :disabled="!timeEditable"
                data-test="dashboards-public-dashboard-preset-btn"
              >
                {{ selectedPresetLabel }}
              </OButton>
            </template>
            <ODropdownItem
              v-for="option in presetOptions"
              :key="option.value"
              :data-test="`dashboards-public-dashboard-preset-${option.value}`"
              @select="selectPreset(option.value)"
            >
              {{ option.label }}
            </ODropdownItem>
          </ODropdown>
          <span
            v-if="windowLabel"
            class="text-text-secondary text-sm whitespace-nowrap tabular-nums max-lg:hidden"
            data-test="dashboards-public-dashboard-window"
          >
            {{ windowLabel }}
          </span>
          <div class="flex h-8 self-center max-md:hidden">
            <OSeparator vertical />
          </div>
          <ORefreshButton
            :last-run-at="builtAt ? builtAt / 1000 : null"
            :loading="refreshing"
            variant="outline"
            layout="inline"
            data-test="dashboards-public-dashboard-refresh-btn"
            @click="refreshNow"
          />
          <ThemeSwitcher bordered />
        </template>
      </OPageHeader>

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
      >
        <template #before_panels>
          <!-- Same markup the live dashboard uses for a read-only constant variable. -->
          <div
            v-if="publicVariables.length"
            class="mt-1 flex flex-wrap gap-y-1"
            data-test="dashboards-public-dashboard-variables"
          >
            <div
              v-for="variable in publicVariables"
              :key="variable.label"
              class="max-w-[40rem] min-w-37.5"
            >
              <OInput
                class="me-4 mt-1"
                :model-value="variableValue(variable.value)"
                :label="raw(variable.label)"
                label-position="inside"
                readonly
                data-test="dashboards-public-dashboard-variable"
              />
            </div>
          </div>
        </template>
      </RenderDashboardCharts>

      <footer
        class="border-border-default px-page-edge text-2xs text-text-secondary flex items-center justify-between gap-3 border-t py-3"
        data-test="dashboards-public-dashboard-footer"
      >
        <PoweredByOpenObserve />
        <span>{{ footerNote }}</span>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, provide } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import PoweredByOpenObserve from "@/components/common/PoweredByOpenObserve.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ThemeSwitcher from "@/components/ThemeSwitcher.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import publicDashboardsService from "@/services/public_dashboards";
import { formatExactDuration } from "@/utils/formatters";

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
  if (secs % 86400 === 0) {
    const n = secs / 86400;
    return t("dashboard.publicDashboard.pastDays", { n }, n);
  }
  if (secs % 3600 === 0) {
    const n = secs / 3600;
    return t("dashboard.publicDashboard.pastHours", { n }, n);
  }
  const n = Math.max(1, Math.round(secs / 60));
  return t("dashboard.publicDashboard.pastMinutes", { n }, n);
}

const selectedPresetLabel = computed<I18nText>(() =>
  selectedPreset.value ? presetLabel(selectedPreset.value) : raw(""),
);

// Start → end of the window the shown snapshot covers; spans of a day or more show the date too.
const windowLabel = computed<I18nText | "">(() => {
  if (!builtAt.value || !selectedPreset.value) return "";
  const endMs = builtAt.value / 1000;
  const startMs = endMs - selectedPreset.value * 1000;
  const opts: Intl.DateTimeFormatOptions =
    selectedPreset.value >= 86400
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" };
  const fmt = (ms: number) => raw(new Date(ms).toLocaleString(undefined, opts));
  return t("dashboard.publicDashboard.window", { start: fmt(startMs), end: fmt(endMs) });
});

const publicVariables = computed<Array<{ label: string; value: unknown }>>(() =>
  Array.isArray(config.value?.variables) ? config.value.variables : [],
);

// A variable missing from the capture falls back to its live default server-side, so empty means unset.
const variableValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") {
    return t("dashboard.publicDashboard.variableUnset");
  }
  return Array.isArray(value) ? value.join(", ") : String(value);
};

const selectPreset = (secs: number) => {
  selectedPreset.value = secs;
  loadData();
};

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

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const refreshSecs = computed(() => Number(config.value?.refresh_secs) || 0);
const refreshing = ref(false);
const footerNote = computed<I18nText>(() =>
  refreshSecs.value > 0
    ? t("dashboard.publicDashboard.footerNoteRefresh", {
        interval: formatExactDuration(refreshSecs.value),
      })
    : t("dashboard.publicDashboard.footerNote"),
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

// Grace past the rebuild's due time so the read lands after the new snapshot is written.
const REBUILD_GRACE_MS = 2000;

// Aim the next read just after the next rebuild is due; a stale or missing snapshot falls back to the plain cadence.
const nextRefreshDelay = (): number => {
  const cadenceMs = refreshSecs.value * 1000;
  if (!builtAt.value) return cadenceMs;
  const due = builtAt.value / 1000 + cadenceMs + REBUILD_GRACE_MS - Date.now();
  return due > 0 && due <= cadenceMs + REBUILD_GRACE_MS ? due : cadenceMs;
};

const scheduleRefresh = () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (refreshSecs.value <= 0) return;
  refreshTimer = setTimeout(async () => {
    // Paused while the tab is hidden, so a background tab never polls.
    if (!document.hidden) await refresh();
    scheduleRefresh();
  }, nextRefreshDelay());
};

const refreshNow = async () => {
  refreshing.value = true;
  await refresh();
  refreshing.value = false;
  scheduleRefresh();
};

onMounted(async () => {
  await load();
  scheduleRefresh();
});

onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer);
});
</script>
