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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStreamDetect } from "./useStreamDetect";

const nameList = vi.fn();
const search = vi.fn();

vi.mock("@/services/stream", () => ({ default: { nameList: (...a: any[]) => nameList(...a) } }));
vi.mock("@/services/search", () => ({ default: { search: (...a: any[]) => search(...a) } }));

// The six sqlserver_* metric streams a real collector run produces.
const SQLSERVER_STREAMS = [
  "sqlserver_batch_request_rate",
  "sqlserver_batch_sql_compilation_rate",
  "sqlserver_lock_wait_rate",
  "sqlserver_page_buffer_cache_hit_ratio",
  "sqlserver_user_connection_count",
].map((name) => ({ name }));

describe("useStreamDetect", () => {
  beforeEach(() => {
    nameList.mockReset();
    search.mockReset();
  });

  it("keyword mode connects when any matching stream exists (no exact name, no COUNT)", async () => {
    // The metrics case: streams are sqlserver_*, the keyword is "sqlserver".
    nameList.mockResolvedValue({ data: { list: SQLSERVER_STREAMS } });

    const d = useStreamDetect({
      config: () => ({
        orgId: "default",
        streamType: "metrics",
        streamName: "sqlserver",
        match: "keyword",
        filter: "",
      }),
    });

    await d.check();

    expect(d.connected.value).toBe(true);
    expect(d.count.value).toBe(SQLSERVER_STREAMS.length);
    // Existence is proof — keyword mode must NOT hit _search.
    expect(search).not.toHaveBeenCalled();
  });

  it("exact mode (the regression) does NOT connect on a substring-only match", async () => {
    // Same streams, but without match:"keyword" the detector needs a stream named
    // exactly "sqlserver" — which doesn't exist — so it must report stalled.
    nameList.mockResolvedValue({ data: { list: SQLSERVER_STREAMS } });

    const d = useStreamDetect({
      config: () => ({
        orgId: "default",
        streamType: "metrics",
        streamName: "sqlserver",
        filter: "",
      }),
    });

    await d.check();

    expect(d.connected.value).toBe(false);
    expect(d.stalled.value).toBe(true);
  });
});
