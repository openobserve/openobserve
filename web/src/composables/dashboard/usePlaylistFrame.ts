// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import type { KioskHealth } from "@/composables/dashboard/useKioskRefresh";
import { LOAD_RETRY_MS } from "@/composables/dashboard/usePlaylistPlayer";
import {
  PLAYLIST_MESSAGE_SOURCE,
  buildSlideQuery,
  type PlaylistConfig,
  type PlaylistFrameMessage,
  type SlideHealthReport,
} from "@/utils/dashboard/playlist";

export type MissingReason = "notFound" | "forbidden";

interface SlideSignals {
  title: Ref<string | undefined>;
  health: ComputedRef<KioskHealth>;
  failingCount: ComputedRef<number>;
  lastSuccessAt: Ref<number | null>;
}

type FrameMessageBody = PlaylistFrameMessage extends infer M
  ? M extends PlaylistFrameMessage
    ? Omit<M, "source">
    : never
  : never;

export const toSlideHealth = (
  health: KioskHealth,
  failing: number,
  lastSuccessAt: number | null,
): SlideHealthReport => {
  if (health.level === "bad") {
    return { level: "bad", failing, outage: true, lastSuccessAt };
  }
  if (health.level === "warn") return { level: "warn", failing, outage: false, lastSuccessAt };
  return { level: "ok", failing: 0, outage: false, lastSuccessAt };
};

/** True once the slide has something worth showing: a finished first refresh, or a known outage. */
const isSlideReady = (signals: SlideSignals) =>
  signals.lastSuccessAt.value !== null || signals.health.value.level === "bad";

/** Inside a player frame: reports boot, readiness, health and a missing dashboard to the parent page. */
export const usePlaylistFrame = (enabled: boolean, signals: SlideSignals) => {
  const post = (body: FrameMessageBody) => {
    if (!enabled || typeof window === "undefined" || window.parent === window) return;
    // Same-origin only: the player is served from this app.
    window.parent.postMessage({ source: PLAYLIST_MESSAGE_SOURCE, ...body }, window.location.origin);
  };

  let readySent = false;
  let lastHealth = "";

  const report = () => {
    if (!enabled || !isSlideReady(signals)) return;
    if (!readySent) {
      readySent = true;
      post({ type: "ready", title: signals.title.value ?? "" });
    }
    const health = toSlideHealth(
      signals.health.value,
      signals.failingCount.value,
      signals.lastSuccessAt.value,
    );
    const serialized = JSON.stringify(health);
    if (serialized === lastHealth) return;
    lastHealth = serialized;
    post({ type: "health", health });
  };

  if (enabled) {
    post({ type: "hello" });
    watch([signals.lastSuccessAt, signals.health, signals.failingCount, signals.title], report);
  }

  return {
    reportMissing: (reason: MissingReason) => post({ type: "missing", reason }),
    reportError: () => post({ type: "error" }),
  };
};

export interface UsePlaylistPageOptions {
  enabled: boolean;
  config: PlaylistConfig | null;
  misses: number;
  ready: ComputedRef<boolean>;
  outage: ComputedRef<boolean>;
  /** Builds an absolute href for the given dashboard-view query. */
  resolveHref: (query: Record<string, string>) => string;
  navigate?: (href: string) => void;
}

const SKIP_DELAY_MS = 3000;
const ALL_MISSING_MIN_MS = 15000;

/** Fallback when framing is blocked: this page shows one slide and replaces itself with the next. */
export const usePlaylistPage = (options: UsePlaylistPageOptions) => {
  const navigate = options.navigate ?? ((href: string) => window.location.replace(href));
  const config = options.config;
  const active = options.enabled && !!config;
  const count = config?.entries.length ?? 0;
  const index = config?.slideIndex ?? 0;

  const missing = ref<MissingReason | null>(null);
  const leaving = ref(false);
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  let dwellDue = false;

  const go = (target: number, misses = 0) => {
    if (!config) return;
    leaving.value = true;
    navigate(options.resolveHref(buildSlideQuery(config, target, "page", misses)));
  };

  const advance = () => {
    if (options.outage.value) return;
    go((index + 1) % count);
  };

  const stop = () => {
    if (dwellTimer) clearTimeout(dwellTimer);
    if (leaveTimer) clearTimeout(leaveTimer);
    dwellTimer = null;
    leaveTimer = null;
  };

  if (active && config) {
    watch(
      options.ready,
      (ready) => {
        if (!ready || dwellTimer || dwellDue) return;
        dwellTimer = setTimeout(() => {
          dwellTimer = null;
          dwellDue = true;
          advance();
        }, config.intervalSeconds * 1000);
      },
      { immediate: true },
    );
    watch(options.outage, (outage) => {
      if (!outage && dwellDue) advance();
    });
  }

  const reportMissing = (reason: MissingReason) => {
    if (!active) return false;
    missing.value = reason;
    const misses = options.misses + 1;
    // Every slide missing in a row: wait one full interval before trying the loop again.
    const delay =
      misses >= count
        ? Math.max(ALL_MISSING_MIN_MS, (config?.intervalSeconds ?? 0) * 1000)
        : SKIP_DELAY_MS;
    leaveTimer = setTimeout(() => go((index + 1) % count, misses >= count ? 0 : misses), delay);
    return true;
  };

  const reportError = () => {
    if (!active) return false;
    leaveTimer = setTimeout(() => go(index, options.misses), LOAD_RETRY_MS);
    return true;
  };

  if (getCurrentInstance()) onBeforeUnmount(stop);

  const position = computed(() => ({ index, count }));

  return { active, missing, leaving, position, reportMissing, reportError, stop };
};
