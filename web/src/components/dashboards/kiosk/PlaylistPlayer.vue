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
  <div
    class="bg-surface-base flex h-full min-h-0 flex-col"
    :class="pointerActive ? '' : 'cursor-none [&_*]:cursor-none!'"
    data-test="dashboard-playlist-player"
  >
    <PlaylistStrip
      :title="slideName(currentIndex)"
      :current="positionOf(currentIndex).current"
      :total="positionOf(currentIndex).total"
      :next-name="slideName(player.nextIndex.value)"
      :progress="player.progress.value"
      :next-at="player.nextAt.value"
      :skipped="skipped"
      :time-range-label="timeRangeLabel"
      :held="player.held.value"
      :paused="player.state.paused"
      :paused-at="player.state.pausedAt"
      :waiting="player.waiting.value"
      :last-success-at="currentHealth?.lastSuccessAt ?? null"
      :timezone="timezone"
      @prev="player.prev()"
      @next="player.next()"
      @toggle-pause="player.togglePause()"
      @exit="emit('exit')"
    />
    <OBanner
      v-if="intervalNoticeVisible"
      variant="info"
      icon="schedule"
      dense
      bar
      :content="
        t('dashboard.playlist.intervalAdjusted', {
          interval: formatRefreshLabel(config.intervalSeconds, t),
        })
      "
      data-test="dashboard-playlist-interval-notice"
    />
    <div class="relative min-h-0 flex-1">
      <!-- Inert: a dashboard that focuses an element inside its frame would otherwise swallow the next key press. -->
      <iframe
        v-for="slot in frames"
        :key="slot.key"
        :ref="(el) => setFrameEl(slot.key, el)"
        :src="slideSrc(slot.index)"
        :title="slideName(slot.index)"
        inert
        tabindex="-1"
        class="pointer-events-none absolute inset-0 size-full border-0 transition-opacity duration-300"
        :class="frameClass(slot)"
        :data-test="`dashboard-playlist-frame-${slot.index}`"
        :data-role="frameRole(slot)"
        @load="onFrameLoad(slot.key, $event)"
      />
      <PlaylistHoldingCard
        v-if="holdingIndex !== null"
        :eyebrow="
          player.state.shown ? t('dashboard.playlist.loading') : t('dashboard.playlist.starting')
        "
        :title="slideName(holdingIndex)"
        :label="positionLabel(holdingIndex)"
      />
      <div
        v-if="player.state.phase === 'empty'"
        class="bg-surface-base absolute inset-0 z-30 flex items-center justify-center"
        data-test="dashboard-playlist-empty-state"
      >
        <OEmptyState
          icon="tv"
          :title="t('dashboard.playlist.emptyStateTitle')"
          :description="t('dashboard.playlist.emptyStateDescription')"
          :action-label="t('dashboard.playlist.tryAgain')"
          action-icon="refresh"
          @action="player.retry()"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useQueries } from "@tanstack/vue-query";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import PlaylistStrip from "@/components/dashboards/kiosk/PlaylistStrip.vue";
import PlaylistHoldingCard from "@/components/dashboards/kiosk/PlaylistHoldingCard.vue";
import { usePlaylistPlayer, type PlayerSlot } from "@/composables/dashboard/usePlaylistPlayer";
import { useIdleReveal } from "@/composables/dashboard/useKioskDisplay";
import { dashboardsByFolderQuery, toSearchHit } from "@/services/dashboards.queries";
import { pingBackend } from "@/services/health";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatRefreshLabel, formatRelativePeriod } from "@/utils/dashboard/kiosk";
import {
  PLAYLIST_VIEW_PATH,
  buildSlideQuery,
  isFramingBlocked,
  isPlaylistFrameMessage,
  type PlaylistConfig,
} from "@/utils/dashboard/playlist";

const props = withDefaults(
  defineProps<{
    config: PlaylistConfig;
    timezone?: string;
    /** The link's interval was clamped or unreadable, so say which one is in use. */
    intervalAdjusted?: boolean;
  }>(),
  { timezone: undefined, intervalAdjusted: false },
);

const emit = defineEmits<{
  slide: [index: number];
  fallback: [index: number];
  exit: [];
}>();

const { t } = useI18nTyped();
const router = useRouter();

const INTERVAL_NOTICE_MS = 8000;

const entryCount = props.config.entries.length;

const player = usePlaylistPlayer({
  count: entryCount,
  intervalSeconds: props.config.intervalSeconds,
  startIndex: props.config.slideIndex,
  onSlideShown: (index) => emit("slide", index),
  onFallback: (index) => emit("fallback", index),
  probe: pingBackend,
});

const currentIndex = computed(() => player.currentIndex.value);
const currentHealth = computed(() => player.state.slides[currentIndex.value]?.health ?? null);

const frames = computed(() =>
  [player.state.leaving, player.state.shown, player.state.pending].filter(
    (slot): slot is PlayerSlot => !!slot,
  ),
);

// Names come from each folder's (usually cached) list, so the first slide is named before its frame starts.
const folderIds = [...new Set(props.config.entries.map((entry) => entry.folderId))];
const folderLists = useQueries({
  queries: computed(() =>
    folderIds.map((folderId) => dashboardsByFolderQuery(props.config.org, folderId)),
  ),
});

const listedNames = computed(() => {
  const found = new Map<string, string>();
  folderLists.value.forEach((result) => {
    (result.data ?? []).map(toSearchHit).forEach((hit) => {
      found.set(`${hit.folderId}/${hit.dashboardId}`, hit.title);
    });
  });
  return found;
});

const names = computed(() =>
  props.config.entries.map(
    (entry, index) =>
      player.state.slides[index]?.title ||
      listedNames.value.get(`${entry.folderId}/${entry.dashboardId}`) ||
      entry.dashboardId,
  ),
);

const slideName = (index: number) => raw(names.value[index] ?? "");

/** "2 of 3" counts only dashboards that can be shown. */
const positionOf = (index: number) => {
  const playable = player.state.slides
    .map((slide, i) => ({ i, ok: !slide.missing || i === index }))
    .filter((slide) => slide.ok);
  const current = playable.findIndex((slide) => slide.i === index) + 1;
  return { current: Math.max(1, current), total: playable.length };
};

const positionLabel = (index: number): I18nText =>
  t("dashboard.playlist.position", positionOf(index));

const skipped = computed(() =>
  player.state.slides.flatMap((slide, index) => {
    if (!slide.missing) return [];
    const name = slideName(index);
    return [
      slide.missing === "forbidden"
        ? t("dashboard.playlist.skippedForbidden", { name })
        : t("dashboard.playlist.skippedNotFound", { name }),
    ];
  }),
);

const holdingIndex = computed(() => {
  if (player.state.phase === "empty") return null;
  if (!player.state.shown) return currentIndex.value;
  return player.jumpTarget.value;
});

const timeRangeLabel = computed(() => formatRelativePeriod(props.config.period, t));

const srcCache = new Map<number, string>();
const slideSrc = (index: number) => {
  let src = srcCache.get(index);
  if (!src) {
    src = router.resolve({
      path: PLAYLIST_VIEW_PATH,
      query: buildSlideQuery(props.config, index, "frame"),
    }).href;
    srcCache.set(index, src);
  }
  return src;
};

const frameRole = (slot: PlayerSlot) => {
  if (slot === player.state.shown) return "shown";
  if (slot === player.state.pending) return "pending";
  return "leaving";
};

const frameClass = (slot: PlayerSlot) => {
  const role = frameRole(slot);
  if (role === "shown") return "z-10 opacity-100";
  if (role === "leaving") return "z-0 opacity-100";
  return "z-0 opacity-0";
};

const frameEls = new Map<number, HTMLIFrameElement>();
const setFrameEl = (key: number, el: unknown) => {
  if (el instanceof HTMLIFrameElement) frameEls.set(key, el);
  else frameEls.delete(key);
};

const keyForSource = (source: MessageEventSource | null) => {
  if (!source) return null;
  for (const [key, el] of frameEls) {
    if (el.contentWindow === source) return key;
  }
  return null;
};

const onWindowMessage = (event: MessageEvent) => {
  if (event.origin !== window.location.origin) return;
  if (!isPlaylistFrameMessage(event.data)) return;
  const key = keyForSource(event.source);
  if (key !== null) player.onMessage(key, event.data);
};

/** Only the response headers can tell a framing block from a browser error page (offline, reset). */
const checkFraming = async (key: number, src: string) => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    player.onFrameFailed(key);
    return;
  }
  try {
    const response = await fetch(src, { credentials: "same-origin", cache: "no-store" });
    if (isFramingBlocked(response.headers, window.location.origin)) player.onFrameBlocked(key);
    else player.onFrameFailed(key);
  } catch {
    player.onFrameFailed(key);
  }
};

const onFrameLoad = (key: number, event: Event) => {
  const el = event.target as HTMLIFrameElement | null;
  let readable = false;
  try {
    readable = !!el?.contentDocument;
  } catch {
    readable = false;
  }
  if (readable) player.onFrameLoaded(key);
  else if (el) void checkFraming(key, el.src);
};

const onOnline = () => player.onOnline();
const onOffline = () => player.onOffline();

const { active: pointerActive } = useIdleReveal(computed(() => true));

const intervalNoticeVisible = ref(props.intervalAdjusted);
let intervalNoticeTimer: ReturnType<typeof setTimeout> | null = null;

const whenFree = (action: () => void) => () => {
  if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return;
  action();
};

useShortcuts([
  { id: "dashboardPlaylistPrev", handler: whenFree(() => player.prev()) },
  { id: "dashboardPlaylistNext", handler: whenFree(() => player.next()) },
  { id: "dashboardPlaylistPause", handler: whenFree(() => player.togglePause()) },
  { id: "dashboardPlaylistExit", handler: whenFree(() => emit("exit")) },
]);

onMounted(() => {
  window.addEventListener("message", onWindowMessage);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  if (intervalNoticeVisible.value) {
    intervalNoticeTimer = setTimeout(
      () => (intervalNoticeVisible.value = false),
      INTERVAL_NOTICE_MS,
    );
  }
  player.start();
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onWindowMessage);
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  if (intervalNoticeTimer) clearTimeout(intervalNoticeTimer);
  player.stop();
  frameEls.clear();
});

defineExpose({ player });
</script>
