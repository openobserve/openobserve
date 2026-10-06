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
      v-else-if="state === 'notfound' || state === 'unavailable' || state === 'expired'"
      class="flex min-h-[60vh] flex-col items-center justify-center"
      data-test="dashboards-public-dashboard-error"
    >
      <div class="text-text-secondary text-sm">
        {{
          state === "expired"
            ? t("dashboard.publicDashboard.expired")
            : state === "unavailable"
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
          <span
            v-if="windowLabel && !pickerShowsWindow"
            class="text-text-secondary text-sm whitespace-nowrap tabular-nums max-lg:hidden"
            data-test="dashboards-public-dashboard-window"
          >
            {{ windowLabel }}
          </span>
          <div class="flex h-8 self-center max-md:hidden">
            <OSeparator vertical />
          </div>
          <span
            v-if="nextRefreshLabel"
            class="text-text-secondary text-sm whitespace-nowrap tabular-nums"
            data-test="dashboards-public-dashboard-next-refresh"
          >
            {{ nextRefreshLabel }}
          </span>
          <ODropdown v-if="rangeOptions.length > 1" side="bottom" align="end">
            <template #trigger>
              <OButton
                variant="outline"
                size="sm-toolbar"
                class="h-8!"
                icon-left="schedule"
                icon-right="keyboard-arrow-down"
                data-test="dashboards-public-dashboard-preset-btn"
              >
                {{ selectedRange ? rangeLabel(selectedRange) : "" }}
              </OButton>
            </template>
            <ODropdownItem
              v-for="option in rangeOptions"
              :key="option.key"
              :data-test="`dashboards-public-dashboard-preset-${option.key}`"
              @select="selectRange(option.key)"
            >
              {{ rangeLabel(option) }}
            </ODropdownItem>
          </ODropdown>
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
              :key="variable.key"
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
        class="border-border-default px-page-edge text-2xs text-text-secondary flex items-center gap-2 border-t py-3"
        data-test="dashboards-public-dashboard-footer"
      >
        <PoweredByOpenObserve />
        <OIcon
          name="info-outline"
          size="sm"
          class="cursor-help"
          data-test="dashboards-public-dashboard-footer-info"
        >
          <OTooltip side="top" max-width="20rem" :content="footerNote" />
        </OIcon>
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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ThemeSwitcher from "@/components/ThemeSwitcher.vue";
import publicDashboardsService from "@/services/public_dashboards";
import { durationFormatter, formatExactDuration } from "@/utils/formatters";
import type { PublicLinkRange } from "@/services/public_dashboards_admin";
import { sortRanges } from "@/components/dashboards/PublicLinkForm.schema";
import { longRange } from "@/components/dashboards/publicLinkDisplay";

/** A range as the public config lists it, with the key its snapshot is read by. */
type KeyedRange = PublicLinkRange & { key: string };

const route = useRoute();
const store = useStore();
const { t } = useI18nTyped();
const slug = String(route.params.slug || "");

const state = ref<"loading" | "ready" | "preparing" | "notfound" | "unavailable" | "expired">(
  "loading",
);
const config = ref<Record<string, any>>({});
const snapshot = ref<Record<string, any>>({});
const selectedKey = ref<string | null>(null);
// Anonymous viewers have no saved timezone, so dates read in the browser's.
const viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// RenderDashboardCharts and TabList read and switch the active tab through this.
const selectedTabId = ref<string>("");
provide("selectedTabId", selectedTabId);

const tabs = computed<any[]>(() => (Array.isArray(config.value.layout) ? config.value.layout : []));
const ranges = computed<KeyedRange[]>(() =>
  Array.isArray(config.value?.ranges) ? config.value.ranges : [],
);
// Only ranges with a built snapshot can be shown.
const rangeOptions = computed<KeyedRange[]>(() => {
  const available: string[] = config.value?.available_keys ?? [];
  return sortRanges(ranges.value.filter((r) => available.includes(r.key)));
});
const selectedRange = computed<KeyedRange | null>(
  () => ranges.value.find((r) => r.key === selectedKey.value) ?? null,
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

// An absolute range's window is fixed; a relative one ends when its snapshot was built.
const shownWindow = computed<{ startMs: number; endMs: number } | null>(() => {
  const range = selectedRange.value;
  if (!range) return null;
  if (range.type === "absolute") return { startMs: range.start / 1000, endMs: range.end / 1000 };
  if (!builtAt.value) return null;
  const endMs = builtAt.value / 1000;
  return { startMs: endMs - range.secs * 1000, endMs };
});

// The window the snapshot was built for, so any time-aware chrome matches the data.
const currentTimeObj = computed(() => {
  const endMs = shownWindow.value?.endMs ?? Date.now();
  const startMs = shownWindow.value?.startMs ?? endMs;
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

// The picker already names an absolute range by its dates, so the header doesn't repeat them.
const pickerShowsWindow = computed(
  () => rangeOptions.value.length > 1 && selectedRange.value?.type === "absolute",
);

function rangeLabel(range: PublicLinkRange): I18nText {
  return longRange(range, t, viewerTimezone);
}

// Start → end of the window the shown snapshot covers; spans of a day or more show the date too.
const windowLabel = computed<I18nText | "">(() => {
  if (!shownWindow.value) return "";
  const { startMs, endMs } = shownWindow.value;
  const opts: Intl.DateTimeFormatOptions =
    endMs - startMs >= 86_400_000
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" };
  const fmt = (ms: number) => raw(new Date(ms).toLocaleString(undefined, opts));
  return t("dashboard.publicDashboard.window", { start: fmt(startMs), end: fmt(endMs) });
});

/** A frozen value as the public config lists it; scoped ones name their tab or panel. */
type PublicVariable = { label: string; value: unknown; tab_id?: string; panel_id?: string };

// Global values, plus those scoped to the open tab or to a panel on it, as the live page shows.
const publicVariables = computed<Array<{ key: string; label: string; value: unknown }>>(() => {
  const all: PublicVariable[] = Array.isArray(config.value?.variables)
    ? config.value.variables
    : [];
  const tab = tabs.value.find((t) => t.tabId === selectedTabId.value);
  const panelTitle = (id: string) =>
    (tab?.panels ?? []).find((p: { id: string }) => p.id === id)?.title as string | undefined;
  return all.flatMap((v) => {
    if (v.tab_id) {
      return v.tab_id === selectedTabId.value
        ? [{ key: `${v.label}.t.${v.tab_id}`, label: v.label, value: v.value }]
        : [];
    }
    if (v.panel_id) {
      const title = panelTitle(v.panel_id);
      return title === undefined
        ? []
        : [{ key: `${v.label}.p.${v.panel_id}`, label: `${title} · ${v.label}`, value: v.value }];
    }
    return [{ key: v.label, label: v.label, value: v.value }];
  });
});

// A variable missing from the capture falls back to its live default server-side, so empty means unset.
const variableValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") {
    return t("dashboard.publicDashboard.variableUnset");
  }
  return Array.isArray(value) ? value.join(", ") : String(value);
};

const selectRange = async (key: string) => {
  selectedKey.value = key;
  await loadData();
  scheduleRefresh();
};

const pickDefaultRange = (): string | null => {
  const def: string | undefined = config.value?.default_key;
  if (def && rangeOptions.value.some((r) => r.key === def)) return def;
  return rangeOptions.value[0]?.key ?? null;
};

const mapError = (e: unknown) => {
  const status = (e as { response?: { status?: number } })?.response?.status;
  state.value = status === 410 ? "expired" : status === 503 ? "unavailable" : "notfound";
};

const loadData = async () => {
  // No preset resolved yet means no snapshot has been built — show "preparing"
  // rather than hanging on the loading spinner forever.
  if (selectedKey.value == null) {
    state.value = "preparing";
    return;
  }
  try {
    const res = await publicDashboardsService.getData(slug, selectedKey.value);
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
    selectedKey.value = pickDefaultRange();
    await loadData();
  } catch (e: unknown) {
    mapError(e);
  }
};

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const refreshSecs = computed(() => Number(config.value?.refresh_secs) || 0);
const hasRelative = computed(() => ranges.value.some((r) => r.type === "relative"));
// An absolute range never changes, so it shows no countdown and the page stops polling for it.
const pollsForSelection = computed(
  () => refreshSecs.value > 0 && selectedRange.value?.type !== "absolute",
);
const footerNote = computed<I18nText>(() =>
  refreshSecs.value > 0 && hasRelative.value
    ? t("dashboard.publicDashboard.footerNoteRefresh", {
        interval: formatExactDuration(refreshSecs.value),
      })
    : t("dashboard.publicDashboard.footerNote"),
);

// Re-read on the author's "Refresh every" cadence — the same interval the snapshot rebuilds on.
const refresh = async () => {
  if (state.value !== "ready" && state.value !== "preparing") return;
  try {
    const res = await publicDashboardsService.getConfig(slug);
    applyConfig(res.data ?? {});
    if (selectedKey.value === null) selectedKey.value = pickDefaultRange();
    await loadData();
  } catch (e: unknown) {
    mapError(e);
  }
};

// Grace past the rebuild's due time so the read lands after the new snapshot is written.
const REBUILD_GRACE_MS = 2000;
// The first snapshot lands within seconds of publishing, so waiting a whole cadence would strand the page.
const PREPARING_POLL_MS = 5000;
// A late rebuild is re-checked this often, so the countdown doesn't sit at "Refreshing" for a whole cadence.
const OVERDUE_POLL_MS = 15000;

// Date.now() isn't reactive, so the countdown reads this ticking copy.
const nowMs = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;
const nextRefreshLabel = computed<I18nText | "">(() => {
  if (!builtAt.value || !pollsForSelection.value) return "";
  const left = Math.ceil((builtAt.value / 1000 + refreshSecs.value * 1000 - nowMs.value) / 1000);
  return left > 0
    ? t("dashboard.publicDashboard.nextRefreshIn", { time: raw(durationFormatter(left)) })
    : t("dashboard.publicDashboard.refreshingNow");
});

// Aim the next read just after the next rebuild is due; an overdue one is re-checked sooner, a missing one waits a cadence.
const nextRefreshDelay = (): number => {
  const cadenceMs = refreshSecs.value * 1000;
  if (state.value === "preparing") return Math.min(cadenceMs, PREPARING_POLL_MS);
  if (!builtAt.value) return cadenceMs;
  const due = builtAt.value / 1000 + cadenceMs + REBUILD_GRACE_MS - Date.now();
  if (due <= 0) return Math.min(cadenceMs, OVERDUE_POLL_MS);
  return due <= cadenceMs + REBUILD_GRACE_MS ? due : cadenceMs;
};

const scheduleRefresh = () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!pollsForSelection.value && state.value !== "preparing") return;
  refreshTimer = setTimeout(async () => {
    // Paused while the tab is hidden, so a background tab never polls.
    if (!document.hidden) await refresh();
    scheduleRefresh();
  }, nextRefreshDelay());
};

// The slug is a bearer secret: keep the page out of search indexes and outgoing Referer headers.
const PRIVACY_META: Array<[string, string]> = [
  ["robots", "noindex, nofollow"],
  ["referrer", "no-referrer"],
];
const addedMeta: HTMLMetaElement[] = [];

onMounted(async () => {
  for (const [name, content] of PRIVACY_META) {
    const meta = document.createElement("meta");
    meta.name = name;
    meta.content = content;
    document.head.appendChild(meta);
    addedMeta.push(meta);
  }
  clockTimer = setInterval(() => (nowMs.value = Date.now()), 1000);
  await load();
  scheduleRefresh();
});

onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (clockTimer) clearInterval(clockTimer);
  addedMeta.forEach((meta) => meta.remove());
});
</script>
