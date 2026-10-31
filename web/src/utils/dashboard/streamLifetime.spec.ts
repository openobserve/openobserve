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

import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnrichmentTableRange, isEnrichmentTablePanel } from "./streamLifetime";

const panel = (stream_type: string, stream = "geo") => ({
  queries: [{ fields: { stream, stream_type } }],
});

describe("isEnrichmentTablePanel", () => {
  it("reads the first query's stream type", () => {
    expect(isEnrichmentTablePanel(panel("enrichment_tables"))).toBe(true);
    expect(isEnrichmentTablePanel(panel("logs"))).toBe(false);
    expect(isEnrichmentTablePanel(null)).toBe(false);
  });
});

describe("getEnrichmentTableRange", () => {
  const now = Date.UTC(2026, 0, 2) * 1000;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("spans the table's rows and ends no earlier than now", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now / 1000);
    const getStream = vi.fn().mockResolvedValue({
      stats: { doc_time_min: 5_000_000, doc_time_max: 9_000_000 },
    });
    expect(await getEnrichmentTableRange(getStream, panel("enrichment_tables"))).toEqual({
      from: 4_000_000,
      to: now,
    });
    expect(getStream).toHaveBeenCalledWith("geo", "enrichment_tables", false);
  });

  it("ends a minute after rows stamped ahead of this clock", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now / 1000);
    const getStream = vi.fn().mockResolvedValue({
      stats: { doc_time_min: now, doc_time_max: now + 5_000_000 },
    });
    expect((await getEnrichmentTableRange(getStream, panel("enrichment_tables")))?.to).toBe(
      now + 65_000_000,
    );
  });

  it("falls back to the creation time before stats arrive", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now / 1000);
    const getStream = vi.fn().mockResolvedValue({ stats: { created_at: 100_000_000 } });
    expect(await getEnrichmentTableRange(getStream, panel("enrichment_tables"))).toEqual({
      from: 40_000_000,
      to: now,
    });
  });

  it("leaves other streams and unknown tables to the dashboard range", async () => {
    const getStream = vi.fn().mockResolvedValue(null);
    expect(await getEnrichmentTableRange(getStream, panel("logs"))).toBeNull();
    expect(getStream).not.toHaveBeenCalled();
    expect(await getEnrichmentTableRange(getStream, panel("enrichment_tables"))).toBeNull();
    getStream.mockRejectedValueOnce(new Error("offline"));
    expect(await getEnrichmentTableRange(getStream, panel("enrichment_tables"))).toBeNull();
  });
});
