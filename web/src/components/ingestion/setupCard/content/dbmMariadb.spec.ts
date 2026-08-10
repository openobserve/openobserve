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

import { describe, it, expect } from "vitest";
import { MARIADB_DBM_CONFIG_YAML } from "./dbmShared";

// MariaDB has no setup card of its own yet, so these assert the generated
// collector config directly. Every expectation below was verified by running
// this exact config through collector-contrib 0.135.0 against the rig's live
// MariaDB — see tests/dbm-server-vantage/captures/README.md.
describe("MariaDB Database Monitoring config", () => {
  const config = MARIADB_DBM_CONFIG_YAML;

  it("uses MariaDB-specific receivers, never MySQL's", () => {
    expect(config).toContain("sqlquery/mariadb_locks");
    expect(config).toContain("filelog/mariadb_deadlocks");
    // Sharing MySQL's receivers is the trap: detect_engine maps the
    // `mysql_lock_waits` tag and every `my_*` key straight to "mysql", so
    // MariaDB rows would be filed under the wrong server — and because the
    // deadlock stitch groups on (engine, instance, database) with "" defaults,
    // two different servers' sides could merge into one fabricated deadlock.
    expect(config).not.toContain("sqlquery/mysql_locks");
    expect(config).not.toContain("filelog/mysql_deadlocks");
    expect(config).not.toContain("'mysql_lock_waits'");
    expect(config).toContain("'mariadb_lock_waits'");
  });

  it("matches MariaDB's log envelope, not MySQL's", () => {
    // Space separator, no `T`, no fractional seconds, no [MY-nnnnnn] code —
    // MariaDB 11.8 writes `2026-08-10  8:56:56 14 [Note] InnoDB: …`.
    expect(config).toContain("maria_message");
    expect(config).toContain('layout: "%Y-%m-%d %H:%M:%S"');
    // The vendor literal that makes the MySQL regex return zero matches here.
    expect(config).toContain("MariaDB thread id");
    expect(config).not.toContain("MySQL thread id");
  });

  it("routes the per-side TRANSACTION blocks, not just the banner and verdict", () => {
    // THE REGRESSION THIS FILE EXISTS FOR. MariaDB writes each side as
    // CONTINUATION lines under an entry whose own text is a bare "InnoDB:" —
    // that entry contains neither "Transactions deadlock detected" nor
    // "WE ROLL BACK TRANSACTION". Routing on only those two phrases captured
    // the verdict and silently DROPPED BOTH SIDES, producing deadlocks with no
    // participants. Caught by running the real config against the real server.
    expect(config).toMatch(/matches "\\+\*\\+\*\\+\* \\+\(\\+d\+\\+\) TRANSACTION:"/);
    expect(config).toContain("Transactions deadlock detected");
    expect(config).toContain("WE ROLL BACK TRANSACTION");
  });

  it("keeps MariaDB events through the filter", () => {
    // o2_maria_event is a distinct key from o2_my_event by design, so the
    // filter must name it explicitly or every MariaDB deadlock is dropped
    // while the pipeline still reports healthy.
    expect(config).toContain('attributes["o2_maria_event"]');
    expect(config).toContain("stream-name: dbm_server");
    expect(config).toContain("processors: [filter/dbm, batch]");
  });

  it("captures the fields canonicalize_mariadb_deadlock reads", () => {
    for (const field of [
      "maria_trx_side",
      "maria_trx_id",
      "maria_trx_thread",
      "maria_trx_query",
      "maria_victim_side",
      "maria_lock_mode",
      "maria_lock_table",
    ]) {
      expect(config).toContain(field);
    }
  });
});
