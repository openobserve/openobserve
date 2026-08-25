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
 * Every warning this adapter emits must have copy behind it.
 *
 * The form renders warnings as `t("alerts.prefill.warnings." + key)`, and
 * vue-i18n's miss behaviour is to print the KEY. A missing entry therefore does
 * not fail loudly — it ships an alert form telling the user
 * "dbmServerVantage", which is worse than saying nothing because it looks like
 * a bug in their data rather than in ours.
 *
 * The messages are also COMPILED here, not merely looked up. An unescaped `@`
 * or `|` is a vue-i18n syntax error that takes down the whole namespace at
 * runtime, and `dbmMessages.spec.ts` exists in this repo because that has
 * happened before.
 */

import { describe, it, expect } from "vitest";
import { createI18n } from "vue-i18n";
import enUS from "@/locales/languages/en-US.json";
import { buildDbmLockPrefill } from "./fromDbmLocks";
import { ALERT_SOURCES } from "../alertSourceRegistry";

/** Every key the adapter can emit, across all of its branches. */
const emittedKeys = new Set(
  [
    buildDbmLockPrefill({ kind: "blocking", dbSystem: "postgresql", dbInstance: "orders-db" }),
    buildDbmLockPrefill({ kind: "deadlocks", dbSystem: "mysql", dbInstance: "billing-db" }),
    // The degraded branch, which is the one that emits `dbmNoInstance`.
    buildDbmLockPrefill({ kind: "blocking" }),
  ]
    .flatMap((prefill) => prefill.warnings)
    .map((warning) => warning.key),
);

const warnings = (enUS as any).alerts.prefill.warnings as Record<string, string>;

describe("lock-alert copy exists for every warning the adapter emits", () => {
  it("emits the three warnings this surface is responsible for", () => {
    // Pins the set itself, so deleting a warning from the adapter has to be a
    // deliberate act rather than something this spec quietly stops checking.
    expect([...emittedKeys].sort()).toEqual([
      "dbmLockSampling",
      "dbmNoInstance",
      "dbmServerVantage",
    ]);
  });

  it.each([...emittedKeys])("has en-US copy for %s", (key) => {
    expect(warnings[key], `no copy for "${key}" — the form would print the key`).toBeTruthy();
  });

  /**
   * The vantage warning is the honesty contract's carrier. Copy that does not
   * distinguish where the measurement came from leaves the user comparing a
   * server-side lock wait with a client-side span latency.
   */
  it("says the measurement is server-side, not client-observed", () => {
    expect(warnings.dbmServerVantage.toLowerCase()).toContain("server");
  });

  it("says sampling can miss short-lived contention", () => {
    expect(warnings.dbmLockSampling.toLowerCase()).toContain("sampl");
  });
});

describe("lock-alert copy compiles", () => {
  /**
   * Compiles the whole namespace, then renders each message. A raw `@` or `|`
   * anywhere in it throws here rather than at runtime in the form.
   */
  const i18n = createI18n({
    legacy: false,
    locale: "en-US",
    messages: { "en-US": enUS as any },
  });

  it.each([...emittedKeys])("renders %s without a syntax error", (key) => {
    const rendered = i18n.global.t(`alerts.prefill.warnings.${key}`);
    expect(rendered).not.toBe(`alerts.prefill.warnings.${key}`);
    expect(rendered.length).toBeGreaterThan(0);
  });
});

describe("the lock surface is a registered alert source", () => {
  /**
   * An unregistered source silently falls back to DEFAULT_ALERT_SOURCE, whose
   * `defaultThreshold` is "matching-rows". This adapter thresholds on a single
   * aggregated value in a HAVING clause — there are no matching rows to count —
   * so the fallback would misconfigure the form rather than fail.
   */
  it("registers dbmlocks with a count threshold", () => {
    const source = ALERT_SOURCES.dbmlocks;
    expect(source, "buildDbmLockPrefill emits source 'dbmlocks'").toBeTruthy();
    expect(source.defaultThreshold).toBe("count");
  });

  it("has copy behind the registered label and toast keys", () => {
    const source = ALERT_SOURCES.dbmlocks;
    const lookup = (path: string) =>
      path.split(".").reduce<any>((node, part) => node?.[part], enUS as any);
    expect(lookup(source.labelKey)).toBeTruthy();
    expect(lookup(source.toastKey)).toBeTruthy();
  });
});
