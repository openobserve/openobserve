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
 view-only) fed with the server's materialized result, so no query ever runs from here.
-->
<template>
  <div class="bg-surface-base flex h-screen flex-col">
    <div
      v-if="errorMessage"
      class="flex min-h-[60vh] flex-col items-center justify-center px-4"
      data-test="dashboards-public-dashboard-error"
    >
      <OEmptyState size="hero" :illustration="errorIllustration" :title="errorMessage" />
    </div>

    <div
      v-else-if="!configLoaded"
      class="flex min-h-[60vh] flex-col items-center justify-center gap-3"
      data-test="dashboards-public-dashboard-loading"
    >
      <OSpinner variant="dots" size="lg" />
      <div class="text-text-secondary text-sm">
        {{ t("dashboard.publicDashboard.loading") }}
      </div>
    </div>

    <!-- A range that is loading or cooling down keeps the header, so the viewer can still switch range. -->
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
          <OTag
            v-if="updatedLabel"
            :variant="body?.refreshing ? 'warning-soft' : 'default-soft'"
            class="whitespace-nowrap tabular-nums"
            data-test="dashboards-public-dashboard-updated"
          >
            {{ updatedLabel }}
          </OTag>
          <span
            v-if="nextRefreshLabel"
            class="text-text-secondary text-sm whitespace-nowrap tabular-nums max-md:hidden"
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

      <div v-if="holdNote" class="px-page-edge pt-2">
        <OBanner
          variant="warning"
          icon="warning"
          dense
          :content="holdNote"
          data-test="dashboards-public-dashboard-held"
        />
      </div>
      <div v-else-if="failureNote" class="px-page-edge pt-2">
        <OBanner
          variant="warning"
          icon="warning"
          dense
          :content="failureNote"
          data-test="dashboards-public-dashboard-refresh-failed"
        />
      </div>

      <div
        v-if="state === 'loading' || state === 'building'"
        class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3"
        data-test="dashboards-public-dashboard-loading"
      >
        <OSpinner variant="dots" size="lg" />
        <div class="text-text-secondary text-sm">
          {{ t("dashboard.publicDashboard.loading") }}
        </div>
      </div>

      <div
        v-else-if="state === 'cooldown'"
        class="flex min-h-0 flex-1 flex-col items-center justify-center px-4"
        data-test="dashboards-public-dashboard-cooldown"
      >
        <OEmptyState size="hero" illustration="schedule" :title="cooldownMessage" />
      </div>

      <RenderDashboardCharts
        v-else
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
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { IllustrationName } from "@/lib/core/EmptyState/illustrations";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
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
import {
  clockOffsetMs,
  createPoller,
  retryAfterMs,
  toLocalMs,
  type PollOutcome,
} from "./publicDashboardPolling";

/** A range as the public config lists it, with the key its result is read by. */
type KeyedRange = PublicLinkRange & { key: string };

/** A panel's entry in the data body (4.4). */
interface PanelResult {
  state?: {
    state?: string;
    reason?: string;
    retained?: boolean;
    partial?: boolean;
    truncated?: boolean;
  };
  intent?: string;
  built_at?: number;
  data?: unknown[];
  metadata?: unknown;
  resultMetaData?: unknown[];
}

/** The 200 body of /data (4.4); times are server UTC micros. */
interface DataBody {
  rev?: string;
  built_at?: number | null;
  window?: { start: number; end: number } | null;
  refresh_secs?: number;
  fresh_until?: number | null;
  stale?: boolean;
  stale_reason?: string | null;
  refreshing?: boolean;
  next_retry_at?: number | null;
  last_error_at?: number | null;
  dashboard_updated_at?: number;
  link_rev?: number;
  settings_rev?: number;
  variables?: PublicVariable[];
  panels?: Record<string, PanelResult>;
}

/** A frozen value as the public config lists it; scoped ones name their tab or panel. */
type PublicVariable = { label: string; value: unknown; tab_id?: string; panel_id?: string };

type ViewState =
  | "loading"
  | "building"
  | "ready"
  | "cooldown"
  | "notfound"
  | "expired"
  | "unavailable"
  | "ratelimited"
  | "offline";

const route = useRoute();
const store = useStore();
const { t } = useI18nTyped();
const slug = String(route.params.slug || "");

const state = ref<ViewState>("loading");
const config = ref<Record<string, any>>({});
// The body on screen and the range it belongs to; its rev is sent back as If-None-Match.
const body = ref<DataBody | null>(null);
const bodyKey = ref<string | null>(null);
const selectedKey = ref<string | null>(null);
// Server clock minus local clock, from the last response's Date header.
const clockOffset = ref(0);
// Local time a 429 or a temporary 503 ends, for its countdown; `holdKind` says which one.
const cooldownUntil = ref<number | null>(null);
const holdKind = ref<"ratelimited" | "cooldown" | null>(null);
// Anonymous viewers have no saved timezone, so dates read in the browser's.
const viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// RenderDashboardCharts and TabList read and switch the active tab through this.
const selectedTabId = ref<string>("");
provide("selectedTabId", selectedTabId);

// Date.now() isn't reactive, so countdowns read this ticking copy.
const nowMs = ref(Date.now());

const tabs = computed<any[]>(() => (Array.isArray(config.value.layout) ? config.value.layout : []));
const ranges = computed<KeyedRange[]>(() =>
  Array.isArray(config.value?.ranges) ? config.value.ranges : [],
);
// Every offered range is selectable at once; a cold one builds when it is read.
const rangeOptions = computed<KeyedRange[]>(() => sortRanges(ranges.value));
const selectedRange = computed<KeyedRange | null>(
  () => ranges.value.find((r) => r.key === selectedKey.value) ?? null,
);
const intents = computed<Record<string, string>>(() => config.value?.intents ?? {});

// Missing values are filled with the live default before the build, so empty means the picker had nothing.
const variableValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") {
    return t("dashboard.publicDashboard.variableUnset");
  }
  return Array.isArray(value) ? value.join(", ") : String(value);
};

// Constants are read-only and query nothing, and the grid places each by scope as the live page does.
const frozenVariables = computed(() => {
  // The body lists the values its data was built with, including defaults the link never froze.
  const all: PublicVariable[] = Array.isArray(body.value?.variables)
    ? body.value.variables
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

// The window the body was built for, as the server reports it.
const shownWindow = computed<{ startMs: number; endMs: number } | null>(() => {
  const w = body.value?.window;
  return w ? { startMs: w.start / 1000, endMs: w.end / 1000 } : null;
});

// Any time-aware chrome matches the data.
const currentTimeObj = computed(() => {
  const endMs = shownWindow.value?.endMs ?? Date.now();
  const startMs = shownWindow.value?.startMs ?? endMs;
  return { __global: { start_time: new Date(startMs), end_time: new Date(endMs) } };
});

const clockTime = (micros: number): string =>
  new Date(micros / 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

// Under an hour reads m:ss; longer waits read as hours and minutes.
const countdown = (ms: number): string => {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  if (secs >= 3600) return durationFormatter(secs);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
};

// A server time as milliseconds left on the server's own clock.
const msUntil = (micros: number | null | undefined): number | null => {
  const at = toLocalMs(micros, clockOffset.value);
  return at === null ? null : at - nowMs.value;
};

const emptyPanelData = () => ({ data: [], metadata: { queries: [] }, resultMetaData: [] });

// The renderer prints only a 4xx error's own message; any other code reads "Error Loading Data".
const panelNotice = (message: I18nText) => ({
  ...emptyPanelData(),
  errorDetail: { message, code: "403" },
});

// Markdown and HTML carry their content in the layout, so they need no result.
const CONTENT_PANEL_TYPES = ["markdown", "html"];

const rowCount = (data: unknown[] | undefined): number =>
  Math.max(0, ...(data ?? []).map((rows) => (Array.isArray(rows) ? rows.length : 0)));

// A truncated panel says how many rows it kept; a retained one shows its own build time, dimmed.
const panelBadge = (result: PanelResult): I18nText | undefined => {
  if (result.state?.retained && result.built_at) {
    return t("dashboard.publicDashboard.panelFrom", { time: raw(clockTime(result.built_at)) });
  }
  const rows = rowCount(result.data);
  if (result.state?.truncated && rows > 0) {
    return t("dashboard.publicDashboard.panelTruncated", { count: rows.toLocaleString() }, rows);
  }
  return undefined;
};

const panelEntry = (panel: { id: string; type?: string }) => {
  if (CONTENT_PANEL_TYPES.includes(panel.type ?? "")) return emptyPanelData();
  // A custom chart runs the author's script, so it is never built for the public view.
  if (panel.type === "custom_chart") {
    return panelNotice(t("dashboard.publicDashboard.panelNotAvailable"));
  }
  const result = body.value?.panels?.[panel.id];
  // A panel added since the last build has no entry until the next one.
  if (!result) return panelNotice(t("dashboard.publicDashboard.panelPreparing"));
  if (result.state?.state !== "ok") {
    return panelNotice(
      result.state?.reason === "changed"
        ? t("dashboard.publicDashboard.panelPreparing")
        : t("dashboard.publicDashboard.panelNotAvailable"),
    );
  }
  // The server masks a changed query too; this keeps a layout and a result of different intents apart.
  if (result.intent !== intents.value[panel.id]) {
    return panelNotice(t("dashboard.publicDashboard.panelPreparing"));
  }
  return {
    data: result.data ?? [],
    metadata: result.metadata ?? { queries: [] },
    resultMetaData: result.resultMetaData ?? [],
    isPartialData: !!result.state?.partial,
    dimmed: !!result.state?.retained,
    notice: panelBadge(result),
  };
};

// Each panel renders the materialized result instead of querying.
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

// Start → end of the window the shown body covers; spans of a day or more show the date too.
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

const updatedLabel = computed<I18nText | "">(() => {
  const builtAt = body.value?.built_at;
  if (!builtAt) return "";
  const time = raw(clockTime(builtAt));
  return body.value?.refreshing
    ? t("dashboard.publicDashboard.updatedRefreshing", { time })
    : t("dashboard.publicDashboard.updatedAt", { time });
});

// Counts down to fresh_until on the server's clock; an absolute range has none.
const nextRefreshLabel = computed<I18nText | "">(() => {
  if (!body.value || body.value.refreshing) return "";
  const left = msUntil(body.value.fresh_until);
  if (left === null || left <= 0) return "";
  return t("dashboard.publicDashboard.nextRefreshIn", { time: raw(countdown(left)) });
});

const failureNote = computed<I18nText | null>(() => {
  const failedAt = body.value?.last_error_at;
  if (!failedAt) return null;
  const time = raw(clockTime(failedAt));
  const left = msUntil(body.value?.next_retry_at);
  return left !== null && left > 0
    ? t("dashboard.publicDashboard.refreshFailed", { time, next: raw(countdown(left)) })
    : t("dashboard.publicDashboard.refreshFailedNoRetry", { time });
});

const refreshSecs = computed(() => Number(body.value?.refresh_secs) || 0);
const footerNote = computed<I18nText>(() =>
  refreshSecs.value > 0 && selectedRange.value?.type === "relative"
    ? t("dashboard.publicDashboard.footerNoteRefresh", {
        interval: formatExactDuration(refreshSecs.value),
      })
    : t("dashboard.publicDashboard.footerNote"),
);

const holdTime = computed(() => raw(countdown((cooldownUntil.value ?? nowMs.value) - nowMs.value)));
const cooldownMessage = computed<I18nText>(() =>
  t("dashboard.publicDashboard.cooldown", { time: holdTime.value }),
);
// The data on screen stays while a 429 or a temporary 503 holds; this says why it isn't updating.
const holdNote = computed<I18nText | null>(() => {
  if (state.value !== "ready" || !holdKind.value) return null;
  return holdKind.value === "ratelimited"
    ? t("dashboard.publicDashboard.rateLimitedRetry", { time: holdTime.value })
    : cooldownMessage.value;
});

const ERROR_MESSAGES: Partial<Record<ViewState, () => I18nText>> = {
  notfound: () => t("dashboard.publicDashboard.notAvailable"),
  expired: () => t("dashboard.publicDashboard.expired"),
  unavailable: () => t("dashboard.publicDashboard.unavailable"),
  ratelimited: () => t("dashboard.publicDashboard.rateLimited"),
  offline: () => t("dashboard.publicDashboard.offline"),
};
const errorMessage = computed<I18nText | null>(() => ERROR_MESSAGES[state.value]?.() ?? null);
const ERROR_ILLUSTRATIONS: Partial<Record<ViewState, IllustrationName>> = {
  notfound: "lock",
  expired: "hourglass",
  unavailable: "schedule",
  ratelimited: "hourglass",
  offline: "broken-panel",
};
const errorIllustration = computed<IllustrationName>(
  () => ERROR_ILLUSTRATIONS[state.value] ?? "broken-panel",
);

const pickDefaultRange = (): string | null => {
  const def: string | undefined = config.value?.default_key;
  if (def && rangeOptions.value.some((r) => r.key === def)) return def;
  return rangeOptions.value[0]?.key ?? null;
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

const STALE_CONFIG_REASONS = ["dashboard", "link", "settings"];
// One config read per body rev at most, so a body that stays behind can't repeat it every poll.
let configSyncedRev: string | undefined;

const configBehind = (b: DataBody): boolean => {
  if (b.rev !== undefined && b.rev === configSyncedRev) return false;
  const newer = (field: "dashboard_updated_at" | "link_rev" | "settings_rev") =>
    (b[field] ?? 0) > (config.value?.[field] ?? 0);
  return (
    newer("dashboard_updated_at") ||
    newer("link_rev") ||
    newer("settings_rev") ||
    STALE_CONFIG_REASONS.includes(b.stale_reason ?? "")
  );
};

const configLoaded = ref(false);

const loadConfig = async () => {
  const res = await publicDashboardsService.getConfig(slug);
  applyConfig(res.data ?? {});
  configLoaded.value = true;
  if (!ranges.value.some((r) => r.key === selectedKey.value)) {
    selectedKey.value = pickDefaultRange();
  }
};

const responseOf = (e: unknown) =>
  (e as { response?: { status?: number; headers?: Record<string, unknown>; data?: any } })
    ?.response;

// Each read takes the next id, so a slower reply for a range switched away from is dropped.
let dataRequestId = 0;

const bodyOutcome = (b: DataBody, hintMs: number | null): PollOutcome => ({
  kind: "body",
  refreshing: !!b.refreshing,
  hintMs,
});

const hold = (kind: "ratelimited" | "cooldown", untilMs: number | null, localNow: number) => {
  holdKind.value = kind;
  cooldownUntil.value = untilMs === null ? null : localNow + untilMs;
};

// A failed read keeps what is on screen, except a paused link, which must stop showing it.
const failedRead = (e: unknown, shown: boolean): PollOutcome => {
  // Each answer replaces the last hold; only a 429 or a temporary 503 sets a new one.
  holdKind.value = null;
  const res = responseOf(e);
  const localNow = Date.now();
  if (res?.headers) clockOffset.value = clockOffsetMs(res.headers, localNow);
  const hint = retryAfterMs(res?.headers, clockOffset.value, localNow);
  const status = res?.status;
  if (status === 410 || (status !== undefined && status < 500 && status !== 429)) {
    state.value = status === 410 ? "expired" : "notfound";
    return { kind: "final" };
  }
  if (status === 429) {
    hold("ratelimited", hint, localNow);
    if (!shown) state.value = "ratelimited";
    return { kind: "wait", retryAfterMs: hint, client: true };
  }
  // A paused or blocked link answers 503 without Retry-After; capacity and authorization limits name one.
  const cooldown = res?.data?.state === "cooldown";
  if (status === 503 && (cooldown || hint !== null)) {
    hold("cooldown", hint ?? (cooldown ? msUntil(res?.data?.next_retry_at) : null), localNow);
    if (!shown) state.value = "cooldown";
    return { kind: "wait", retryAfterMs: hint };
  }
  if (status === 503) {
    body.value = null;
    state.value = "unavailable";
    return { kind: "wait", retryAfterMs: hint };
  }
  if (!shown) state.value = "offline";
  return { kind: "error" };
};

// One read of /data, with the config read first on the first load and whenever the body is newer.
const check = async (): Promise<PollOutcome> => {
  const requestId = ++dataRequestId;
  const shown = () =>
    state.value === "ready" && !!body.value && bodyKey.value === selectedKey.value;
  try {
    if (!configLoaded.value) await loadConfig();
    const key = selectedKey.value;
    if (!key) {
      state.value = "notfound";
      return { kind: "final" };
    }
    const current = shown() ? body.value : null;
    const res = await publicDashboardsService.getData(slug, key, current?.rev);
    if (requestId !== dataRequestId) return { kind: "error" };
    const localNow = Date.now();
    clockOffset.value = clockOffsetMs(res.headers, localNow);
    const hint = retryAfterMs(res.headers, clockOffset.value, localNow);
    holdKind.value = null;
    if (res.status === 202) {
      if (!current) state.value = "building";
      return { kind: "wait", retryAfterMs: hint };
    }
    // 304 keeps the body on screen.
    if (res.status !== 304 || !current) {
      body.value = res.data ?? {};
      bodyKey.value = key;
    }
    state.value = "ready";
    const next = body.value as DataBody;
    if (configBehind(next)) {
      configSyncedRev = next.rev;
      await loadConfig();
      // The author removed this range; the default's result replaces it.
      if (selectedKey.value !== key) {
        showRange(selectedKey.value);
        return { kind: "error" };
      }
    }
    return bodyOutcome(next, hint);
  } catch (e: unknown) {
    if (requestId !== dataRequestId) return { kind: "error" };
    // An edit can drop the range on screen; the config says whether the link itself is gone.
    if (responseOf(e)?.status === 404 && configLoaded.value) {
      const key = selectedKey.value;
      try {
        await loadConfig();
      } catch (configError: unknown) {
        return failedRead(configError, false);
      }
      if (selectedKey.value !== key) {
        showRange(selectedKey.value);
        return { kind: "error" };
      }
    }
    return failedRead(e, shown());
  }
};

const poller = createPoller({ check, isHidden: () => document.hidden });

// The result on screen belongs to the range left behind, so it goes with it.
function showRange(key: string | null) {
  selectedKey.value = key;
  body.value = null;
  bodyKey.value = null;
  // A 429 holds this viewer on every range, so the new one waits it out under the same message.
  const limited = holdKind.value === "ratelimited" && (cooldownUntil.value ?? 0) > Date.now();
  state.value = limited ? "ratelimited" : "loading";
  poller.start();
}

const selectRange = (key: string) => {
  if (key !== selectedKey.value) showRange(key);
};

// Polling pauses while hidden and checks at once on return, so pause, revoke and edits still arrive.
const onVisibilityChange = () => (document.hidden ? poller.hidden() : poller.visible());

// The slug is a bearer secret: keep the page out of search indexes and outgoing Referer headers.
const PRIVACY_META: Array<[string, string]> = [
  ["robots", "noindex, nofollow"],
  ["referrer", "no-referrer"],
];
const addedMeta: HTMLMetaElement[] = [];
let clockTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  for (const [name, content] of PRIVACY_META) {
    const meta = document.createElement("meta");
    meta.name = name;
    meta.content = content;
    document.head.appendChild(meta);
    addedMeta.push(meta);
  }
  clockTimer = setInterval(() => (nowMs.value = Date.now()), 1000);
  document.addEventListener("visibilitychange", onVisibilityChange);
  poller.start();
});

onBeforeUnmount(() => {
  poller.stop();
  if (clockTimer) clearInterval(clockTimer);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  addedMeta.forEach((meta) => meta.remove());
});
</script>
