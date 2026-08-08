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

import { ALERT_NAME_UNSUPPORTED_CHARS } from "@/components/alerts/AddAlert.schema";
import { buildSloAlertPayload, deriveSloAlertName } from "./sloAlertPayload";

// Feature 5 (Phase 1.4). The SLO alert form builds its own request body: the
// generic `getAlertPayload` is entangled with `useAlertForm`'s refs, and its
// SLO branch disappears when the SLO tab leaves the generic form.
//
// Every rule below is one the BACKEND enforces and would otherwise reject at
// save time, so these are contract tests, not preferences.

const slo = { id: "slo-123", name: "checkout-availability", slice_interval_secs: 300 };

const condition = () => ({
  kind: "burn_rate",
  operator: ">",
  critical: 14.4,
  warning: null,
  long_window_secs: 3600,
  short_window_secs: 600,
  multi_alert: false,
});

const form = (overrides: Record<string, any> = {}) => ({
  name: "fast-burn",
  description: "",
  enabled: true,
  frequencyMinutes: 10,
  silenceMinutes: 30,
  destinations: ["dest1"],
  workflows: [],
  condition: condition(),
  ...overrides,
});

describe("buildSloAlertPayload", () => {
  it("marks the alert as an SLO alert and carries the condition", () => {
    const p = buildSloAlertPayload(form(), { slo });
    expect(p.query_condition.type).toBe("slo");
    // Only the REQUIRED fields are matched exactly. `warning` and
    // `multi_alert` are `skip_serializing_if` on the wire, so a builder that
    // omits a blank one is as correct as one that sends null — asserting the
    // whole object would lock in an incidental representation.
    const required = { ...condition() } as Record<string, any>;
    delete required.warning;
    delete required.multi_alert;
    expect(p.query_condition.slo_condition).toMatchObject(required);
    expect(p.query_condition.slo_condition.warning ?? null).toBeNull();
  });

  // The condition's slo_id must come from the PAGE, not the form: the SLO is
  // context on the SLO detail page, and a stale id in form state would attach
  // the alert to the wrong SLO.
  it("forces slo_id from the page's SLO, overriding anything in form state", () => {
    const p = buildSloAlertPayload(
      form({ condition: { ...condition(), slo_id: "stale-id" } }),
      { slo },
    );
    expect(p.query_condition.slo_condition.slo_id).toBe("slo-123");
  });

  it("is never a realtime alert", () => {
    expect(buildSloAlertPayload(form(), { slo }).is_real_time).toBe(false);
  });

  // An SLO alert runs no query. The backend skips schema resolution for it and
  // waives stream_name, so sending a stream would store a value nothing reads.
  it("sends no stream", () => {
    const p = buildSloAlertPayload(form(), { slo });
    expect(p.stream_name).toBe("");
    expect(p.query_condition.sql).toBe("");
    expect(p.query_condition.aggregation).toBeNull();
    expect(p.query_condition.promql_condition).toBeNull();
  });

  // SA-4: the count gate must be at TriggerCondition::default(). The backend
  // REJECTS a non-default threshold/operator rather than ignoring it, and the
  // SLO form renders no count-gate control at all — so a stray value produces
  // an error naming a field the user cannot see.
  it("pins the count gate to the backend defaults", () => {
    const p = buildSloAlertPayload(form(), { slo });
    expect(p.trigger_condition.operator).toBe("=");
    expect(p.trigger_condition.threshold).toBe(0);
    expect(p.trigger_condition.warning_threshold ?? null).toBeNull();
  });

  it("carries frequency and silence from the form", () => {
    const p = buildSloAlertPayload(form({ frequencyMinutes: 15, silenceMinutes: 45 }), {
      slo,
    });
    expect(p.trigger_condition.frequency).toBe(15);
    expect(p.trigger_condition.silence).toBe(45);
    expect(p.trigger_condition.frequency_type).toBe("minutes");
  });

  // `period` is inert for this family (evaluate_slo_alert never reads it) but
  // it is still a stored numeric the backend validates as a trigger field, so
  // it must be a sane positive number rather than 0 or undefined.
  it("sends an inert but valid period", () => {
    const p = buildSloAlertPayload(form({ frequencyMinutes: 15 }), { slo });
    expect(p.trigger_condition.period).toBeGreaterThan(0);
  });

  it("carries destinations and the enabled flag", () => {
    const p = buildSloAlertPayload(
      form({ destinations: ["a", "b"], enabled: false }),
      { slo },
    );
    expect(p.destinations).toEqual(["a", "b"]);
    expect(p.enabled).toBe(false);
  });

  it("carries the name and description the user typed", () => {
    const p = buildSloAlertPayload(
      form({ name: "checkout-fast-burn", description: "pages the on-call" }),
      { slo },
    );
    expect(p.name).toBe("checkout-fast-burn");
    expect(p.description).toBe("pages the on-call");
  });

  // Enterprise accepts a workflow INSTEAD of a destination
  // (`destinations.is_empty() && workflows.is_empty()` is what it rejects), so
  // a workflow-only alert must build rather than being blocked by a
  // destinations-only assumption.
  it("supports a workflow-only alert", () => {
    const p = buildSloAlertPayload(
      form({ destinations: [], workflows: ["wf-1"] }),
      { slo },
    );
    expect(p.workflows).toEqual(["wf-1"]);
    expect(p.destinations).toEqual([]);
  });

  // Inert for this family — nothing reads it once `query_type == slo` — but it
  // is part of the request shape the API model deserializes, so it must be a
  // valid value rather than empty or absent.
  it("sends a valid inert stream_type", () => {
    const p = buildSloAlertPayload(form(), { slo });
    // The backend deserializes this into a strict lowercase enum with no
    // unknown-value fallback, so any other string is a 400 at save time — a
    // non-empty-string assertion would let "none" through.
    expect(["logs", "metrics", "traces"]).toContain(p.stream_type);
  });

  // Form inputs produce RAW STRINGS, and the backend's trigger fields are
  // i64 — `"10"` is a 400 ("invalid type: string, expected i64"). The generic
  // builder does this same last-mile repair; this one must too.
  it("coerces string numerics from the form inputs", () => {
    const p = buildSloAlertPayload(
      form({
        frequencyMinutes: "15" as any,
        silenceMinutes: "45" as any,
        condition: {
          ...condition(),
          critical: "14.4" as any,
          long_window_secs: "3600" as any,
          short_window_secs: "600" as any,
        },
      }),
      { slo },
    );
    expect(p.trigger_condition.frequency).toBe(15);
    expect(p.trigger_condition.silence).toBe(45);
    expect(p.trigger_condition.period).toBeTypeOf("number");
    expect(p.query_condition.slo_condition.critical).toBe(14.4);
    expect(p.query_condition.slo_condition.long_window_secs).toBe(3600);
    expect(p.query_condition.slo_condition.short_window_secs).toBe(600);
  });

  // Clearing the optional warning input leaves "", and a serialized "" fails
  // the lenient-f64 deserializer ("expected a number"). It must be dropped,
  // not sent — `null` is accepted, "" is not.
  it("drops a blank warning rather than sending an empty string", () => {
    const p = buildSloAlertPayload(
      form({ condition: { ...condition(), warning: "" as any } }),
      { slo },
    );
    expect(p.query_condition.slo_condition.warning ?? null).toBeNull();
    expect(p.query_condition.slo_condition.warning).not.toBe("");
  });

  it("keeps a configured warning, coerced to a number", () => {
    const p = buildSloAlertPayload(
      form({ condition: { ...condition(), warning: "6" as any } }),
      { slo },
    );
    expect(p.query_condition.slo_condition.warning).toBe(6);
  });

  // Per-group fan-out is rejected for EVERY SLO — `MultiAlertRequiresGroupedSlo`
  // when ungrouped, `MultiAlertNotImplemented` when grouped — yet the condition
  // component still renders the checkbox for a grouped SLO. Forwarding a ticked
  // box produces a permanent 400 on every save.
  it("never forwards multi_alert, which the backend rejects unconditionally", () => {
    const p = buildSloAlertPayload(
      form({ condition: { ...condition(), multi_alert: true } }),
      { slo },
    );
    expect(p.query_condition.slo_condition.multi_alert ?? false).toBe(false);
  });

  // An error-budget condition must carry NO windows
  // (`WindowsMismatchedForKind`). Today only a Vue watcher clears them, and it
  // fires on CHANGE — an error-budget alert loaded with stale windows never
  // trips it and is permanently unsavable.
  it("drops windows from an error-budget condition", () => {
    const p = buildSloAlertPayload(
      form({
        condition: {
          kind: "error_budget",
          operator: ">",
          critical: 90,
          long_window_secs: 3600,
          short_window_secs: 600,
        },
      }),
      { slo },
    );
    expect(p.query_condition.slo_condition.long_window_secs ?? null).toBeNull();
    expect(p.query_condition.slo_condition.short_window_secs ?? null).toBeNull();
  });

  // `Number("1e999")` is Infinity, which JSON.stringify writes as `null` — and
  // the backend maps an explicit null warning to "no warning tier". The user
  // would get a 200 OK with their threshold silently discarded.
  it("does not turn a non-finite value into a silently-dropped null", () => {
    const p = buildSloAlertPayload(
      form({ condition: { ...condition(), warning: "1e999" as any } }),
      { slo },
    );
    expect(p.query_condition.slo_condition.warning).not.toBeNull();
    expect(Number.isFinite(p.query_condition.slo_condition.warning)).toBe(false);
  });

  // A stray space in the optional warning box coerces to 0 via Number("  "),
  // and 0 is rejected as `ThresholdNotFinitePositive` — a hard 400 where the
  // user meant "no warning".
  it("treats a whitespace-only optional value as blank, not zero", () => {
    const p = buildSloAlertPayload(
      form({ condition: { ...condition(), warning: "   " as any } }),
      { slo },
    );
    expect(p.query_condition.slo_condition.warning ?? null).toBeNull();
  });

  // A cleared frequency input hands back "", which serializes as a string and
  // fails `expected i64`; undefined omits `period` entirely, which fails
  // "missing field". Neither error names anything the user can act on.
  it("keeps the required trigger numerics numeric even when the input is blank", () => {
    for (const blank of ["", null, undefined]) {
      const p = buildSloAlertPayload(
        form({ frequencyMinutes: blank as any, silenceMinutes: blank as any }),
        { slo },
      );
      expect(p.trigger_condition.frequency).toBeTypeOf("number");
      expect(p.trigger_condition.silence).toBeTypeOf("number");
      expect(p.trigger_condition.period).toBeTypeOf("number");
    }
  });

  describe("edit mode", () => {
    // `update_by_alert_id` PUTs the FULL body, so a builder that emits only the
    // fields this form knows about silently wipes everything set elsewhere —
    // tags, priority, owner, context_attributes, a cron frequency created via
    // the API. Every UI edit would quietly strip them.
    // A REALISTIC fetched alert. A thin fixture proves nothing: the GET
    // returns the whole stored alert, including stream fields and query
    // leftovers, and every value below differs from what the form holds so a
    // merge in the wrong direction cannot pass.
    const existing = {
      id: "alert-1",
      name: "the old name",
      owner: "someone@example.com",
      tags: ["team:payments"],
      priority: 1,
      context_attributes: { env: "prod" },
      creates_incident: true,
      is_real_time: false,
      stream_name: "k8s_logs",
      stream_type: "logs",
      trigger_condition: {
        frequency_type: "cron",
        cron: "0 9 * * *",
        timezone: "UTC",
        // Deliberately different from the form's 10/30 — identical values
        // cannot tell "the edit won" from "the stored value was kept".
        frequency: 7,
        silence: 3,
        period: 42,
      },
      query_condition: {
        type: "slo",
        sql: "SELECT 1",
        aggregation: { field: "count" },
        promql_condition: { query: "up" },
        conditions: [{ column: "x" }],
        slo_condition: { ...condition(), slo_id: "SOME-OTHER-SLO" },
      },
    };

    // The SLO invariants are NOT create-only. Everything the backend enforces
    // has to hold on the update path too — and an edit that PUTs a body
    // missing `slo_id` is rejected with `SloNotFound`, which reads as "your
    // SLO vanished" rather than "the form dropped a field".
    it("re-asserts every SLO invariant when merging onto an existing alert", () => {
      const p = buildSloAlertPayload(form(), { slo, existing });

      expect(p.query_condition.type).toBe("slo");
      expect(p.query_condition.slo_condition.slo_id).toBe("slo-123");
      expect(p.stream_name).toBe("");
      expect(p.query_condition.sql).toBe("");
      expect(p.query_condition.aggregation).toBeNull();
      expect(p.query_condition.promql_condition).toBeNull();
      expect(p.is_real_time).toBe(false);
    });

    // `prepare_alert` rejects a `promql_warning_value` with no
    // `promql_condition` — and that check is NOT gated on query type. Nulling
    // the condition while inheriting the warning makes the alert permanently
    // unsavable, with an error naming a PromQL field the SLO form cannot show.
    it("clears an inherited promql warning along with the promql condition", () => {
      const p = buildSloAlertPayload(form(), {
        slo,
        existing: {
          ...existing,
          query_condition: { ...existing.query_condition, promql_warning_value: 3 },
        },
      });
      expect(p.query_condition.promql_condition).toBeNull();
      expect(p.query_condition.promql_warning_value ?? null).toBeNull();
    });

    // The payload must not alias the fetched alert: a caller mutating what it
    // is about to send would edit the object the page still renders from.
    it("does not alias nested objects from the fetched alert", () => {
      const p = buildSloAlertPayload(form(), { slo, existing });
      expect(p.tags).not.toBe(existing.tags);
      expect(p.context_attributes).not.toBe(existing.context_attributes);
    });

    // Dead for this family and none of them rejected today — but they are
    // exactly the fields a future validation would gate on, and the reset
    // block's comment already claims the query is fully cleared.
    it("clears every other query-shaped field it inherits", () => {
      const p = buildSloAlertPayload(form(), {
        slo,
        existing: {
          ...existing,
          query_condition: {
            ...existing.query_condition,
            vrl_function: "Li4u",
            search_event_type: "alerts",
            promql_multi_alert: true,
            multi_time_range: [{ offSet: "1h" }],
          },
        },
      });
      expect(p.query_condition.vrl_function ?? null).toBeNull();
      expect(p.query_condition.search_event_type ?? null).toBeNull();
      expect(p.query_condition.promql_multi_alert ?? false).toBe(false);
      expect(p.query_condition.multi_time_range ?? null).toBeNull();
    });

    it("applies the edited frequency over the stored one", () => {
      const p = buildSloAlertPayload(form({ frequencyMinutes: 10 }), { slo, existing });
      expect(p.trigger_condition.frequency).toBe(10);
    });

    it("preserves fields the form does not own", () => {
      const p = buildSloAlertPayload(form(), { slo, existing });
      expect(p.tags).toEqual(["team:payments"]);
      expect(p.priority).toBe(1);
      expect(p.context_attributes).toEqual({ env: "prod" });
      expect(p.owner).toBe("someone@example.com");
      expect(p.creates_incident).toBe(true);
      expect(p.id).toBe("alert-1");
    });

    // A cron frequency is creatable through the API and the form is
    // minutes-only. Silently rewriting it to minutes on an unrelated edit
    // would change WHEN someone gets paged.
    it("does not silently convert a cron frequency to minutes", () => {
      const p = buildSloAlertPayload(form(), { slo, existing });
      expect(p.trigger_condition.frequency_type).toBe("cron");
      expect(p.trigger_condition.cron).toBe("0 9 * * *");
    });

    // ...but the count gate is still forced, because it is what the backend
    // rejects and an inherited non-default value must not survive.
    it("still pins the count gate when preserving other fields", () => {
      const p = buildSloAlertPayload(form(), {
        slo,
        existing: {
          ...existing,
          trigger_condition: {
            ...existing.trigger_condition,
            operator: ">=",
            threshold: 3,
            // Part of the same gate the backend checks — an inherited warning
            // is rejected exactly like a non-default threshold.
            warning_threshold: 2,
          },
        },
      });
      expect(p.trigger_condition.operator).toBe("=");
      expect(p.trigger_condition.threshold).toBe(0);
      expect(p.trigger_condition.warning_threshold ?? null).toBeNull();
    });

    it("applies the edited silence over the preserved one", () => {
      const p = buildSloAlertPayload(form({ silenceMinutes: 99 }), { slo, existing });
      expect(p.trigger_condition.silence).toBe(99);
    });

    // Every edited field must WIN over the preserved copy. The fixtures above
    // deliberately share a name/condition with `existing`, so on their own they
    // cannot tell a correct merge from one that spreads `existing` last and
    // silently discards the user's edits.
    it("lets edited fields win over the preserved ones", () => {
      const edited = form({
        name: "renamed-by-the-user",
        description: "new description",
        enabled: false,
        destinations: ["pager"],
        condition: { ...condition(), critical: 6, long_window_secs: 21600 },
      });

      const p = buildSloAlertPayload(edited, { slo, existing });

      expect(p.name).toBe("renamed-by-the-user");
      expect(p.description).toBe("new description");
      expect(p.enabled).toBe(false);
      expect(p.destinations).toEqual(["pager"]);
      expect(p.query_condition.slo_condition.critical).toBe(6);
      expect(p.query_condition.slo_condition.long_window_secs).toBe(21600);
      // ...while an untouched field still survives.
      expect(p.tags).toEqual(["team:payments"]);
    });
  });
});

describe("deriveSloAlertName", () => {
  // With several alerts per SLO the name is what tells the fast-burn pager
  // from the slow-burn ticket, in both the SLO page and the alerts list.
  it("describes the condition rather than numbering the alert", () => {
    const name = deriveSloAlertName(slo, condition());
    expect(name).toContain("checkout-availability");
    expect(name).toMatch(/14\.4/);
    // The window is what distinguishes a fast burn from a slow one.
    expect(name).toMatch(/1\s*h|hour/i);
  });

  // Alert names containing "/" are rejected outright by the backend, and
  // "14.4x/1h" is the natural way to write a burn window — so the derivation
  // must never produce one.
  // Two SEPARATE backend rules, and the stricter one runs FIRST:
  //   1. `is_ofga_unsupported` rejects [:#?\s'"%&] — note \s, so a name with a
  //      SPACE is rejected. This fires before anything else in `prepare_alert`.
  //   2. `AlertNameContainsForwardSlash` rejects "/".
  // A space is the likeliest character in a derived name and a slash among the
  // least, so guarding only "/" would miss the rule that actually bites.
  it("produces a name the backend will accept", () => {
    for (const name of [
      deriveSloAlertName(slo, condition()),
      deriveSloAlertName(slo, { ...condition(), long_window_secs: 86400 }),
      deriveSloAlertName({ ...slo, name: "a/b" }, condition()),
      // An SLO whose own name carries the offending characters.
      deriveSloAlertName({ ...slo, name: "checkout availability" }, condition()),
      deriveSloAlertName({ ...slo, name: "team:payments 100%" }, condition()),
    ]) {
      // Non-empty first: "" satisfies every "does not contain" assertion.
      expect(name.length).toBeGreaterThan(0);
      expect(name).not.toContain("/");
      expect(name).not.toMatch(ALERT_NAME_UNSUPPORTED_CHARS);
      // A missing window must not render as "NaNh"/"undefined".
      expect(name).not.toMatch(/NaN|undefined/);
    }
  });

  // An SLO may hold several burn-rate alerts differing ONLY by window (that is
  // the whole multi-window pattern), and nothing enforces name uniqueness
  // server-side. If the derivation ignores the window, the SLO page shows two
  // identically-named rows — exactly the indistinguishability the derived name
  // exists to prevent.
  // `alerts.name` is a varchar(256) column, and SLO names are user-supplied.
  // A derived name longer than that fails at the database rather than in
  // validation, which surfaces as an opaque 500.
  it("stays within the name column's 256-character limit", () => {
    const name = deriveSloAlertName({ name: "x".repeat(300) }, condition());
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(256);
    // Truncation must not strip the part that distinguishes two alerts.
    expect(name).toMatch(/14\.4x/);
  });

  // Truncating by UTF-16 code units can cut an astral character in half. The
  // resulting lone surrogate serializes as "\ud83d", which serde_json refuses
  // with an opaque parse error naming no field.
  it("never truncates an astral character into a lone surrogate", () => {
    for (const cond of [
      condition(),
      { kind: "error_budget", operator: ">", critical: 90 },
    ]) {
      const name = deriveSloAlertName({ name: "🚀".repeat(300) }, cond);
      expect(name.length).toBeLessThanOrEqual(256);
      expect(name.isWellFormed?.() ?? true).toBe(true);
    }
  });

  // The suffix interpolates `critical` verbatim, so a pasted long value can
  // blow the cap even after the SLO name is trimmed to nothing.
  it("caps the total length even when the suffix itself is oversized", () => {
    const name = deriveSloAlertName(
      { name: "api" },
      { ...condition(), critical: "9".repeat(300) as any },
    );
    expect(name.length).toBeLessThanOrEqual(256);
  });

  // Rust's `\s` is Unicode White_Space and matches U+0085; JavaScript's does
  // not. A name carrying one passes a JS-only check and is then rejected.
  it("strips whitespace JavaScript's \\s misses but Rust's matches", () => {
    const name = deriveSloAlertName({ name: "a\u0085b" }, condition());
    expect(name).not.toContain("\u0085");
  });

  // Before the user picks a threshold, `critical` is null. Rendering that as
  // "burn-0x" states a burn rate of zero, which is both wrong and the one
  // value that can never be configured.
  it("omits the threshold from the name until one is chosen", () => {
    const name = deriveSloAlertName(slo, { ...condition(), critical: null });
    expect(name).not.toMatch(/0x/);
    expect(name.length).toBeGreaterThan(0);
  });

  it("distinguishes two burn-rate alerts that differ only by window", () => {
    expect(deriveSloAlertName(slo, condition())).not.toBe(
      deriveSloAlertName(slo, { ...condition(), long_window_secs: 86400, short_window_secs: 7200 }),
    );
  });

  // (long, short) is the unit the cap counts, so two alerts sharing a long
  // window but differing in the short one are genuinely distinct — and with
  // the name-uniqueness index dropped, both save under one name if the
  // derivation ignores the short window.
  it("distinguishes two alerts that share a long window but differ in the short one", () => {
    expect(deriveSloAlertName(slo, { ...condition(), short_window_secs: 300 })).not.toBe(
      deriveSloAlertName(slo, { ...condition(), short_window_secs: 600 }),
    );
  });

  it("distinguishes an error-budget alert from a burn-rate one", () => {
    const burn = deriveSloAlertName(slo, condition());
    // Same `critical` as the burn-rate condition on purpose: if the numbers
    // differed too, a name that ignores `kind` entirely would still differ and
    // the test would pass for the wrong reason.
    const budget = deriveSloAlertName(slo, {
      ...condition(),
      kind: "error_budget",
    });
    expect(budget).not.toBe(burn);
    expect(budget).toMatch(/budget/i);
  });
});
