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

import { describe, expect, it, vi } from "vitest";

import { traceCountFromStreamList, useDbmTracePresence } from "./useDbmTracePresence";

/**
 * The contract under test: `0` only when the stream catalog PROVES the org has
 * no trace data, `null` whenever it cannot. The asymmetry is the point —
 * DbmEmptyState renders `0` as a red "No traces have arrived … this
 * organization hasn't sent any yet", so a `0` produced from a guess sends an
 * instrumented org to re-instrument itself, where a `null` merely leaves the
 * row off the checklist.
 */
describe("traceCountFromStreamList", () => {
  it("proves zero when the org has no trace streams", () => {
    // A trace stream exists exactly because a trace arrived, so an empty
    // catalog is the never-instrumented org.
    expect(traceCountFromStreamList({ list: [] })).toBe(0);
  });

  it("proves zero when every stream reports zero documents", () => {
    expect(
      traceCountFromStreamList({
        list: [
          { name: "default", stats: { doc_num: 0 } },
          { name: "staging", stats: { doc_num: 0 } },
        ],
      }),
    ).toBe(0);
  });

  it("stays unknown when any stream carries documents", () => {
    // Traces exist, but nobody counted THIS RANGE — the check must stay
    // absent, not claim a pass with a number that describes all time.
    expect(
      traceCountFromStreamList({
        list: [
          { name: "default", stats: { doc_num: 0 } },
          { name: "prod", stats: { doc_num: 12 } },
        ],
      }),
    ).toBe(null);
  });

  it("stays unknown when a stream's stats are missing", () => {
    // One unreadable stats block makes "zero ever" an assumption, not an
    // observation.
    expect(traceCountFromStreamList({ list: [{ name: "default" }] })).toBe(null);
  });

  it("stays unknown on a malformed payload", () => {
    // `getStreams` can resolve `{}` off an odd cache state; a missing list is
    // not an empty one.
    expect(traceCountFromStreamList({})).toBe(null);
    expect(traceCountFromStreamList(undefined)).toBe(null);
    expect(traceCountFromStreamList({ list: "nope" })).toBe(null);
  });
});

describe("useDbmTracePresence", () => {
  it("starts uncounted, so the checklist omits the row until the probe answers", () => {
    const { traceCount } = useDbmTracePresence(vi.fn());
    expect(traceCount.value).toBe(null);
  });

  it("asks for the trace catalog without schemas or a toast", async () => {
    const getStreams = vi.fn().mockResolvedValue({ list: [] });
    const { probeTracePresence } = useDbmTracePresence(getStreams);
    await probeTracePresence();
    expect(getStreams).toHaveBeenCalledWith("traces", false, false);
  });

  it("resolves zero for the never-instrumented org", async () => {
    const { traceCount, probeTracePresence } = useDbmTracePresence(
      vi.fn().mockResolvedValue({ list: [] }),
    );
    await probeTracePresence();
    expect(traceCount.value).toBe(0);
  });

  it("resolves unknown for an org with trace data", async () => {
    const { traceCount, probeTracePresence } = useDbmTracePresence(
      vi.fn().mockResolvedValue({ list: [{ name: "default", stats: { doc_num: 41 } }] }),
    );
    await probeTracePresence();
    expect(traceCount.value).toBe(null);
  });

  it("treats a failed catalog read as unknown, never as zero", async () => {
    const { traceCount, probeTracePresence } = useDbmTracePresence(
      vi.fn().mockRejectedValue(new Error("403")),
    );
    await probeTracePresence();
    expect(traceCount.value).toBe(null);
  });
});
