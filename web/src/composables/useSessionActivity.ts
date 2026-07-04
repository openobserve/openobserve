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

import { useStore } from "vuex";
import searchService from "@/services/search";

export interface ActivityBucket {
  index: number;
  events: number;
  errors: number;
  frustrations: number;
}

export interface SessionActivity {
  /** Zero-filled, ACTIVITY_BUCKET_COUNT long, ordered by session time. */
  buckets: ActivityBucket[];
  maxEvents: number;
  totalEvents: number;
  totalErrors: number;
  totalFrustrations: number;
}

export const ACTIVITY_BUCKET_COUNT = 24;

// A session's activity within its own start/end never changes, so cache it
// module-wide — re-scrolling a virtualized table must not refetch.
const cache = new Map<string, SessionActivity>();
const inFlight = new Map<string, Promise<SessionActivity | null>>();

// Activity queries are the lowest-priority calls on the page — the sessions
// page holds this gate while its own queries (page, replay, KPI aggregates,
// insight clusters) are in flight, so activity fetches only start after
// everything else has settled. Cached results bypass the gate.
let gate: Promise<void> = Promise.resolve();
let releaseGateFn: (() => void) | null = null;

export const holdActivityQueries = () => {
  if (releaseGateFn) return;
  gate = new Promise((resolve) => {
    releaseGateFn = resolve;
  });
};

export const releaseActivityQueries = () => {
  releaseGateFn?.();
  releaseGateFn = null;
};

// Virtual scroll mounts ~15 rows at once; cap concurrent activity queries so
// a fast scroll doesn't burst dozens of requests at the search API.
const MAX_CONCURRENT_QUERIES = 4;
let activeQueries = 0;
const queryWaiters: Array<() => void> = [];

const acquireSlot = () =>
  new Promise<void>((resolve) => {
    if (activeQueries < MAX_CONCURRENT_QUERIES) {
      activeQueries++;
      resolve();
    } else {
      queryWaiters.push(() => {
        activeQueries++;
        resolve();
      });
    }
  });

const releaseSlot = () => {
  activeQueries--;
  queryWaiters.shift()?.();
};

const useSessionActivity = () => {
  const store = useStore();

  /**
   * Event distribution over a session's own timeline, bucketed into
   * ACTIVITY_BUCKET_COUNT slots. startTime/endTime are epoch milliseconds
   * (the replay start/end already loaded on each row). Returns null when the
   * session can't be bucketed (missing bounds, bad id) or the query fails —
   * failures are not cached, so a later mount retries.
   */
  const fetchActivity = (
    sessionId: string,
    startTime: number,
    endTime: number,
    hasFrustrationField: boolean,
  ): Promise<SessionActivity | null> => {
    const durationMs = endTime - startTime;
    if (
      !sessionId ||
      !/^[a-zA-Z0-9_-]+$/.test(sessionId) ||
      !startTime ||
      durationMs <= 0
    ) {
      return Promise.resolve(null);
    }

    const key = `${sessionId}:${startTime}`;
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = inFlight.get(key);
    if (pending) return pending;

    const promise = (async () => {
      await gate;
      await acquireSlot();
      try {
        const tsColumn =
          store.state.zoConfig.timestamp_column || "_timestamp";
        const startUs = startTime * 1000;
        const bucketUs = Math.max(
          1,
          Math.ceil((durationMs * 1000) / ACTIVITY_BUCKET_COUNT),
        );
        const frustrationExpr = hasFrustrationField
          ? "SUM(CASE WHEN type='action' AND action_frustration_type IS NOT NULL THEN 1 ELSE 0 END)"
          : "0";

        // Bucket index is computed relative to the session start, so every
        // session gets the same resolution regardless of its duration.
        const sql = `
          SELECT
            FLOOR((${tsColumn} - ${startUs}) / ${bucketUs}) AS bucket_idx,
            COUNT(*) AS events,
            SUM(CASE WHEN type='error' THEN 1 ELSE 0 END) AS errors,
            ${frustrationExpr} AS frustrations
          FROM "_rumdata"
          WHERE session_id = '${sessionId}'
          GROUP BY bucket_idx
          ORDER BY bucket_idx`;

        // Pad the range: events can land slightly outside the replay bounds.
        const PAD_US = 5_000_000;
        const req = {
          query: {
            sql,
            start_time: startUs - PAD_US,
            end_time: endTime * 1000 + PAD_US,
            from: 0,
            size: ACTIVITY_BUCKET_COUNT + 8,
          },
        };

        const res = await searchService.search(
          {
            org_identifier: store.state.selectedOrganization.identifier,
            query: req,
            page_type: "logs",
          },
          "RUM",
        );

        const buckets: ActivityBucket[] = Array.from(
          { length: ACTIVITY_BUCKET_COUNT },
          (_, index) => ({ index, events: 0, errors: 0, frustrations: 0 }),
        );

        (res.data?.hits || []).forEach((hit: any) => {
          // Out-of-range events (from the padding) merge into the edge buckets.
          const index = Math.min(
            ACTIVITY_BUCKET_COUNT - 1,
            Math.max(0, Number(hit.bucket_idx) || 0),
          );
          buckets[index].events += hit.events || 0;
          buckets[index].errors += hit.errors || 0;
          buckets[index].frustrations += hit.frustrations || 0;
        });

        const activity: SessionActivity = {
          buckets,
          maxEvents: Math.max(...buckets.map((b) => b.events)),
          totalEvents: buckets.reduce((sum, b) => sum + b.events, 0),
          totalErrors: buckets.reduce((sum, b) => sum + b.errors, 0),
          totalFrustrations: buckets.reduce(
            (sum, b) => sum + b.frustrations,
            0,
          ),
        };

        cache.set(key, activity);
        return activity;
      } catch {
        return null;
      } finally {
        releaseSlot();
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, promise);
    return promise;
  };

  return { fetchActivity };
};

export default useSessionActivity;
