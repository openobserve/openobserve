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
      v-else-if="errorMessage"
      class="flex min-h-[60vh] flex-col items-center justify-center px-4"
      data-test="dashboards-public-dashboard-error"
    >
      <div class="text-text-secondary max-w-md text-center text-sm">
        {{ errorMessage }}
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
      />

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
import { ref, computed, watch, onMounted, onBeforeUnmount, provide } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import PoweredByOpenObserve from "@/components/common/PoweredByOpenObserve.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
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

type ViewState =
  | "loading"
  | "ready"
  | "preparing"
  | "notfound"
  | "expired"
  | "unavailable"
  | "ratelimited"
  | "offline";
const state = ref<ViewState>("loading");
// Temporary failures in a row; while non-zero the page retries with backoff.
const failures = ref(0);
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

// Missing values are filled with the live default before the build, so empty means the picker had nothing.
const variableValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") {
    return t("dashboard.publicDashboard.variableUnset");
  }
  return Array.isArray(value) ? value.join(", ") : String(value);
};

/** A frozen value as the public config lists it; scoped ones name their tab or panel. */
type PublicVariable = { label: string; value: unknown; tab_id?: string; panel_id?: string };

// Constants are read-only and query nothing, and the grid places each by scope as the live page does.
const frozenVariables = computed(() => {
  // The snapshot lists the values its data was built with, including defaults the link never froze.
  const all: PublicVariable[] = Array.isArray(snapshot.value?.variables)
    ? snapshot.value.variables
    : Array.isArray(config.value?.variables)
      ? config.value.variables
      : [];
  return all.map((v, i) => ({
    // Scoped entries repeat a label, and the grid keys variables by name.
    name: `public_var_${i}`,
    label: v.label,
    type: "constant",
    value: variableValue(v.value),
    scope: v.tab_id ? "tabs" : v.panel_id ? "panels" : "global",
    ...(v.tab_id ? { tabs: [v.tab_id] } : {}),
    ...(v.panel_id ? { panels: [v.panel_id] } : {}),
  }));
});

const dashboardData = computed(() => ({
  dashboardId: slug,
  title: config.value.title,
  version: 8,
  tabs: tabs.value,
  variables: { list: frozenVariables.value },
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

const emptyPanelData = () => ({ data: [], metadata: { queries: [] }, resultMetaData: [] });

// The renderer prints only a 4xx error's own message; any other code reads "Error Loading Data".
const panelNotice = (message: I18nText) => ({
  ...emptyPanelData(),
  errorDetail: { message, code: "403" },
});

// Markdown and HTML carry their content in the layout, so they need no snapshot.
const CONTENT_PANEL_TYPES = ["markdown", "html"];

const panelEntry = (panel: { id: string; type?: string }) => {
  if (CONTENT_PANEL_TYPES.includes(panel.type ?? "")) return emptyPanelData();
  // A custom chart runs the author's script, so it is never built for the public view.
  if (panel.type === "custom_chart") {
    return panelNotice(t("dashboard.publicDashboard.panelNotAvailable"));
  }
  const snap = snapshot.value?.panels?.[panel.id];
  // A panel added since the last build has no entry until the next rebuild.
  if (!snap) return panelNotice(t("dashboard.publicDashboard.panelPreparing"));
  if (snap.state?.state !== "ok") {
    return panelNotice(t("dashboard.publicDashboard.panelNotAvailable"));
  }
  return {
    data: snap.data ?? [],
    metadata: snap.metadata ?? { queries: [] },
    resultMetaData: snap.resultMetaData ?? [],
  };
};

// Each panel renders its snapshot instead of querying.
const injectedPanelData = computed(() => {
  const out: Record<string, unknown> = {};
  for (const tab of tabs.value) {
    for (const panel of tab?.panels ?? []) out[panel.id] = panelEntry(panel);
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

const TRANSIENT_STATES: ViewState[] = ["unavailable", "ratelimited", "offline"];
const RETRY_DELAYS_MS = [5_000, 10_000, 30_000, 60_000];

const ERROR_MESSAGES: Partial<Record<ViewState, () => I18nText>> = {
  notfound: () => t("dashboard.publicDashboard.notAvailable"),
  expired: () => t("dashboard.publicDashboard.expired"),
  unavailable: () => t("dashboard.publicDashboard.unavailable"),
  ratelimited: () => t("dashboard.publicDashboard.rateLimited"),
  offline: () => t("dashboard.publicDashboard.offline"),
};
const errorMessage = computed<I18nText | null>(() => ERROR_MESSAGES[state.value]?.() ?? null);

// Only 404 and 410 are final; a paused link, a rate limit or a network error can clear up.
const errorState = (e: unknown): ViewState => {
  const status = (e as { response?: { status?: number } })?.response?.status;
  if (status === 410) return "expired";
  if (status === 503) return "unavailable";
  if (status === 429) return "ratelimited";
  if (status === undefined || status >= 500) return "offline";
  return "notfound";
};

const mapError = (e: unknown) => {
  const next = errorState(e);
  if (!TRANSIENT_STATES.includes(next)) {
    failures.value = 0;
    state.value = next;
    return;
  }
  failures.value += 1;
  // A hiccup keeps the last data on screen; a paused link must stop showing it.
  if (state.value !== "ready" || next === "unavailable") state.value = next;
};

// Each read takes the next id, so a slower reply for a range switched away from is dropped.
let dataRequestId = 0;

const loadData = async () => {
  const requestId = ++dataRequestId;
  // No preset resolved yet means no snapshot has been built, so show "preparing" instead of a spinner.
  if (selectedKey.value === null) {
    state.value = "preparing";
    return;
  }
  try {
    const res = await publicDashboardsService.getData(slug, selectedKey.value);
    if (requestId !== dataRequestId) return;
    if (res.status === 202) {
      failures.value = 0;
      state.value = "preparing";
      return;
    }
    snapshot.value = res.data ?? {};
    failures.value = 0;
    state.value = "ready";
  } catch (e: unknown) {
    if (requestId === dataRequestId) mapError(e);
  }
};

// Anonymous viewers only get the minimal /config bootstrap, which lacks the timestamp column the renderer needs.
const applyTimestampColumn = () => {
  const column = config.value?.timestamp_column;
  if (column && store.state.zoConfig?.timestamp_column !== column) {
    store.dispatch("setConfig", { ...store.state.zoConfig, timestamp_column: column });
  }
};

// The bootstrap /config resolves unawaited and replaces zoConfig wholesale, possibly after applyConfig ran.
watch(() => store.state.zoConfig?.timestamp_column, applyTimestampColumn);

const applyConfig = (next: Record<string, any>) => {
  // Keep the layout reference when unchanged so the grid is not rebuilt on every refresh.
  const sameLayout = JSON.stringify(next.layout) === JSON.stringify(config.value.layout);
  config.value = sameLayout ? { ...next, layout: config.value.layout } : next;
  applyTimestampColumn();
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
// An absolute range's data never changes, so it shows no countdown and is not aimed at rebuilds.
const rebuildsSelection = computed(
  () => refreshSecs.value > 0 && selectedRange.value?.type !== "absolute",
);
const footerNote = computed<I18nText>(() =>
  refreshSecs.value > 0 && hasRelative.value
    ? t("dashboard.publicDashboard.footerNoteRefresh", {
        interval: formatExactDuration(refreshSecs.value),
      })
    : t("dashboard.publicDashboard.footerNote"),
);

// Config is re-read before data so every read also sees a paused, revoked, expired or edited link.
const refresh = async () => {
  try {
    const res = await publicDashboardsService.getConfig(slug);
    applyConfig(res.data ?? {});
    // The author may have removed the viewer's range, whose snapshot then never arrives.
    if (!rangeOptions.value.some((r) => r.key === selectedKey.value)) {
      selectedKey.value = pickDefaultRange();
    }
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
// A pause, revoke, expiry or edit must reach every open page this soon, whatever the cadence or range.
const STATUS_CHECK_MS = 60000;
const FINAL_STATES: ViewState[] = ["notfound", "expired"];

// Date.now() isn't reactive, so the countdown reads this ticking copy.
const nowMs = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;
const nextRefreshLabel = computed<I18nText | "">(() => {
  if (!builtAt.value || !rebuildsSelection.value) return "";
  const left = Math.ceil((builtAt.value / 1000 + refreshSecs.value * 1000 - nowMs.value) / 1000);
  return left > 0
    ? t("dashboard.publicDashboard.nextRefreshIn", { time: raw(durationFormatter(left)) })
    : t("dashboard.publicDashboard.refreshingNow");
});

// Aim the next read just after the next rebuild is due, never later than the status check; overdue re-checks sooner, failed backs off.
const nextRefreshDelay = (): number => {
  if (failures.value > 0) {
    return RETRY_DELAYS_MS[Math.min(failures.value, RETRY_DELAYS_MS.length) - 1];
  }
  if (state.value === "preparing") return PREPARING_POLL_MS;
  if (!rebuildsSelection.value || !builtAt.value) return STATUS_CHECK_MS;
  const cadenceMs = refreshSecs.value * 1000;
  const due = builtAt.value / 1000 + cadenceMs + REBUILD_GRACE_MS - Date.now();
  if (due <= 0) return Math.min(cadenceMs, OVERDUE_POLL_MS);
  // Also keeps a month-long cadence under setTimeout's ~24.8-day limit, past which it fires at once.
  return Math.min(due, STATUS_CHECK_MS);
};

const scheduleRefresh = () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (FINAL_STATES.includes(state.value)) return;
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
