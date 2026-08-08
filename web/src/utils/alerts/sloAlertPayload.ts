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

//! The request body for an SLO alert (Feature 5, Phase 1.4).
//!
//! Its own builder rather than a branch of `getAlertPayload`: that one is
//! entangled with `useAlertForm`'s refs, and its SLO branch disappears when
//! the SLO tab leaves the generic form.

export interface SloAlertFormState {
  name: string;
  description?: string;
  enabled: boolean;
  frequencyMinutes: number;
  silenceMinutes: number;
  destinations: string[];
  workflows?: string[];
  condition: Record<string, any>;
}

export interface BuildOptions {
  slo: { id: string; name?: string; slice_interval_secs?: number };
  /** The stored alert, when editing. See the spread rule below. */
  existing?: Record<string, any> | null;
}

/**
 * The count gate, pinned to the backend's `TriggerCondition::default()`.
 *
 * SA-4: this family has no count axis, and a non-default gate is **rejected**
 * rather than ignored. The SLO form renders no count-gate control, so an
 * inherited value produces an error naming a field the user cannot see.
 * `Operator::EqualTo` serializes to "=" and `threshold` defaults to 0;
 * `warning_threshold` is part of the same gate and must be absent.
 */
const DEFAULT_COUNT_GATE = { operator: "=", threshold: 0 } as const;

/** `alerts.name` is a varchar(256) column; a longer name fails at the DB. */
const MAX_ALERT_NAME_LENGTH = 256;

/**
 * Form inputs hand back RAW STRINGS, and the backend's numerics are `i64`/
 * `f64` — `"10"` is a 400 (`invalid type: string, expected i64`). Same
 * last-mile repair the generic builder performs.
 */
const toNumber = (v: unknown): any => {
  if (isBlank(v)) return v;
  const n = Number(v);
  // Non-finite too, not just NaN: `Number("1e999")` is Infinity, which
  // JSON.stringify writes as `null` — and an explicit null OPTIONAL is read as
  // "not set", so an out-of-range threshold would save with a 200 and be
  // silently discarded. Passing the original through earns an honest 400.
  return Number.isFinite(n) ? n : v;
};

/** Blank means "the user left it empty" — including whitespace, which
 *  `Number("  ")` would otherwise coerce to a very meaningful 0. */
const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Coerce in place when present; a blank OPTIONAL value is deleted, never
 *  serialized — `""` fails the lenient-f64 deserializer, `null` does not. */
const normalizeNumber = (obj: any, key: string, optional = false) => {
  if (!obj || !(key in obj)) return;
  if (isBlank(obj[key])) {
    if (optional) delete obj[key];
    return;
  }
  obj[key] = toNumber(obj[key]);
};

/** A required trigger number always ships numeric: `""` serializes as a string
 *  ("expected i64") and `undefined` drops the key ("missing field `period`"),
 *  and neither error names anything the user can act on. */
const requiredNumber = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return isBlank(v) || !Number.isFinite(n) ? fallback : n;
};

export const buildSloAlertPayload = (
  form: SloAlertFormState,
  opts: BuildOptions,
): Record<string, any> => {
  const existing = opts.existing ?? null;

  // Spread `existing` FIRST so everything this form does not own — tags,
  // priority, owner, context_attributes, creates_incident, a cron frequency
  // set through the API — survives. `update_by_alert_id` PUTs the full body,
  // so anything omitted here is deleted from the stored alert.
  //
  // Deep-cloned: a shallow spread would leave `payload.tags` and
  // `payload.context_attributes` aliasing the fetched alert, so a caller
  // adjusting the body it is about to send would edit the object the page is
  // still rendering from.
  const payload: Record<string, any> = existing ? JSON.parse(JSON.stringify(existing)) : {};

  payload.name = form.name;
  payload.description = form.description ?? "";
  payload.enabled = form.enabled;
  payload.destinations = form.destinations ?? [];
  payload.workflows = form.workflows ?? [];

  // An SLO alert is never realtime, and it has no stream: the backend waives
  // `stream_name` for this family and skips schema resolution entirely. Both
  // are re-asserted on the update path too — an edit that inherits a stream
  // from a converted alert would store a value nothing ever reads.
  payload.is_real_time = false;
  payload.stream_name = "";
  // Absent would also be accepted (the model defaults to logs), but an empty
  // string is NOT — the enum has no empty variant. Send a real value.
  payload.stream_type = existing?.stream_type || "logs";

  payload.query_condition = {
    ...(payload.query_condition ?? {}),
    type: "slo",
    // The SLO comes from the PAGE, never from form state: a stale id would
    // attach the alert to the wrong SLO, and an absent one is rejected as
    // `SloNotFound` — which reads as "your SLO vanished".
    slo_condition: { ...form.condition, slo_id: opts.slo.id },
    // This family runs no query. Anything picked up on the way here would be
    // stored and never read.
    sql: "",
    promql: "",
    conditions: [],
    aggregation: null,
    promql_condition: null,
    // Dead for this family too. None is rejected today, but they are exactly
    // the fields a later validation would gate on, and leaving them behind
    // contradicts "runs no query".
    vrl_function: null,
    search_event_type: null,
    promql_multi_alert: false,
    multi_time_range: null,
    // Cleared with the condition it depends on: `prepare_alert` rejects a
    // warning with no PromQL condition, and that check is NOT gated on query
    // type — an inherited one makes the alert permanently unsavable.
    promql_warning_value: null,
  };

  const cond = payload.query_condition.slo_condition;
  // Per-group fan-out is rejected for EVERY SLO — ungrouped and grouped alike —
  // so it can never be forwarded, whatever the condition component offered.
  cond.multi_alert = false;
  // An error-budget condition must carry no windows at all. Relying on the
  // component's `kind` watcher is not enough: it fires on CHANGE, so an alert
  // loaded with stale windows keeps them and can never be saved.
  if (cond.kind === "error_budget") {
    delete cond.long_window_secs;
    delete cond.short_window_secs;
  }
  normalizeNumber(cond, "critical");
  normalizeNumber(cond, "long_window_secs", true);
  normalizeNumber(cond, "short_window_secs", true);
  normalizeNumber(cond, "warning", true);

  const inheritedTrigger = { ...(existing?.trigger_condition ?? {}) };
  // A cron frequency is creatable through the API and this form is
  // minutes-only; silently rewriting it would change WHEN someone is paged.
  const keepsCron = inheritedTrigger.frequency_type === "cron";
  delete inheritedTrigger.warning_threshold;

  payload.trigger_condition = {
    ...inheritedTrigger,
    ...DEFAULT_COUNT_GATE,
    // Only `frequency_type` and the `cron` string belong to cron mode; they
    // are preserved so an API-created schedule is not rewritten. `frequency`
    // is form-owned and always takes the user's value — though note that while
    // cron is in force the SCHEDULER ignores it, so a minutes edit on a
    // cron alert changes the stored field without changing when it runs. The
    // form should show cron read-only and say so rather than implying
    // otherwise.
    frequency_type: keepsCron ? "cron" : "minutes",
    frequency: requiredNumber(form.frequencyMinutes, 1),
    silence: requiredNumber(form.silenceMinutes, 0),
    // Inert for this family — `evaluate_slo_alert` never reads it — but the
    // request model declares it without a default, so omitting it fails
    // deserialization with "missing field `period`".
    period: requiredNumber(form.frequencyMinutes, 1),
  };

  return payload;
};

/** A BURN window rendered compactly — days/hours/minutes, and without the "/"
 *  or spaces an alert name may not contain.
 *
 *  Deliberately not `formatWindow`: that one describes an SLO's compliance
 *  window in days, so it renders a 1-hour burn window as "0d" and makes a fast
 *  burn indistinguishable from a slow one. */
export const burnWindowLabel = (secs: unknown): string => {
  const n = Number(secs);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n % 86400 === 0) return `${n / 86400}d`;
  if (n % 3600 === 0) return `${n / 3600}h`;
  return `${Math.round(n / 60)}m`;
};

/**
 * A descriptive default name for a new SLO alert.
 *
 * With several alerts per SLO the name is what tells the fast-burn pager from
 * the slow-burn ticket, in both the SLO page and the alerts list — so it
 * describes the condition rather than numbering the alert, and includes the
 * window so two alerts differing only by window do not collide.
 *
 * Two backend rules constrain the output, and the stricter runs FIRST:
 * `is_ofga_unsupported` rejects [:#?\s'"%&] — including **whitespace** — and
 * only then is "/" rejected. Everything is joined with hyphens for that
 * reason; a natural-language name would be refused outright.
 */
export const deriveSloAlertName = (
  slo: { name?: string },
  condition: Record<string, any>,
): string => {
  const suffix: string[] = [];
  // A threshold of 0 is not merely wrong, it is the one value that can never
  // be configured — so before the user picks one the name says the KIND and
  // stops, rather than asserting a burn rate of zero.
  const critical = Number(condition?.critical);
  const hasCritical = Number.isFinite(critical) && critical > 0;

  if (condition?.kind === "error_budget") {
    suffix.push("budget");
    if (hasCritical) suffix.push(`${critical}pct`);
  } else {
    suffix.push("burn");
    if (hasCritical) suffix.push(`${critical}x`);
    const longSecs = Number(condition?.long_window_secs);
    const shortSecs = Number(condition?.short_window_secs);
    const long = burnWindowLabel(longSecs);
    if (long) suffix.push(long);
    // (long, short) is the unit the pair cap counts, so two alerts sharing a
    // long window but differing in the short one are genuinely distinct. Only
    // spelled out when it is NOT the conventional long / 12, to keep the
    // common case short.
    if (
      Number.isFinite(longSecs) &&
      Number.isFinite(shortSecs) &&
      shortSecs > 0 &&
      Math.round(longSecs / 12) !== Math.round(shortSecs)
    ) {
      const short = burnWindowLabel(shortSecs);
      if (short) suffix.push(short);
    }
  }

  const clean = (s: string) =>
    s
      .toLowerCase()
      // Collapse every character the name rules forbid — whitespace, "/", and
      // the rest of the ofga set — into the separator, then tidy the result.
      // U+0085 is Unicode White_Space (which Rust's `\s` matches) but is NOT
      // in JavaScript's `\s`, so it has to be named explicitly.
      .replace(/[:#?\s\u0085'"%&/]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "");

  const tail = clean(suffix.join("-"));
  // `alerts.name` is varchar(256). The SLO name is user-supplied and can be
  // arbitrarily long, so it — never the suffix — is what gets trimmed: the
  // suffix is the part that tells two alerts on one SLO apart.
  const room = Math.max(1, MAX_ALERT_NAME_LENGTH - tail.length - 1);
  // Sliced by CODE POINT: cutting UTF-16 units can split an astral character
  // into a lone surrogate, which serde_json rejects with an opaque parse error.
  const head = Array.from(clean(slo?.name || "slo"))
    .slice(0, room)
    .join("");

  // Final cap as well as the head budget: `critical` is interpolated verbatim,
  // so a pasted long value can overrun even with the name trimmed away.
  //
  // Trimmed a whole code point at a time until BOTH counts fit. The column is
  // varchar(256) — characters — but staying inside the UTF-16 length too is
  // free here and safe under either counting rule.
  const points = Array.from(clean(`${head}-${tail}`));
  while (points.length > MAX_ALERT_NAME_LENGTH || points.join("").length > MAX_ALERT_NAME_LENGTH) {
    points.pop();
  }
  return points.join("");
};
