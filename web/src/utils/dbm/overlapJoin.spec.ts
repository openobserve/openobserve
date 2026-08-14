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

import { indexServerRows, overlapJoinKey, serverCounterpart } from "./overlapJoin";

/** The live `default` org's shape: one statement, both vantages, MySQL. */
const MYSQL_SERVER = {
  fingerprint: "c7c87dc1b19851d4",
  db_system: "mysql",
  db_namespace: null,
  calls: 29226,
  exec_time_s: 1086.104880289,
  exec_time_kind: "wait" as const,
};

const PG_SERVER = {
  fingerprint: "763135d109d76343",
  db_system: "postgresql",
  db_namespace: "dbmlab",
  calls: 41,
  exec_time_s: 356.893284097,
  exec_time_kind: "execution" as const,
};

describe("overlapJoinKey", () => {
  it("keys on fingerprint AND engine, so one statement under two engines cannot fuse", () => {
    const asMysql = overlapJoinKey("abc", "mysql", "dbmlab");
    const asPostgres = overlapJoinKey("abc", "postgresql", "dbmlab");
    expect(asMysql).not.toBe(asPostgres);
  });

  /**
   * The asymmetry that makes a naive three-part key miss EVERY MySQL row: the
   * client vantage reports `db_namespace: "dbmlab"` while the server's
   * top_query records carry no database at all. Dropping `database` for
   * mysql/mariadb is what the backend already enforces (400 "database is
   * required" is raised only for the engines that have one).
   */
  it("drops the database for mysql/mariadb, so the two vantages meet", () => {
    expect(overlapJoinKey("abc", "mysql", "dbmlab")).toBe(overlapJoinKey("abc", "mysql", null));
    expect(overlapJoinKey("abc", "mariadb", "dbmlab")).toBe(overlapJoinKey("abc", "mariadb", ""));
  });

  it("KEEPS the database for postgres, where the counters are per-database", () => {
    expect(overlapJoinKey("abc", "postgresql", "shop")).not.toBe(
      overlapJoinKey("abc", "postgresql", "billing"),
    );
  });

  it("is case- and engine-insensitive in the same way the backend is", () => {
    expect(overlapJoinKey("abc", "MySQL", "dbmlab")).toBe(overlapJoinKey("abc", "mysql", null));
  });
});

describe("serverCounterpart", () => {
  const index = indexServerRows([MYSQL_SERVER, PG_SERVER]);

  it("finds the MySQL server row for a client row that carries a database", () => {
    const match = serverCounterpart(index, {
      fingerprint: "c7c87dc1b19851d4",
      db_system: "mysql",
      db_namespace: "dbmlab",
    });
    expect(match?.calls).toBe(29226);
    expect(match?.exec_time_kind).toBe("wait");
  });

  it("finds the Postgres row on the full three-part key", () => {
    const match = serverCounterpart(index, {
      fingerprint: "763135d109d76343",
      db_system: "postgresql",
      db_namespace: "dbmlab",
    });
    expect(match?.calls).toBe(41);
  });

  it("does NOT match a Postgres client row against a MySQL server row", () => {
    const match = serverCounterpart(index, {
      fingerprint: "c7c87dc1b19851d4",
      db_system: "postgresql",
      db_namespace: "dbmlab",
    });
    expect(match).toBeNull();
  });

  it("returns null for a statement the databases never reported", () => {
    expect(
      serverCounterpart(index, {
        fingerprint: "not-reported",
        db_system: "mysql",
        db_namespace: null,
      }),
    ).toBeNull();
  });

  it("returns null rather than guessing when the client row names no engine", () => {
    expect(
      serverCounterpart(index, {
        fingerprint: "c7c87dc1b19851d4",
        db_system: null,
        db_namespace: "dbmlab",
      }),
    ).toBeNull();
  });

  /**
   * A Postgres client row whose database is missing cannot be resolved: the
   * counters are PER-DATABASE there, so matching it to any one database's row
   * would quote one database's total for a statement that runs in several.
   */
  it("refuses a Postgres match when the client row has no database", () => {
    expect(
      serverCounterpart(index, {
        fingerprint: "763135d109d76343",
        db_system: "postgresql",
        db_namespace: null,
      }),
    ).toBeNull();
  });
});
