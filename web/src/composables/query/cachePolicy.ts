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
 * The only file in the app with cache durations in it.
 *
 * A query's freshness tier is decided by the module it belongs to, and every
 * declaration names its tier. The client falls back to the live tier for a
 * declaration that names none, so forgetting one errs on the fresh side.
 *
 * These are plain values for TanStack's own `staleTime` / `gcTime` options —
 * there is no wrapper vocabulary to learn.
 */

/** Live state: alerts, incidents, synthetics, SLOs, and job-progress reads. */
export const LIVE_STALE_TIME = 60_000;

/** Logs, streams, traces, service correlation, AI observability, online evals. */
export const MEDIUM_STALE_TIME = 5 * 60_000;

/** Dashboards, pipelines, functions, workflows, reports, IAM, settings. */
export const NORMAL_STALE_TIME = 60 * 60_000;

/** Immutable for the session: /config, and a trace once it is written. */
export const SESSION_STALE_TIME = Infinity;

/** Set once on the client: how long an unused result stays in memory. */
export const GC_TIME = 3 * 60 * 60_000;

/** Panel results only: large, and on disk anyway, so memory lets go of them sooner than `GC_TIME`. */
export const PANEL_GC_TIME = 30 * 60_000;
