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

import { describe, expect, it } from "vitest";
import {
  USER_SOURCED_STREAM_NAMES,
  isUserDataStream,
  summaryHasUserData,
  userDataStreams,
} from "./internalStreams";

describe("internalStreams", () => {
  it("counts only logs, metrics, traces and profiles streams the server does not mark internal", () => {
    expect(isUserDataStream({ name: "default", stream_type: "logs" })).toBe(true);
    expect(isUserDataStream({ name: "up", stream_type: "metrics" })).toBe(true);
    expect(isUserDataStream({ name: "default", stream_type: "traces" })).toBe(true);
    expect(isUserDataStream({ name: "default", stream_type: "profiles" })).toBe(true);
    expect(isUserDataStream({ name: "default", stream_type: "metadata" })).toBe(false);
    expect(isUserDataStream({ name: "default", stream_type: "index" })).toBe(false);
    expect(isUserDataStream({ name: "default", stream_type: "enrichment_tables" })).toBe(false);
  });

  it("uses the fallback type only when the row has none", () => {
    expect(isUserDataStream({ name: "default" }, "logs")).toBe(true);
    expect(isUserDataStream({ name: "default" }, "metadata")).toBe(false);
    expect(isUserDataStream({ name: "default", stream_type: "metadata" }, "logs")).toBe(false);
    expect(isUserDataStream({ name: "default" })).toBe(false);
    expect(isUserDataStream(undefined, "logs")).toBe(true);
    expect(isUserDataStream(null)).toBe(false);
  });

  it("follows the server's org-aware is_internal for names O2 writes only in the meta org", () => {
    expect(isUserDataStream({ name: "errors", stream_type: "logs" })).toBe(true);
    expect(isUserDataStream({ name: "errors", stream_type: "logs", is_internal: true })).toBe(
      false,
    );
    expect(isUserDataStream({ name: "slo_slices", stream_type: "logs", is_internal: true })).toBe(
      false,
    );
    expect(
      isUserDataStream({
        name: "_o2_alert_calibration_digests",
        stream_type: "logs",
        is_internal: true,
      }),
    ).toBe(false);
  });

  it("counts internal-marked streams the customer's own clients write", () => {
    for (const name of USER_SOURCED_STREAM_NAMES) {
      expect(isUserDataStream({ name, stream_type: "logs", is_internal: true })).toBe(true);
    }
    expect(
      isUserDataStream({ name: "_o2_dbm_server", stream_type: "metadata", is_internal: true }),
    ).toBe(false);
  });

  it("filters a stream list down to user data rows", () => {
    const rows = [
      { name: "usage", stream_type: "logs", is_internal: true },
      { name: "default", stream_type: "logs" },
      { name: "_o2_db_stats", stream_type: "logs", is_internal: true },
      { name: "_rumdata", stream_type: "logs", is_internal: true },
      { name: "default", stream_type: "metadata" },
      { name: "cpu", stream_type: "metrics" },
    ];
    expect(userDataStreams(rows).map((r) => r.name)).toEqual(["default", "_rumdata", "cpu"]);
    expect(userDataStreams(undefined)).toEqual([]);
  });

  it("reads an org summary with only O2-written streams as no user data", () => {
    expect(summaryHasUserData({ streams: { num_streams: 1, num_user_streams: 0 } })).toBe(false);
    expect(summaryHasUserData({ streams: { num_streams: 0, num_user_streams: 0 } })).toBe(false);
    expect(summaryHasUserData({ streams: { num_streams: 3, num_user_streams: 1 } })).toBe(true);
  });

  it("falls back to num_streams for a summary without num_user_streams", () => {
    expect(summaryHasUserData({ streams: { num_streams: 2 } })).toBe(true);
    expect(summaryHasUserData({ streams: { num_streams: 0 } })).toBe(false);
    expect(summaryHasUserData({ streams: {} })).toBe(false);
    expect(summaryHasUserData(undefined)).toBe(false);
    expect(summaryHasUserData(null)).toBe(false);
  });
});
