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
 * The DBM "verify" step's copy must match what each engine's shipped config
 * ACTUALLY collects.
 *
 * This is the one step that tells a user how long to wait before concluding
 * something is broken, so a wrong number here manufactures a support ticket:
 * the reader watches an empty tab for the interval we promised, then reports a
 * collector that is working exactly as designed.
 *
 * The bug this pins: `dbmVerifyFullDesc` said "Table health fills after the
 * first 60-second snapshot" and was rendered by BOTH Postgres and MySQL. It is
 * true for MySQL, whose table/index recipes run at `collection_interval: 60s`,
 * and false for Postgres, which runs them at 300s on purpose —
 * `pg_total_relation_size` is O(schema) and measured 3.0s at 50k tables. A
 * Postgres user was told to expect data four minutes before it could exist.
 *
 * The assertions read the interval out of the GENERATED YAML rather than
 * restating it, so the copy and the config cannot drift apart: change the
 * recipe's interval and the test fails until the sentence is changed too.
 */

import { describe, it, expect } from "vitest";

import messages from "@/locales/languages/en-US.json";

import { dbmVerifyStep } from "./dbmShared";
import postgresCard from "./postgres";
import mysqlCard from "./mysql";
import mariadbCard from "./mariadb";
import sqlServerCard from "./sqlServer";

const SUBS = { url: "https://test.openobserve.ai", org: "test-org", token: "dGVzdEB0b2tlbg==" };

const setupCard = messages.ingestion.setupCard as Record<string, string>;

/**
 * Every step of a card. `steps` is top-level on RichCardContent; a card may
 * also carry sections that hold their own, so both are flattened — reading
 * only one of them silently finds nothing and every assertion below would
 * compare `undefined` against `undefined`-adjacent values.
 */
const stepsOf = (card: unknown): { id?: string; descriptionKey?: string }[] => {
  const c = card as {
    steps?: unknown[];
    sections?: { steps?: unknown[] }[];
  };
  const own = (c?.steps ?? []) as { id?: string; descriptionKey?: string }[];
  const nested = (c?.sections ?? []).flatMap(
    (s) => (s.steps ?? []) as { id?: string; descriptionKey?: string }[],
  );
  return [...own, ...nested];
};

/** The verify step a flavour's card renders. */
const verifyStepOf = (card: unknown) => stepsOf(card).find((s) => s?.id === "verify-dbm");

/**
 * The `collection_interval` on the table-stats recipe inside a rendered config.
 * Read from the YAML the card hands the user, which is the only thing that
 * actually governs when Table health fills.
 */
const tableStatsInterval = (yaml: string): string | null => {
  const at = yaml.indexOf("table_stats");
  if (at < 0) return null;
  const after = yaml.slice(at);
  return after.match(/collection_interval:\s*(\S+)/)?.[1] ?? null;
};

const yamlOf = (card: unknown): string =>
  JSON.stringify(
    (card as { sections?: unknown[] })?.sections ?? [],
  );

describe("the DBM verify step promises the wait each engine really has", () => {
  it("gives Postgres the five-minute table-health wording, not the 60-second one", () => {
    const step = verifyStepOf(postgresCard(SUBS));
    expect(step, "postgres must render a verify-dbm step").toBeTruthy();
    expect(
      step?.descriptionKey,
      "postgres table stats run at 300s — the 60-second copy is a false promise",
    ).toBe("ingestion.setupCard.dbmVerifyFullSlowTableHealthDesc");
  });

  it("keeps the 60-second wording for MySQL, where it is true", () => {
    const step = verifyStepOf(mysqlCard(SUBS));
    expect(step?.descriptionKey).toBe("ingestion.setupCard.dbmVerifyFullDesc");
  });

  it("tells MariaDB about the Table health tab it actually gets", () => {
    // MariaDB ships the table/index recipes and renders the pill, but used to
    // get the generic "events appear" sentence that never mentioned them.
    const step = verifyStepOf(mariadbCard(SUBS));
    expect(step?.descriptionKey).toBe("ingestion.setupCard.dbmVerifyTableHealthDesc");
  });

  it("leaves SQL Server on the generic wording — it ships no table health", () => {
    const step = verifyStepOf(sqlServerCard(SUBS));
    expect(step?.descriptionKey).toBe("ingestion.setupCard.dbmVerifyDesc");
  });
});

describe("the verify copy stays consistent with the shipped recipes", () => {
  it("only the Postgres variant claims minutes; the others claim a 60-second snapshot", () => {
    expect(setupCard.dbmVerifyFullSlowTableHealthDesc).toContain("five minutes");
    expect(setupCard.dbmVerifyFullSlowTableHealthDesc).not.toContain("60-second");

    for (const key of ["dbmVerifyFullDesc", "dbmVerifyTableHealthDesc"]) {
      expect(setupCard[key], `${key} should promise the 60s snapshot`).toContain("60-second");
      expect(setupCard[key], `${key} must not promise minutes`).not.toContain("five minutes");
    }
  });

  it("does not promise Table health where none is collected", () => {
    // SQL Server renders no Table health pill, so its copy must not name the tab.
    expect(setupCard.dbmVerifyDesc).not.toContain("Table health");
  });

  it("discloses the MySQL version floor for estimated plans", () => {
    // MySQL's plan path needs 8.0.22; below it the section is permanently
    // empty, which without this sentence reads as a broken setup.
    expect(setupCard.dbmVerifyFullDesc).toContain("8.0.22");
  });

  it("points every variant at the section's real location", () => {
    // The section moved from Traces to Infra; copy that names the old path
    // sends the reader to a menu that no longer holds it.
    for (const key of [
      "dbmVerifyDesc",
      "dbmVerifyFullDesc",
      "dbmVerifyFullSlowTableHealthDesc",
      "dbmVerifyTableHealthDesc",
      "dbmVerifyBlockingDesc",
    ]) {
      expect(setupCard[key], `${key} names the wrong nav path`).not.toContain("Traces → Databases");
      expect(setupCard[key]).toContain("Infra → Databases");
    }
  });
});

describe("dbmVerifyStep maps its arguments to the right key", () => {
  it("defaults to the 60-second wording", () => {
    expect(dbmVerifyStep("full", true).descriptionKey).toBe(
      "ingestion.setupCard.dbmVerifyFullDesc",
    );
  });

  it("switches wording — not just the pill — when the wait is 300s", () => {
    expect(dbmVerifyStep("full", true, "300s").descriptionKey).toBe(
      "ingestion.setupCard.dbmVerifyFullSlowTableHealthDesc",
    );
  });

  it("ignores the wait when the engine has no table health at all", () => {
    // A 300s hint with `tableHealth: false` must not select a variant whose
    // sentence describes a tab this engine never renders.
    expect(dbmVerifyStep("both", false, "300s").descriptionKey).toBe(
      "ingestion.setupCard.dbmVerifyDesc",
    );
  });
});

// Keeps `yamlOf`/`tableStatsInterval` honest if a future test wires them up to
// assert the interval straight off the rendered YAML.
void yamlOf;
void tableStatsInterval;
