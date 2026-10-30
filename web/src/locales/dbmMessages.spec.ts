import { describe, it, expect } from "vitest";
import { createI18n } from "vue-i18n";

import messages from "./languages/en-US.json";

/**
 * Every Database Monitoring message must COMPILE.
 *
 * vue-i18n compiles messages lazily, so a message containing an unescaped
 * special token (`@` is the linked-message operator, `|` the plural separator)
 * throws at render time — and because the failure happens while the bundle is
 * being read, it takes down the WHOLE namespace: every key in `dbm` then
 * renders as its own dotted path. A literal `@@innodb_print_all_deadlocks` in
 * the empty-state copy did exactly that, turning both new tabs into a wall of
 * `dbm.deadlocks.*` strings.
 *
 * The failure is invisible to JSON validation and to the missing-key lint, so
 * it is pinned here instead.
 */
const i18n = createI18n({
  legacy: false,
  locale: "en",
  // The compile error is the subject of the test; the warning noise is not.
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: messages as Record<string, unknown> },
});

/** Every interpolation name used anywhere under `dbm`, so none is undefined. */
const PARAMS = {
  count: 1,
  databases: "2 databases",
  queries: "34 queries",
  deadlocks: "43 deadlocks",
  pairs: "2 query pairs",
  waiting: "6 sessions",
  sessions: "6 sessions",
  roots: "1 root blocker",
  waits: "6 waits",
  range: "last 6 hours",
  age: "12 seconds",
  when: "3 days ago",
  time: "05:31:12",
  interval: 10,
  lines: 41208,
  seconds: 20,
  longest: "4.8s",
  depth: 3,
  pid: 1069,
  index: 1,
  total: 39,
  a: 21,
  b: 18,
  victim: 1071,
  mode: "ShareLock",
  target: "transaction 1430",
  id: "1430",
  object: "inventory",
  instance: "dbmlab",
  application: "dbm-sv-lock-holder",
  event: "transactionid",
  rate: "0.7",
  share: "91%",
};

/** Every leaf message path under a namespace. */
const paths = (node: unknown, prefix: string): string[] => {
  if (typeof node === "string") return [prefix];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    paths(value, `${prefix}.${key}`),
  );
};

const dbmPaths = paths((messages as Record<string, unknown>).dbm, "dbm");

describe("dbm locale messages", () => {
  it("has the namespace at all", () => {
    // A concurrent write once replaced `dbm` with a stub, silently dropping
    // every pre-existing key; this catches that class of loss.
    expect(dbmPaths.length).toBeGreaterThan(200);
  });

  it("compiles every message", () => {
    const failures: string[] = [];
    for (const path of dbmPaths) {
      try {
        i18n.global.t(path, PARAMS);
      } catch (error) {
        failures.push(`${path}: ${String(error).slice(0, 120)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps the namespaces both new tabs and the existing ones depend on", () => {
    const top = Object.keys((messages as Record<string, Record<string, unknown>>).dbm);
    for (const key of ["common", "databases", "queries", "page", "deadlocks", "blocked"]) {
      expect(top).toContain(key);
    }
  });
});
