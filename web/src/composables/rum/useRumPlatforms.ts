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

/**
 * Detect which RUM platforms (browser vs mobile) actually have data in a time range.
 *
 * RUM events from every SDK land in the single `_rumdata` stream, discriminated by the
 * `source` field. The Performance UI was built entirely from browser telemetry, so a
 * user who only ingests mobile data would otherwise hit browser-only columns that don't
 * exist and see raw SQL errors. This composable is the single detection layer the RUM
 * surfaces consult to adapt to the browser-only / mobile-only / mixed personas.
 *
 * Primary signal: a lightweight `GROUP BY source` probe over the selected range — so the
 * answer reflects what is actually present in the current window, not what the stream
 * ever carried. Fallback: `_rumdata` schema-field presence, which never leaves the UI
 * stuck if the probe fails.
 *
 * See docs/designs/MOBILE_RUM_ADAPTIVE_UI_DESIGN.md.
 */

import { reactive, toRefs } from "vue";
import { useStore } from "vuex";
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
import { isMobileReplaySource } from "@/composables/rum/useMobileSessionReplay";
import { b64EncodeUnicode } from "@/utils/zincutils";

const RUM_STREAM = "_rumdata";

/**
 * Browser omits `source` on some events (or sends "browser"); a null/empty group is
 * therefore browser traffic.
 */
const BROWSER_SOURCE = "browser";

/**
 * Columns only the browser SDK emits — used by the schema fallback to infer `hasBrowser`.
 * Kept deliberately small: any one present means browser data has been ingested.
 */
const BROWSER_ONLY_FIELDS = [
  "view_largest_contentful_paint",
  "view_cumulative_layout_shift",
  "view_interaction_to_next_paint",
  "view_first_contentful_paint",
  "view_first_byte",
  "view_loading_time",
];

/** Columns only the mobile SDKs emit — used by the schema fallback to infer `hasMobile`. */
const MOBILE_ONLY_FIELDS = [
  "view_slow_frames_rate",
  "view_freeze_rate",
  "view_frozen_frame_count",
  "view_refresh_rate_average",
  "error_is_crash",
];

export interface RumDateTime {
  startTime: number;
  endTime: number;
}

export interface RumPlatformResult {
  /** Raw `source` values seen in range (null/empty normalised to "browser"). */
  platforms: string[];
  hasBrowser: boolean;
  hasMobile: boolean;
  /** Distinct mobile source values, e.g. ["ios", "android"]. */
  mobilePlatforms: string[];
  /** True when the source probe failed and the schema fallback was used. */
  viaFallback: boolean;
}

interface RumPlatformState extends RumPlatformResult {
  loading: boolean;
  error: unknown | null;
  /** The range key the current state reflects, or null before first resolution. */
  resolvedKey: string | null;
}

/**
 * Default when we cannot determine anything (both probe and schema failed): assume
 * browser so the existing browser experience is never hidden on a transient error.
 */
const DEFAULT_RESULT: RumPlatformResult = {
  platforms: [BROWSER_SOURCE],
  hasBrowser: true,
  hasMobile: false,
  mobilePlatforms: [],
  viaFallback: true,
};

// Module-level singletons: detection is shared across every RUM tab on the page, and a
// range is probed at most once.
const state = reactive<RumPlatformState>({
  loading: false,
  error: null,
  platforms: [],
  hasBrowser: false,
  hasMobile: false,
  mobilePlatforms: [],
  viaFallback: false,
  resolvedKey: null,
});

const resultCache = new Map<string, RumPlatformResult>();
const inflight = new Map<string, Promise<RumPlatformResult>>();
// Monotonic guard so a superseded detect() never overwrites the latest range's state.
let requestSeq = 0;

const rangeKey = (dateTime: RumDateTime): string => `${dateTime.startTime}_${dateTime.endTime}`;

const normaliseSource = (source: unknown): string => {
  const s = (source ?? "").toString().trim().toLowerCase();
  return s.length ? s : BROWSER_SOURCE;
};

const resultFromSources = (sources: string[], viaFallback: boolean): RumPlatformResult => {
  const platforms = Array.from(new Set(sources));
  const mobilePlatforms = platforms.filter((s) => isMobileReplaySource(s));
  return {
    platforms,
    hasBrowser: platforms.includes(BROWSER_SOURCE),
    hasMobile: mobilePlatforms.length > 0,
    mobilePlatforms,
    viaFallback,
  };
};

const useRumPlatforms = () => {
  const store = useStore();
  const { getStream } = useStreams();

  const buildProbeRequest = (dateTime: RumDateTime) => {
    const sql = `SELECT source, count(*) as cnt FROM "${RUM_STREAM}" GROUP BY source`;
    const req: any = {
      query: {
        sql,
        start_time: dateTime.startTime,
        end_time: dateTime.endTime,
        from: 0,
        size: 100,
      },
    };
    if (store.state.zoConfig?.sql_base64_enabled) {
      req.encoding = "base64";
      req.query.sql = b64EncodeUnicode(sql);
    }
    return req;
  };

  // Primary signal: what sources have rows in this range.
  const probeBySource = async (dateTime: RumDateTime): Promise<RumPlatformResult> => {
    const res = await searchService.search(
      {
        org_identifier: store.state.selectedOrganization.identifier,
        query: buildProbeRequest(dateTime),
        page_type: "logs",
      },
      "RUM",
    );
    const hits: any[] = res?.data?.hits ?? [];
    return resultFromSources(
      hits.map((hit) => normaliseSource(hit?.source)),
      false,
    );
  };

  // Fallback: infer from which columns exist in the stream schema.
  const probeBySchema = async (): Promise<RumPlatformResult> => {
    const stream = await getStream(RUM_STREAM, "logs", true);
    const names = new Set((stream?.schema ?? []).map((field: any) => field?.name));
    const hasBrowser = BROWSER_ONLY_FIELDS.some((f) => names.has(f));
    const hasMobile = MOBILE_ONLY_FIELDS.some((f) => names.has(f));
    const platforms: string[] = [];
    if (hasBrowser) platforms.push(BROWSER_SOURCE);
    // Schema can't tell which mobile platform, only that mobile data exists.
    return {
      platforms,
      hasBrowser,
      hasMobile,
      mobilePlatforms: [],
      viaFallback: true,
    };
  };

  const applyResult = (result: RumPlatformResult, key: string) => {
    state.platforms = result.platforms;
    state.hasBrowser = result.hasBrowser;
    state.hasMobile = result.hasMobile;
    state.mobilePlatforms = result.mobilePlatforms;
    state.viaFallback = result.viaFallback;
    state.resolvedKey = key;
    state.loading = false;
  };

  const runDetection = async (dateTime: RumDateTime): Promise<RumPlatformResult> => {
    try {
      return await probeBySource(dateTime);
    } catch (probeError) {
      state.error = probeError;
      try {
        return await probeBySchema();
      } catch {
        return DEFAULT_RESULT;
      }
    }
  };

  /**
   * Resolve which platforms have data in `dateTime`. Cached per range; concurrent callers
   * for the same range share one probe. Only the most recent call updates shared state, so
   * a fast time-range switch never lands stale results.
   */
  const detectPlatforms = async (dateTime: RumDateTime): Promise<RumPlatformResult> => {
    if (!dateTime || !dateTime.startTime || !dateTime.endTime) {
      return DEFAULT_RESULT;
    }

    const key = rangeKey(dateTime);
    const seq = ++requestSeq;

    const cached = resultCache.get(key);
    if (cached) {
      if (seq === requestSeq) applyResult(cached, key);
      return cached;
    }

    state.loading = true;
    state.error = null;

    let promise = inflight.get(key);
    if (!promise) {
      promise = runDetection(dateTime).then((result) => {
        resultCache.set(key, result);
        inflight.delete(key);
        return result;
      });
      inflight.set(key, promise);
    }

    const result = await promise;
    // Only the latest detect() call writes state; a superseded range is discarded.
    if (seq === requestSeq) applyResult(result, key);
    return result;
  };

  /** Drop caches — for logout / org switch / tests. */
  const resetRumPlatforms = () => {
    resultCache.clear();
    inflight.clear();
    requestSeq = 0;
    state.loading = false;
    state.error = null;
    state.platforms = [];
    state.hasBrowser = false;
    state.hasMobile = false;
    state.mobilePlatforms = [];
    state.viaFallback = false;
    state.resolvedKey = null;
  };

  return {
    ...toRefs(state),
    detectPlatforms,
    resetRumPlatforms,
  };
};

export default useRumPlatforms;
