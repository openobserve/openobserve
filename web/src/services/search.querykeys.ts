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

import { orgKey } from "@/composables/query/keys";

/**
 * Keys only, dependency-free apart from `orgKey`, so a write in another domain
 * can drop this scope without importing this domain's transport — and so two
 * domains invalidating each other cannot form an import cycle.
 *
 * `all` is the invalidation scope; the rest are entries beneath it.
 */
export const traceDagKeys = {
  all: (org: string) => orgKey(org, "traces", "dag"),
  detail: (org: string, streamName: string, traceId: string, startTime: number, endTime: number) =>
    orgKey(org, "traces", "dag", traceId, streamName, startTime, endTime),
};

/** Where a trace or a session ran and when, from the trace time index. */
export const traceTimeRangeKeys = {
  all: (org: string) => orgKey(org, "traces", "timeRange"),
  detail: (org: string, kind: "trace" | "session", id: string) =>
    orgKey(org, "traces", "timeRange", kind, id),
};

/** A session's turns, one entry per session; the window only helps the server find it. */
export const sessionTurnsKeys = {
  all: (org: string) => orgKey(org, "traces", "sessionTurns"),
  detail: (org: string, streamName: string, sessionId: string) =>
    orgKey(org, "traces", "sessionTurns", streamName, sessionId),
};

/** One entry per trace: the window only helps the server find it, so it is not part of the key. */
export const traceDetailsKeys = {
  all: (org: string) => orgKey(org, "traces", "details"),
  detail: (org: string, streamName: string, traceId: string) =>
    orgKey(org, "traces", "details", streamName, traceId),
};
