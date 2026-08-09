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
 * The deadlocks/blocking wire contract.
 *
 * These two endpoints previously returned raw storage rows and the UI undid the
 * storage encoding client-side. The reconciliation now lives in `api.rs`, so
 * this file's job is to pin BOTH halves of that agreement:
 *
 *   • the request params the UI sends reach the backend under names it accepts;
 *   • the response payloads the UI declares are what `api.rs` emits.
 *
 * The response fixtures below are the exact JSON the Rust tests
 * `test_deadlock_dto_shape` and `test_blocking_dto_shape` assert on. When one
 * side changes, one of the two suites goes red — which is the point.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import dbMonitoringService from "./db_monitoring";
import type { BlockingSample, DeadlockEvent, DeadlocksResponse } from "./db_monitoring";

vi.mock("./http", () => ({
  default: vi.fn(() => ({ get: vi.fn() })),
}));

import http from "./http";

type MockHttp = { get: ReturnType<typeof vi.fn> };

describe("dbMonitoringService — deadlocks & blocking", () => {
  let mockHttp: MockHttp;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp = { get: vi.fn().mockResolvedValue({ data: {} }) };
    (http as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockHttp);
  });

  const paramsOf = () => mockHttp.get.mock.calls[0][1].params as Record<string, unknown>;

  describe("request params reach the backend under accepted names", () => {
    it("sends every deadlocks filter the handler reads", async () => {
      await dbMonitoringService.getDeadlocks("org1", {
        startTime: 100,
        endTime: 200,
        stream: "dbm_server",
        system: "postgresql",
        instance: "pg1",
        namespace: "dbmlab",
        search: "accounts",
        limit: 50,
      });

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/org1/traces/db_monitoring/deadlocks",
        expect.anything(),
      );
      expect(paramsOf()).toEqual({
        start_time: 100,
        end_time: 200,
        stream: "dbm_server",
        system: "postgresql",
        instance: "pg1",
        // `DeadlocksQuery` accepts this as an alias of `database` — the rollup
        // endpoints spell the same concept `namespace`, and the UI sends one
        // vocabulary to every DBM endpoint.
        namespace: "dbmlab",
        // `search` was silently ignored before the handler grew the field, so
        // the search box did nothing. Pinned here to keep it wired.
        search: "accounts",
        limit: 50,
      });
    });

    it("sends every blocking filter the handler reads", async () => {
      await dbMonitoringService.getBlocking("org1", {
        startTime: 100,
        endTime: 200,
        system: "mysql",
        namespace: "dbmlab",
        search: "inventory",
        limit: 10,
      });

      expect(mockHttp.get).toHaveBeenCalledWith(
        "/api/org1/traces/db_monitoring/blocking",
        expect.anything(),
      );
      expect(paramsOf()).toMatchObject({
        system: "mysql",
        namespace: "dbmlab",
        search: "inventory",
      });
    });

    it("never forwards the UI's `all` sentinel or empty values", async () => {
      await dbMonitoringService.getDeadlocks("org1", {
        system: "all",
        instance: "",
        search: undefined,
      });
      expect(paramsOf()).toEqual({});
    });
  });

  describe("response shape matches what api.rs emits", () => {
    /**
     * Byte-for-byte the object asserted by the Rust `test_deadlock_dto_shape`.
     * Note what is NOT here: no `o2_dbm_*` key, and `participants` is an ARRAY
     * rather than the JSON string the logs schema inferrer forces on storage.
     */
    const deadlockDto = {
      id: "300-22",
      timestamp: 300,
      db_system: "postgresql",
      db_instance: "pg1",
      db_namespace: "dbmlab",
      victim_pid: 22,
      participant_count: 2,
      partial: false,
      query_shape: "aaa+bbb",
      objects: ["accounts", "inventory"],
      raw: null,
      participants: [
        {
          pid: 11,
          transaction_id: "1430",
          query: "UPDATE a SET x = 1",
          query_norm: null,
          fingerprint: "aaa",
          application: "checkout",
          user: "svc",
          lock_mode: "ShareLock",
          lock_target: "accounts",
          victim: false,
        },
        {
          pid: 22,
          transaction_id: null,
          query: "UPDATE b SET y = 2",
          query_norm: null,
          fingerprint: "bbb",
          application: null,
          user: null,
          lock_mode: null,
          lock_target: "inventory",
          victim: true,
        },
      ],
    };

    it("types a deadlock event with no decoding step", async () => {
      const payload: DeadlocksResponse = {
        hits: [deadlockDto],
        query_shapes: [
          { query_shape: "aaa+bbb", count: 2, last_seen: 300, fingerprints: ["aaa", "bbb"] },
        ],
        total: 1,
        truncated: false,
        stream: "dbm_server",
      };
      mockHttp.get.mockResolvedValue({ data: payload });

      const { data } = await dbMonitoringService.getDeadlocks("org1");
      const event: DeadlockEvent = data.hits[0];

      // The array is usable directly — no JSON.parse anywhere on this path.
      expect(Array.isArray(event.participants)).toBe(true);
      expect(event.participants).toHaveLength(2);
      expect(event.participants[0].application).toBe("checkout");
      expect(event.query_shape).toBe("aaa+bbb");
      expect(event.partial).toBe(false);
    });

    it("carries no storage-layer column names", async () => {
      mockHttp.get.mockResolvedValue({
        data: { hits: [deadlockDto], total: 1 },
      });
      const { data } = await dbMonitoringService.getDeadlocks("org1");

      const leaked = Object.keys(data.hits[0]).filter((k) => k.startsWith("o2_dbm_"));
      expect(leaked).toEqual([]);
    });

    it("flags a single-sided event rather than hiding it", async () => {
      // MySQL logs one entry per transaction side. When the partner entry never
      // arrives, the server still returns the deadlock — marked `partial`.
      mockHttp.get.mockResolvedValue({
        data: {
          hits: [
            {
              ...deadlockDto,
              participants: [deadlockDto.participants[0]],
              participant_count: 1,
              partial: true,
            },
          ],
          total: 1,
        },
      });
      const { data } = await dbMonitoringService.getDeadlocks("org1");
      expect(data.hits[0].partial).toBe(true);
      expect(data.hits[0].participant_count).toBe(1);
    });

    /** Byte-for-byte the object asserted by Rust `test_blocking_dto_shape`. */
    it("types a blocking sample in the shared db_* vocabulary", async () => {
      const sample = {
        timestamp: 500,
        blocked_pid: 101,
        blocking_pid: 202,
        blocked_query: "SELECT 1",
        blocking_query: "UPDATE t SET x = 1",
        blocked_fingerprint: "aaa",
        blocking_fingerprint: "bbb",
        blocked_application: "cart",
        blocking_application: "batch",
        wait_event_type: "Lock",
        wait_event: "transactionid",
        wait_seconds: 12.5,
        db_system: "postgresql",
        db_instance: "pg1",
        db_namespace: "dbmlab",
      };
      mockHttp.get.mockResolvedValue({ data: { hits: [sample], total: 1 } });

      const { data } = await dbMonitoringService.getBlocking("org1");
      const row: BlockingSample = data.hits[0];

      expect(row.blocked_pid).toBe(101);
      expect(row.blocking_application).toBe("batch");
      // `db_system`/`db_instance`/`db_namespace` are the same three names the
      // rollup endpoints use, so one formatter serves the whole feature.
      expect(row.db_system).toBe("postgresql");
      expect(row.db_namespace).toBe("dbmlab");
      expect(Object.keys(row).filter((k) => k.startsWith("o2_dbm_"))).toEqual([]);
    });
  });
});
