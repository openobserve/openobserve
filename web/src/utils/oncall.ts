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

// Pure helpers shared by the on-call screens. Kept out of the components so the
// rotation maths — the part that is easy to get subtly wrong — is testable
// without mounting anything.

import type {
  AlertPriorityValue,
  Channel,
  DeliveryRecord,
  DeliveryStatus,
  EscalationTarget,
  L0Policy,
  ResponseState,
  Rotation,
  ShiftRule,
  TimeWindow,
  OnCallResponse,
  OnCallResponseEvent,
  OnCallResponseGroup,
  OnCallPosition,
  PreviewRung,
  PriorityRung,
  PromoteSeverity,
  ResponseEventKind,
} from "@/ts/interfaces/oncall";
import { PROMOTE_SEVERITIES } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_HOUR, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { RowRailTone } from "@/lib/core/Table/OTable.types";
import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import { raw } from "@/types/i18n";

/**
 * Who holds `rule` at `atMicros`.
 *
 * Mirrors `ShiftRule::member_at`: floor division so instants before the anchor
 * resolve backwards instead of collapsing onto shift 0, and an exclusive upper
 * bound so the handover instant belongs to the incoming person. Returning
 * `null` for an unusable rule is deliberate — an unstaffed level has to read as
 * a coverage gap, never as a silently chosen fallback.
 *
 * Takes a **shift rule**, not a rotation: the roster and the cadence moved down
 * a level when rotations became named objects, and a rotation with several
 * rules has no single roster to ask about.
 */
export function memberAt(rule: ShiftRule, atMicros: number): string | null {
  const { members, shift_micros: shift, anchor_micros: anchor } = rule;
  if (!members?.length || !shift || shift <= 0) return null;
  const index = Math.floor((atMicros - anchor) / shift);
  // JS `%` keeps the sign of the dividend, so a pre-anchor index needs the
  // extra wrap; without it, index -1 of a 3-person rotation yields -1.
  const wrapped = ((index % members.length) + members.length) % members.length;
  return members[wrapped] ?? null;
}

/** Instant the shift containing `atMicros` ends, i.e. the next handover. */
export function nextHandover(rule: ShiftRule, atMicros: number): number | null {
  const { shift_micros: shift, anchor_micros: anchor } = rule;
  if (!rule.members?.length || !shift || shift <= 0) return null;
  return anchor + (Math.floor((atMicros - anchor) / shift) + 1) * shift;
}

/** One person's turn: when it starts, when it ends, and whose it is. */
export interface Shift {
  startMicros: number;
  endMicros: number;
  member: string;
  /** Which shift rule produced this turn, by name. */
  rule?: string;
}

/**
 * The next `count` shifts of a shift rule, starting with the one containing
 * `fromMicros`.
 *
 * A schedule is only comprehensible when you can see who it puts on call, so
 * this exists to render the answer rather than the configuration. Pure, so the
 * boundary arithmetic is testable without mounting anything.
 */
export function upcomingShifts(rule: ShiftRule, fromMicros: number, count: number): Shift[] {
  const { shift_micros: shift, anchor_micros: anchor, members } = rule;
  if (!members?.length || !shift || shift <= 0 || count <= 0) return [];

  const firstIndex = Math.floor((fromMicros - anchor) / shift);
  const shifts: Shift[] = [];
  for (let i = 0; i < count; i++) {
    const index = firstIndex + i;
    const startMicros = anchor + index * shift;
    const wrapped = ((index % members.length) + members.length) % members.length;
    shifts.push({
      startMicros,
      endMicros: startMicros + shift,
      member: members[wrapped],
      rule: rule.name,
    });
  }
  return shifts;
}

/** One time window, and everyone on call for it across a set of rules. */
export interface CombinedShift {
  startMicros: number;
  endMicros: number;
  /** One per rule that has a shift over this exact window, in rule order. */
  entries: { ruleName: string; member: string }[];
}

/**
 * The next shifts of several rules at once, merged into a single chronological
 * timeline instead of one list per rule.
 *
 * Rules that share an anchor and cadence land on identical windows — the
 * common case, e.g. a primary and secondary covering the same weeks — and
 * those collapse into one row so the time only has to be read once. Rules
 * that don't align just interleave by start time.
 */
export function combinedUpcomingShifts(
  rules: ShiftRule[],
  fromMicros: number,
  countPerRule: number,
): CombinedShift[] {
  const byWindow = new Map<string, CombinedShift>();
  for (const rule of rules) {
    for (const shift of upcomingShifts(rule, fromMicros, countPerRule)) {
      const key = `${shift.startMicros}-${shift.endMicros}`;
      let combined = byWindow.get(key);
      if (!combined) {
        combined = { startMicros: shift.startMicros, endMicros: shift.endMicros, entries: [] };
        byWindow.set(key, combined);
      }
      combined.entries.push({ ruleName: shift.rule ?? "", member: shift.member });
    }
  }
  return [...byWindow.values()].sort((a, b) => a.startMicros - b.startMicros);
}

/** Every person named by any rule of a rotation, de-duplicated, in rule order. */
export function rotationMembers(rotation: Rotation): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rule of rotation.shift_rules ?? []) {
    for (const member of rule.members ?? []) {
      const key = member.trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(member);
      }
    }
  }
  return out;
}

/** Shift presets offered in the schedule editor, in micros. */
/** One band on the calendar: a person covering a span of the window. */
export interface CalendarBand {
  /** Empty means nobody is on call for this span. */
  user_email: string;
  startMicros: number;
  endMicros: number;
  /** Share of the visible window, 0-1, for positioning. */
  offset: number;
  width: number;
}

/**
 * Shifts of one shift rule, clipped to a visible window.
 *
 * Clipped rather than whole so a band never runs past the edge of the chart:
 * a week view of a fortnightly rotation would otherwise draw one band four
 * times too wide and push everything else off screen.
 */
export function shiftBands(
  rule: ShiftRule,
  windowStart: number,
  windowEnd: number,
): CalendarBand[] {
  const { shift_micros: shift, anchor_micros: anchor, members } = rule;
  const span = windowEnd - windowStart;
  if (!members?.length || !shift || shift <= 0 || span <= 0) return [];

  const bands: CalendarBand[] = [];
  const firstIndex = Math.floor((windowStart - anchor) / shift);
  // Bounded: a one-minute shift over a month view would otherwise produce
  // tens of thousands of unreadable slivers and lock the page.
  const maxBands = 500;

  for (let i = 0; i < maxBands; i++) {
    const start = anchor + (firstIndex + i) * shift;
    if (start >= windowEnd) break;
    const end = start + shift;
    if (end <= windowStart) continue;

    const clippedStart = Math.max(start, windowStart);
    const clippedEnd = Math.min(end, windowEnd);
    bands.push({
      user_email: memberAt(rule, start) ?? "",
      startMicros: clippedStart,
      endMicros: clippedEnd,
      offset: (clippedStart - windowStart) / span,
      width: (clippedEnd - clippedStart) / span,
    });
  }
  return bands;
}

/**
 * A stable colour index per person.
 *
 * Derived from the email rather than from position, so somebody keeps their
 * colour when the rotation is reordered or the window scrolls — a band that
 * changes colour as you page through the calendar is unreadable.
 */
export function colorIndexFor(email: string, buckets = 8): number {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % buckets;
}

export const SHIFT_PRESETS = [
  { micros: 8 * MICROS_PER_HOUR, labelKey: "oncall.shift8h" },
  { micros: 12 * MICROS_PER_HOUR, labelKey: "oncall.shift12h" },
  { micros: MICROS_PER_DAY, labelKey: "oncall.shiftDaily" },
  { micros: MICROS_PER_WEEK, labelKey: "oncall.shiftWeekly" },
  { micros: 2 * MICROS_PER_WEEK, labelKey: "oncall.shiftFortnightly" },
] as const satisfies ReadonlyArray<{ micros: number; labelKey: I18nKey }>;

/**
 * Priority as `P1`..`P5`. Out-of-range values render as `—` rather than a
 * guess: a priority the UI cannot read must not be shown as a plausible one.
 */
export function priorityLabel(priority: number): string {
  return priority >= 1 && priority <= 5 ? `P${priority}` : "—";
}

/** Severity colour for `OTag`, matching the alerts list. */
export function priorityTagVariant(priority: number): BadgeVariant {
  switch (priority) {
    case 1:
      return "error-soft";
    case 2:
      return "orange-soft";
    case 3:
      return "amber-soft";
    case 4:
      return "blue-soft";
    default:
      return "default-soft";
  }
}

/**
 * Priority → the `OTable` row-rail tone.
 *
 * The rail is a token (`--color-priority-p*`), not a colour string: the chip and
 * the rail for the same priority are then provably the same colour, and the ramp
 * is editable in one place. Anything outside 1–5 rails as neutral rather than
 * guessing a severity.
 */
export const PRIORITY_TONE: Record<AlertPriorityValue, RowRailTone> = {
  1: "p1",
  2: "p2",
  3: "p3",
  4: "p4",
  5: "p5",
};

export function priorityTone(priority: number): RowRailTone {
  return PRIORITY_TONE[priority as AlertPriorityValue] ?? "neutral";
}

/**
 * Whether a channel survives a locked, silenced phone.
 *
 * Mirrors the delivery reality rather than the intent: email and chat land in an
 * app that a night-mode phone will not ring for, so a P1 whose only channels are
 * these is deliverable but not wake-able. The policy editor says so out loud
 * instead of letting a team discover it at 3 a.m.
 */
export const CHANNEL_WAKES: Record<Channel, boolean> = {
  email: false,
  chat: false,
  webhook: false,
  in_app: false,
  push: true,
  sms: true,
  voice: true,
};

export function stateTagVariant(state: ResponseState): BadgeVariant {
  switch (state) {
    case "triggered":
      return "error-soft";
    case "triaged":
      return "amber-soft";
    case "acknowledged":
      return "blue-soft";
    case "resolved":
      return "success-soft";
    default:
      return "default-soft";
  }
}

/**
 * Collapse repeated firings of the same subject into one row.
 *
 * A rule that fires every minute produces one record per firing — that is the
 * model, and it is right, because each firing has its own timeline and its own
 * cause. It is not a triage surface. Ninety-five identical rows say exactly as
 * much as one row saying ninety-five.
 *
 * Input order is preserved for the groups themselves, so whatever the caller
 * sorted by still decides which alert is at the top.
 */
export function groupBySubject(rows: OnCallResponse[]): OnCallResponseGroup[] {
  const bySubject = new Map<string, OnCallResponse[]>();
  for (const row of rows) {
    const key = `${row.subject.subject_type}:${row.subject.source_id}`;
    const bucket = bySubject.get(key);
    if (bucket) bucket.push(row);
    else bySubject.set(key, [row]);
  }
  return [...bySubject.values()].map((firings) => {
    const sorted = [...firings].sort((a, b) => b.opened_at - a.opened_at);
    return {
      latest: sorted[0],
      firings: sorted,
      escalating: sorted.filter((r) => isEscalating(r.state)),
    };
  });
}

/** The ladder is still climbing. Acknowledged is NOT escalating. */
export function isEscalating(state: ResponseState): boolean {
  return state === "triggered" || state === "triaged";
}

/**
 * Still somebody's problem — what the action buttons ask.
 *
 * Acknowledged belongs here: it has an owner and no ladder, and a human still
 * has to close it. Treating it as closed is how a page gets acknowledged into
 * a void with no way to resolve it.
 */
export function isUnresolved(state: ResponseState): boolean {
  return state !== "resolved";
}

/**
 * Whether paging is currently suppressed.
 *
 * Time-bounded on purpose: a lapsed snooze is not a state. Once it passes the
 * ladder is running again, and showing the record as quiet would be a lie.
 */
export function isSnoozed(
  record: { snoozed_until?: number | null },
  nowMicros: number = Date.now() * 1000,
): boolean {
  return !!record.snoozed_until && record.snoozed_until > nowMicros;
}

/**
 * What a target reads as in the policy editor and on a page.
 *
 * Mirrors `EscalationTarget::describe` so the same rung says the same thing
 * on screen and in the email — which is the whole point of naming the rotation
 * rather than a role word. `rotationName` resolves the stored id; `null` means
 * the team has deleted that rotation, which is worth saying rather than hiding
 * behind an id nobody can look up.
 */
export function describeTarget(
  target: EscalationTarget,
  t: (k: I18nKey, params?: Record<string, unknown>) => string,
  rotationName?: string | null,
): string {
  if (target.kind === "user") return target.email;
  if (target.kind === "whole_team") return t("oncall.target_whole_team");
  if (!rotationName) return t("oncall.target_rotation_deleted");
  return target.mode === "all"
    ? t("oncall.target_rotation_all", { rotation: rotationName })
    : t("oncall.target_rotation_on_call", { rotation: rotationName });
}

/**
 * The zones this runtime can actually resolve, UTC first.
 *
 * `Intl.supportedValuesOf("timeZone")` returns the canonical IANA list, which
 * **excludes `UTC`, `GMT` and all of `Etc/*`** — 418 zones and not the one an
 * on-call team is most likely to want. Every engine resolves `UTC` perfectly
 * well; it is simply not a canonical zone name, so it was never offered and a
 * UTC team could not be created at all.
 *
 * `preferred` is put in the list if it is missing, so a select never holds a
 * value that is not one of its own options — which reads as chosen and submits
 * as nothing.
 */
export function resolvableTimezones(preferred?: string): string[] {
  const canonical =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const wanted = ["UTC", ...canonical, ...(preferred ? [preferred] : [])];
  const seen = new Set<string>();
  return wanted.filter((zone) => {
    if (!zone || seen.has(zone)) return false;
    seen.add(zone);
    // Offering a zone the runtime cannot format would turn an absent option
    // into a save error, which is the failure this list exists to avoid.
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * A target the engine already rendered, said in the product's one vocabulary.
 *
 * The read-only ladder printed `describe()`'s output and the editor printed
 * i18n for the same enum, one click apart, so a rung read as two concepts.
 * They are now the same words — the engine's, which `26111bd135` settled: the
 * ladder owns "secondary", the calendar owns "next".
 *
 * This still earns its place, because an engine older than this bundle emits
 * the retired phrasing, and a mixed-version deployment would put both on the
 * same tab all over again. The set is closed, so it maps cleanly; an email or
 * a phrasing added later is returned untouched rather than guessed at.
 */
export function speakTarget(
  rendered: string,
  t: (k: I18nKey, params?: Record<string, unknown>) => string,
): string {
  const said = rendered.trim();
  const fixed: Record<string, I18nKey> = {
    "the whole team": "oncall.target_whole_team",
    "a rotation that no longer exists": "oncall.target_rotation_deleted",
    // Retired with the slot model; still on the wire from an older engine, and
    // a mixed-version deployment would otherwise put two vocabularies on one
    // tab. None of them can be said any more precisely than "the on-call",
    // because the derivation they named no longer exists to point at.
    "the on-call": "oncall.target_rotation_legacy",
    "the secondary": "oncall.target_rotation_legacy",
    "the next on-call": "oncall.target_rotation_legacy",
    "everyone on the rotation": "oncall.target_rotation_legacy",
  };
  const exact = fixed[said.toLowerCase()];
  if (exact) return t(exact);

  const named: [RegExp, I18nKey][] = [
    [/^whoever is on call in (.+)$/i, "oncall.target_rotation_on_call"],
    [/^everyone on (.+)$/i, "oncall.target_rotation_all"],
  ];
  for (const [pattern, key] of named) {
    const match = said.match(pattern);
    if (match) return t(key, { rotation: match[1] });
  }
  return rendered;
}

/**
 * The same substitution inside a sentence the engine wrote.
 *
 * `config-risks` quotes the term in backticks, which renders as an identifier
 * the reader is expected to already know. Unquoting it and saying it the way
 * the rest of the product does is the difference between a finding and a
 * riddle.
 */
export function speakTargetsInSentence(
  sentence: string,
  t: (k: I18nKey, params?: Record<string, unknown>) => string,
): string {
  return sentence.replace(/`([^`]+)`/g, (whole, term: string) => {
    const said = speakTarget(term, t);
    return said === term ? whole : said;
  });
}

/**
 * A page-cannot-land reason, short enough to be a badge.
 *
 * `reachability.rs` writes one finished sentence per cause, and a sentence on a
 * rail is a paragraph nobody reads at 3am. Each known cause gets four words;
 * the sentence itself stays on hover, and an unknown one returns `null` so the
 * caller falls back to it rather than to a short word that might be wrong.
 *
 * "email only" is not a flourish: email is the single channel this build can
 * deliver on, so when it is the deployment that cannot send, saying so is the
 * whole finding.
 */
export function shortReachReason(
  sentence: string | null | undefined,
  t: TranslateFn,
): I18nText | null {
  const said = (sentence ?? "").toLowerCase();
  if (!said) return null;
  // Matched on the distinctive noun, not the whole sentence: the engine has
  // reworded these before, and a near-miss must degrade to the sentence rather
  // than to silence.
  if (said.includes("smtp")) return t("oncall.reachShortNoSmtp");
  if (said.includes("not a user of this organization")) return t("oncall.reachShortNoAddress");
  if (said.includes("login, not a mailbox")) return t("oncall.reachShortNotMailbox");
  if (said.includes("reserved for documentation")) return t("oncall.reachShortUnroutable");
  return null;
}

/**
 * What is wrong with one rung, as a badge and the sentence behind it.
 *
 * Shared by the pulse strip and the escalation rail, which were drifting: the
 * same rung read as an icon on one screen and a paragraph on the other. A
 * single unreachable person gets the server's reason; a crowd gets the count,
 * because the reason for one of six says nothing about the other five.
 */
export function rungProblem(
  rung: PreviewRung,
  t: TranslateFn,
): { label: I18nText; tip: I18nText | null } | null {
  if (rung.resolves_to_nobody) return { label: t("oncall.ladderReachesNobody"), tip: null };

  const people = rung.recipients;
  const unreachable = people.filter((one) => !one.would_a_page_land);
  if (!unreachable.length) return null;
  if (people.length > 1) {
    return {
      label: t("oncall.ladderUnreachableCount", { count: unreachable.length, total: people.length }),
      tip: null,
    };
  }

  const why = unreachable[0].why_not;
  const short = shortReachReason(why, t);
  // Nothing is hidden: the badge is the summary, the sentence is the answer.
  if (short) return { label: short, tip: raw(why) };
  return { label: raw(why) || t("oncall.contactNoChannel"), tip: null };
}

/**
 * Whether a page would reach anybody at all.
 *
 * The only coverage question left. There used to be six slots to leave empty,
 * so a correctly configured team warned about four of them forever.
 *
 * True when **any** rotation is staffed: a team whose secondary has a gap is
 * still reachable, and reporting it as unstaffed would cry wolf on every
 * restricted rotation outside its hours.
 */
export function isStaffed(
  rotations: Rotation[],
  atMicros: number,
  timezone: string,
): boolean {
  return rotations.some((rotation) => resolveHolder(rotation, atMicros, timezone).member !== null);
}

/**
 * Normalise a dimension value the way the server does.
 *
 * `SemanticLookup::extract_dimensions` lowercases and trims every value it
 * pulls off a record, and the server normalises rules identically at write
 * time. Doing it in the UI too means the chip a user reads back is the rule
 * that will actually match, rather than a value that silently changes on save.
 */
export function normalizeDimensionValue(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Canonical `k=v/k=v`, sorted by dimension name.
 *
 * Mirrors `OwnershipRule::path` — the same form the unique index dedupes on,
 * so what the UI shows is what the server stores.
 */
export function ownershipPath(dimensions: Record<string, string>): string {
  return Object.keys(dimensions ?? {})
    .sort()
    .map((name) => `${name}=${dimensions[name]}`)
    .join("/");
}

/**
 * Orders rules the way the engine consults them — most specific first.
 *
 * Mirrors `resolve_owner`'s comparator in `config::meta::oncall::routing`,
 * term for term:
 *
 *   1. depth — how many dimensions the rule pins
 *   2. exactness — at equal depth, a literal beats a `*` wildcard
 *   3. literal characters — the longer pinned prefix wins
 *   4. the path itself, ascending, so the order is stable
 *
 * Worth stating why this is duplicated rather than asked for: the endpoint
 * returns rules in storage order, and every term here is a pure function of
 * the rule's own dimensions — no roster, no traffic, nothing this side cannot
 * see. Precedence that actually BIT somebody is still the server's to report
 * (`shadowed_by`, and the simulator's `lost_because`); this only decides which
 * row is drawn first.
 *
 * Sorting on the rendered path instead would be wrong in a way that looks
 * right: `k8s-namespace=payments` is the longer STRING, yet
 * `service=payments-api` outranks it on literal characters.
 */
export function compareRulePrecedence(
  a: { dimensions: Record<string, string> },
  b: { dimensions: Record<string, string> },
): number {
  const depth = Object.keys(b.dimensions ?? {}).length - Object.keys(a.dimensions ?? {}).length;
  if (depth) return depth;

  const exact = exactDimensions(b) - exactDimensions(a);
  if (exact) return exact;

  const literal = literalChars(b) - literalChars(a);
  if (literal) return literal;

  const pathA = ownershipPath(a.dimensions);
  const pathB = ownershipPath(b.dimensions);
  return pathA < pathB ? -1 : pathA > pathB ? 1 : 0;
}

/** Dimensions pinned to a literal value rather than a `*` wildcard. */
function exactDimensions(rule: { dimensions: Record<string, string> }): number {
  return Object.values(rule.dimensions ?? {}).filter((value) => !value.endsWith("*")).length;
}

/** Total literal characters pinned, not counting a wildcard's `*`. */
function literalChars(rule: { dimensions: Record<string, string> }): number {
  return Object.values(rule.dimensions ?? {}).reduce(
    (total, value) => total + value.replace(/\*+$/, "").length,
    0,
  );
}

/**
 * The same pairs, spaced to be read rather than parsed:
 * `service = disputes-api · k8s-namespace = payments-edge`.
 *
 * Distinct from `ownershipPath` on purpose. That one mirrors the server's
 * storage key and must stay character-exact; this one is prose, and the two
 * would drift into each other if a single function tried to be both.
 */
export function dimensionsSentence(dimensions: Record<string, string>): string {
  return Object.keys(dimensions ?? {})
    .sort()
    .map((name) => `${name} = ${dimensions[name]}`)
    .join(" · ");
}

/**
 * Channels a page can actually be delivered on today.
 *
 * The `Channel` type carries every channel the design calls for so the stored
 * shape does not change when providers land, but only Email has a `Notifier`
 * behind it. Offering the others in the UI would let somebody tick SMS and
 * receive nothing, with no error — mirrors `Channel::is_deliverable` on the
 * server. Add to this list only when the provider actually sends.
 */
export const DELIVERABLE_CHANNELS: Channel[] = ["email", "webhook"];

export function isDeliverableChannel(channel: Channel): boolean {
  return DELIVERABLE_CHANNELS.includes(channel);
}

/** Priorities in the order the policy editor shows them. */
export const PRIORITY_ORDER: AlertPriorityValue[] = [1, 2, 3, 4, 5];

/**
 * The L0 block every auto-created policy ships with — mirrors
 * `L0Policy::defaults()` on the server.
 *
 * Used when a stored policy predates L0 and carries none. It lives here rather
 * than inside the editor because the card ABOVE the editor has to summarise the
 * gate before anybody has opened it, and reading "no block" as "off" would
 * describe a team that is in fact gating its P2s.
 */
export function l0Defaults(): L0Policy {
  return {
    mode: { P1: "parallel", P2: "gate", P3: "gate", P4: "only" },
    triage_budget_seconds: 90,
    allow_promotion: true,
    max_promotion_steps: 2,
    allow_downgrade: true,
    allow_suppress: false,
  };
}

// ── Timezone ──────────────────────────────────────────────────────────────
//
// A schedule belongs to a team, and a team has a timezone. Everything below
// resolves wall-clock questions in THAT zone, never the browser's: a team in
// Asia/Kolkata edited from Berlin must see its own 09:00, or the handover it
// saves is 4h30 from the one the form showed.
//
// `toLocaleString()` is deliberately absent from this module — it silently reads
// the browser zone, which is exactly the bug.

/** Intl formatters are expensive to build and are rebuilt on every band. */
const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

/** `en-US` pins the weekday vocabulary this module parses back out. */
const WEEKDAY_TO_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function partsFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = partsFormatterCache.get(timezone);
  if (cached) return cached;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
  } catch {
    // An unknown zone must not take the schedule down. UTC is wrong but
    // legible, and the team's timezone field is validated on save.
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
  }
  partsFormatterCache.set(timezone, fmt);
  return fmt;
}

/** Local wall time at `atMicros`, as minutes past midnight + day (0 = Monday). */
export interface ZonedWallTime {
  minuteOfDay: number;
  /** 0 = Monday … 6 = Sunday, matching `TimeWindow.days` and the Rust engine. */
  dayFromMonday: number;
}

export function wallTimeInZone(atMicros: number, timezone: string): ZonedWallTime | null {
  if (!Number.isFinite(atMicros)) return null;
  const date = new Date(atMicros / 1000);
  if (Number.isNaN(date.getTime())) return null;

  let hour = 0;
  let minute = 0;
  let weekday = "";
  for (const part of partsFormatter(timezone).formatToParts(date)) {
    if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
    else if (part.type === "weekday") weekday = part.value;
  }
  const dayFromMonday = WEEKDAY_TO_INDEX[weekday];
  if (dayFromMonday === undefined) return null;
  // h23 can still surface 24 for midnight in some ICU builds.
  return { minuteOfDay: (hour % 24) * 60 + minute, dayFromMonday };
}

/**
 * Whether `window` covers `atMicros` in `timezone`.
 *
 * Ports `TimeWindow::contains`. Two details carry the whole feature:
 *  • `end_minute` may be LESS than `start_minute`, meaning the window wraps
 *    midnight — a 22:00–06:00 night shift is ONE window, not two.
 *  • the early-morning half of a wrapped window belongs to the PREVIOUS day's
 *    shift, so somebody covering Friday nights is still on at 02:00 on Saturday.
 */
export function windowContains(
  window: TimeWindow,
  atMicros: number,
  timezone: string,
): boolean {
  const wall = wallTimeInZone(atMicros, timezone);
  if (!wall) return false;
  const { minuteOfDay: minute, dayFromMonday: day } = wall;
  const { start_minute: start, end_minute: end, days } = window;

  const inTime =
    start <= end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!inTime) return false;

  const effectiveDay = start > end && minute < end ? (day + 6) % 7 : day;
  return !days?.length || days.includes(effectiveDay);
}

/**
 * Whether `rule` is in force at `atMicros`.
 *
 * Ports `ShiftRule::applies_at`. Windows are ORed: "weekday mornings or weekend
 * afternoons" is two windows and matching either is enough. No windows means
 * always — the catch-all every follow-the-sun setup needs underneath.
 */
export function ruleAppliesAt(rule: ShiftRule, atMicros: number, timezone: string): boolean {
  if (rule.starts_at != null && atMicros < rule.starts_at) return false;
  if (rule.ends_at != null && atMicros >= rule.ends_at) return false;
  const windows = rule.restrictions ?? [];
  return windows.length === 0 || windows.some((w) => windowContains(w, atMicros, timezone));
}

/**
 * Whether a shift rule is usable at all. Ports `ShiftRule::validate`.
 *
 * An invalid rule resolves to NOBODY rather than to `members[0]`, so a broken
 * one shows up as a coverage gap — which is visible — instead of silently
 * paging a person the schedule never selected.
 */
export function isShiftRuleValid(rule: ShiftRule): boolean {
  if (!rule.name?.trim()) return false;
  if (!rule.members?.length) return false;
  if (!rule.shift_micros || rule.shift_micros <= 0) return false;
  if (rule.starts_at != null && rule.ends_at != null && rule.ends_at <= rule.starts_at) {
    return false;
  }
  const seen = new Set<string>();
  for (const member of rule.members) {
    const key = member.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * Whether a rotation is usable at all. Ports `Rotation::validate`.
 *
 * A rotation with no shift rules is the one state that looks configured on a
 * calendar and pages nobody, so it is invalid rather than merely empty.
 */
export function isRotationValid(rotation: Rotation): boolean {
  if (!rotation.id?.trim()) return false;
  if (!rotation.name?.trim()) return false;
  if (!rotation.shift_rules?.length) return false;
  return rotation.shift_rules.every(isShiftRuleValid);
}

/**
 * The shift rule in force inside one rotation at `atMicros`. Ports
 * `winning_rule`.
 *
 * **Selection happens within a rotation, never across them.** Two rotations are
 * two people on call at the same instant; two shift rules are one person across
 * different hours. Reading the old cross-rotation winner as if it were this is
 * what let a restricted rotation silently hand its position to a derived
 * holder at the weekend.
 *
 * Ordering, highest wins: `priority`, then the MORE SPECIFIC rule (one with
 * restrictions beats the catch-all, so a catch-all never shadows a layer
 * somebody deliberately restricted), then the EARLIER anchor purely so the
 * answer is stable.
 *
 * Rust's `max_by` keeps the LAST of several equal maxima, which is why the
 * comparison below replaces on `>= 0` rather than `> 0`.
 */
export function winningRule(
  rotation: Rotation,
  atMicros: number,
  timezone: string,
): ShiftRule | null {
  let best: ShiftRule | null = null;
  for (const candidate of rotation.shift_rules ?? []) {
    if (!isShiftRuleValid(candidate)) continue;
    if (!ruleAppliesAt(candidate, atMicros, timezone)) continue;
    if (best === null || compareShiftRules(candidate, best) >= 0) best = candidate;
  }
  return best;
}

/** Negative when `a` loses to `b`. Mirrors the Rust `max_by` comparator. */
function compareShiftRules(a: ShiftRule, b: ShiftRule): number {
  const byPriority = (a.priority ?? 0) - (b.priority ?? 0);
  if (byPriority !== 0) return byPriority;
  const bySpecificity = (a.restrictions?.length ?? 0) - (b.restrictions?.length ?? 0);
  if (bySpecificity !== 0) return bySpecificity;
  // `b.anchor.cmp(a.anchor)` in Rust — the EARLIER anchor is the greater.
  return Math.sign(b.anchor_micros - a.anchor_micros);
}

/**
 * Who one rotation puts on call at `atMicros`, and under which shift rule.
 *
 * Mirrors `Rotation::on_call`. A `null` member is a coverage gap for **that
 * rotation** — the position simply has nobody, and nothing conjures a stand-in.
 */
export function resolveHolder(
  rotation: Rotation,
  atMicros: number,
  timezone: string,
): { member: string | null; rule: ShiftRule | null } {
  const rule = winningRule(rotation, atMicros, timezone);
  if (!rule) return { member: null, rule: null };
  return { member: memberAt(rule, atMicros), rule };
}

/**
 * Every rotation's holder at `atMicros`, in the shape `GET .../on-call` returns.
 *
 * **A rotation that resolves to nobody is omitted**, exactly as the endpoint
 * omits it. Prefer the endpoint where one is available; this exists so a form
 * can preview a schedule it has not saved yet.
 */
export function resolvePositions(
  rotations: readonly Rotation[],
  atMicros: number,
  timezone: string,
): OnCallPosition[] {
  const out: OnCallPosition[] = [];
  for (const rotation of rotations ?? []) {
    const { member, rule } = resolveHolder(rotation, atMicros, timezone);
    if (!member || !rule) continue;
    out.push({
      rotation_id: rotation.id,
      rotation_name: rotation.name,
      rule: rule.name,
      user_email: member,
      next_user_email: resolveNextHolder(rotation, atMicros, timezone),
    });
  }
  return out;
}

/**
 * The person this rotation hands over to next, or `null`.
 *
 * **Display only** — the calendar's "up next". Nothing pages it, and it must
 * never be rendered as a position: it used to double as the secondary, which is
 * exactly how one team got two different people both correctly labelled "the
 * secondary".
 *
 * `null` for a single-member rule: there is no next, and returning the same
 * person would page them twice and call the second one an escalation.
 */
export function resolveNextHolder(
  rotation: Rotation,
  atMicros: number,
  timezone: string,
): string | null {
  const rule = winningRule(rotation, atMicros, timezone);
  if (!rule || rule.members.length < 2) return null;
  const { members, shift_micros: shift, anchor_micros: anchor } = rule;
  const index = Math.floor((atMicros - anchor) / shift) + 1;
  const wrapped = ((index % members.length) + members.length) % members.length;
  return members[wrapped] ?? null;
}

/**
 * An instant rendered in the SCHEDULE's timezone, not the browser's.
 *
 * The single seam every on-call date/time string goes through. `undefined`
 * locale keeps the visitor's own date order and separators; only the zone is
 * pinned. An unreadable instant renders `—` rather than "Invalid Date".
 */
export function formatInZone(
  micros: number,
  timezone: string,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
  locale?: string,
): string {
  if (!Number.isFinite(micros)) return "—";
  const date = new Date(micros / 1000);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(date);
  }
}

/** Minutes in a day — the exclusive upper bound `end_minute` allows. */
export const MINUTES_PER_DAY = 1440;

/**
 * `HH:MM` from minutes past local midnight — the form the day chips edit.
 *
 * `MINUTES_PER_DAY` (1440) is the exclusive end-of-day bound, not a wrap to
 * the next midnight, so it reads "24:00" rather than collapsing to "00:00" —
 * the collapse is what made a window ending at end-of-day indistinguishable
 * from one that wraps past midnight (`end_minute: 0`).
 */
export function formatMinuteOfDay(minute: number): string {
  const truncated = Math.trunc(minute);
  if (truncated === MINUTES_PER_DAY) return "24:00";
  const safe = ((truncated % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hh = String(Math.floor(safe / 60)).padStart(2, "0");
  const mm = String(safe % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

const DAY_KEYS: I18nKey[] = [
  "oncall.day_mon",
  "oncall.day_tue",
  "oncall.day_wed",
  "oncall.day_thu",
  "oncall.day_fri",
  "oncall.day_sat",
  "oncall.day_sun",
];

/** Days as "every day", a contiguous range ("Mon–Fri"), or a list. */
function describeDays(days: number[] | undefined, t: TranslateFn): string {
  const unique = [...new Set((days ?? []).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (unique.length === 0 || unique.length === 7) return t("oncall.restrictionEveryDay");
  const isContiguous = unique.every((d, i) => i === 0 || d === unique[i - 1] + 1);
  if (isContiguous && unique.length > 2) {
    return t("oncall.restrictionDayRange", {
      from: t(DAY_KEYS[unique[0]]),
      to: t(DAY_KEYS[unique[unique.length - 1]]),
    });
  }
  return unique.map((d) => t(DAY_KEYS[d])).join(", ");
}

/**
 * Restriction windows as the plain English the "When" column shows.
 *
 * An unrestricted rotation reads "the rest of the time" rather than "always":
 * it is the fallback UNDER the restricted layers, and calling it "always" is
 * how somebody concludes the layers above it never fire.
 */
export function describeRestrictions(
  windows: TimeWindow[] | undefined,
  t: TranslateFn,
): I18nText {
  const list = windows ?? [];
  if (list.length === 0) return t("oncall.restrictionAlways");
  const described = list
    .map((w) => {
      const days = describeDays(w.days, t);
      // 0 -> 1440 is the whole day, not a window "from 00:00 to 00:00" — that
      // reading collapses to zero length and hides that the layer covers
      // everything.
      if (w.start_minute === 0 && w.end_minute === MINUTES_PER_DAY) {
        return t("oncall.restrictionWindowAllDay", { days });
      }
      return t("oncall.restrictionWindow", {
        days,
        from: formatMinuteOfDay(w.start_minute),
        to: formatMinuteOfDay(w.end_minute),
      });
    })
    .join(" · ");
  // Every fragment above is already translated; this last call is the seam a
  // translator uses to reorder or re-punctuate the list.
  return t("oncall.restrictionList", { windows: described });
}

/**
 * A ledger row's outcome.
 *
 * `delivered: false` is a RECORDED failure — the honest answer to "did the page
 * reach them" — and is not the same as the field being absent, which only means
 * the transport never reported either way.
 */
export function deliveryStatus(record: Pick<DeliveryRecord, "delivered">): DeliveryStatus {
  if (record.delivered === true) return "delivered";
  if (record.delivered === false) return "failed";
  return "sent";
}

/**
 * The engine's routing sentence for a record, or null.
 *
 * The decision is recorded as a plain `sys` event with no marker distinguishing
 * it from the `opened for …` line written beside it at the same instant, so the
 * only way to tell them apart is the wording the server produces. That is
 * fragile by nature, which is exactly why it is isolated here and matched
 * against every branch of `RoutingDecision::reason()` rather than inline in a
 * template. If the wording drifts we return null and the page simply omits the
 * row — the Activity tab still carries the event verbatim.
 *
 * The durable fix is a typed routing event (or a decision field on the
 * response); this function is what gets deleted when that lands.
 */
const ROUTING_REASON_PREFIXES = ["routed to ", "no ownership rule"] as const;

export function routingReasonOf(
  events: Pick<OnCallResponseEvent, "kind" | "body">[],
): string | null {
  const hit = events.find(
    (e) =>
      e.kind === "sys" &&
      ROUTING_REASON_PREFIXES.some(
        // Not `startsWith`: `RoutingDecision::reason` prefixes the sentence
        // with every note routing passed over ("the alert names team `x`,
        // which names no team in this org; routed to …"), and anchoring at
        // the start dropped the row on exactly the records whose routing was
        // worth explaining.
        (prefix) => e.body.startsWith(prefix) || e.body.includes(`; ${prefix}`),
      ),
  );
  return hit ? hit.body : null;
}

/** Which of `RoutingDecision`'s five branches produced a sentence. */
export type RoutingMechanism = "explicit" | "context" | "ownership" | "default" | "unrouted";

/** A routing sentence read back into the parts a screen can render. */
export interface RoutingReasonView {
  /** What routing considered and passed over, in the order it says them. */
  notes: string[];
  mechanism: RoutingMechanism;
  /** The winning ownership rule's dimensions — chips, not a path. */
  dimensions: Record<string, string>;
  /** The team the sentence names, when it names one. */
  teamId: string | null;
  /** The team NAME the alert's context attribute asked for (`context` only). */
  namedTeam: string | null;
}

/**
 * The routing sentence, read back into its parts.
 *
 * Same bargain as `routingReasonOf` above — matched against every branch of
 * `RoutingDecision::reason()`, and null the moment the wording drifts, so the
 * caller falls back to printing the server's sentence verbatim rather than
 * showing a half-parsed one. Deleted with `routingReasonOf` when a typed
 * routing event lands.
 */
export function parseRoutingReason(reason: string | null | undefined): RoutingReasonView | null {
  if (!reason) return null;

  // Notes are joined with "; " ahead of the decision, so the decision is the
  // last segment and everything before it is what was passed over.
  const segments = reason.split("; ");
  const decision = segments[segments.length - 1]?.trim() ?? "";
  const notes = segments.slice(0, -1).map((note) => note.trim());
  const view = (
    mechanism: RoutingMechanism,
    rest: Partial<RoutingReasonView> = {},
  ): RoutingReasonView => ({
    notes,
    mechanism,
    dimensions: {},
    teamId: null,
    namedTeam: null,
    ...rest,
  });

  const ownership = /^routed to (\S+) by ownership rule (.+)$/.exec(decision);
  if (ownership) {
    return view("ownership", {
      teamId: ownership[1],
      dimensions: dimensionsOfPath(ownership[2]),
    });
  }

  const explicit = /^routed to (\S+) by the alert's own setting$/.exec(decision);
  if (explicit) return view("explicit", { teamId: explicit[1] });

  const context = /^routed to (\S+) by the alert's context attribute team=`(.*)`$/.exec(decision);
  if (context) return view("context", { teamId: context[1], namedTeam: context[2] });

  const fallback = /^no ownership rule matched, so it went to the default team (\S+)$/.exec(
    decision,
  );
  if (fallback) return view("default", { teamId: fallback[1] });

  if (decision.startsWith("no ownership rule matches this signal and no default team is set")) {
    return view("unrouted");
  }

  return null;
}

/**
 * `k=v/k=v` back into the map it was built from — the inverse of
 * `ownershipPath`, so the About rail can draw the same dimension chips the
 * routing tab draws from a rule's own `dimensions`.
 *
 * A value may itself contain `=`; only the FIRST one separates.
 */
export function dimensionsOfPath(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const segment of path.split("/")) {
    const at = segment.indexOf("=");
    if (at <= 0) continue;
    out[segment.slice(0, at).trim()] = segment.slice(at + 1).trim();
  }
  return out;
}

/// One rung of a ladder with its targets resolved to actual people.
export interface ResolvedRung {
  afterMicros: number;
  /** Named people this rung reaches, in the order the policy lists them. */
  people: string[];
  /** The rung names the whole team, which is a group rather than a list. */
  wholeTeam: boolean;
  /** Rotations the rung pages EVERYONE on, by name — groups, like wholeTeam,
   *  not lists. The client only knows who is on shift, not a rotation's full
   *  roster across all its shift rules. */
  pools: string[];
  /** Rotations this rung names that the team no longer has, by id. Each one is
   *  a level that pages nobody, which the ladder skips in silence — surface it
   *  rather than resolving to an empty rung that looks merely uncovered. */
  missingRotations: string[];
}

/**
 * What a priority's ladder would actually do, against the rotations in force.
 *
 * The editor lets somebody build a ladder out of targets, which is not the
 * question they have — that is "who does this wake, and when". A target that
 * resolves to nobody (a rotation with a coverage gap) is the failure worth
 * seeing before it is saved, so it resolves to an empty `people` rather than
 * being dropped.
 *
 * `positions` is `GET .../on-call`. A rotation that resolves to nobody is
 * **absent** from it, so a target naming a rotation that is present in the
 * team's schedule but missing here is a gap — while one naming an id the
 * schedule has never heard of is a dangling level, reported separately.
 */
export function resolveLadder(
  rung: PriorityRung,
  positions: OnCallPosition[],
  rotations: readonly Rotation[] = [],
): ResolvedRung[] {
  const byId = new Map(positions.map((p) => [p.rotation_id, p]));
  const known = new Map(rotations.map((r) => [r.id, r]));

  return [...rung.steps]
    .sort((a, b) => a.after_micros - b.after_micros)
    .map((step) => {
      const people: string[] = [];
      const pools: string[] = [];
      const missingRotations: string[] = [];
      let wholeTeam = false;
      // Tolerates a step with no targets: this runs during render, so a
      // malformed rung must read as "reaches nobody" rather than take the
      // whole policy editor down.
      for (const target of step.targets ?? []) {
        switch (target.kind) {
          case "rotation": {
            const rotation = known.get(target.rotation_id);
            if (rotations.length && !rotation) {
              missingRotations.push(target.rotation_id);
              break;
            }
            // A rotation's full roster is not knowable from who is on shift —
            // several shift rules may staff it at other hours — so `all`
            // renders as a group. Mislabelling it with one name would read as
            // "pages one person".
            if (target.mode === "all") {
              pools.push(rotation?.name ?? target.rotation_id);
              break;
            }
            const holder = byId.get(target.rotation_id)?.user_email;
            if (holder) people.push(holder);
            break;
          }
          case "user":
            people.push(target.email);
            break;
          case "whole_team":
            wholeTeam = true;
            break;
        }
      }
      return {
        afterMicros: step.after_micros,
        // Paging one person twice for one rung is noise, not urgency — the
        // engine deduplicates too.
        people: [...new Set(people)],
        wholeTeam,
        pools: [...new Set(pools)],
        missingRotations: [...new Set(missingRotations)],
      };
    });
}

/**
 * The dimensions an ownership rule is worth writing against.
 *
 * The server accepts any dimension, so this is a product judgement, not a wire
 * fact. The test for membership: does the value survive a pod restart and a
 * redeploy? `service` does; `k8s-pod-name` names one incarnation of one
 * process, so a rule against it matches until the next restart and then
 * nothing, forever. Evidence stays on the signal; identity goes in the rule.
 */
/// The canonical service dimension, matching the backend's `SERVICE_DIMENSION`.
/// A claim on a service with no infrastructure identity falls back to this.
export const SERVICE_DIMENSION = "service";

export const IDENTITY_DIMENSION_IDS = new Set([
  SERVICE_DIMENSION,
  "service-namespace",
  "k8s-cluster",
  "k8s-namespace",
  "k8s-deployment",
  "k8s-statefulset",
  "k8s-daemonset",
  "k8s-replicaset",
  "k8s-job",
  "k8s-container-name",
  "host",
  "environment",
  "region",
  "availability-zone",
  "cloud-provider",
  "cloud-platform",
  "cloud-account",
  "aws-ecs-cluster",
  "faas-name",
  "gcp-cloud-run",
  "azure-resource-group",
  "azure-cloud-role",
  "db-system",
  "db-name",
]);

/**
 * Would a rule pinning these dimensions claim a signal carrying those?
 *
 * Mirrors the engine's match, not its precedence: every pinned dimension has to
 * be present and equal, and a `*`-suffixed value matches by prefix. Used to
 * replay a draft rule against the unrouted queue before it is saved.
 */
export function ruleClaimsDimensions(
  ruleDimensions: Record<string, string>,
  signalDimensions: Record<string, string>,
): boolean {
  const pinned = Object.entries(ruleDimensions ?? {});
  if (!pinned.length) return false;
  return pinned.every(([name, value]) => {
    const actual = (signalDimensions ?? {})[name];
    if (actual === undefined) return false;
    return value.endsWith("*") ? actual.startsWith(value.slice(0, -1)) : actual === value;
  });
}

/** The subset of a signal's dimensions a rule should be written against. */
export function identityDimensions(dimensions: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dimensions).filter(([name]) => IDENTITY_DIMENSION_IDS.has(name)),
  );
}

/**
 * The severity a promotion derives when the caller sends none — the record's
 * own priority, with P5 folded into P4 because the incident scale has no P5.
 */
export function promoteSeverityFloor(priority: number): PromoteSeverity {
  switch (priority) {
    case 1:
      return "P1";
    case 2:
      return "P2";
    case 3:
      return "P3";
    default:
      return "P4";
  }
}

/**
 * The severities a promotion may be *offered*. "A promotion may raise the
 * severity but must never lower what already woke somebody" is stated as an
 * invariant and enforced nowhere — the handler takes whatever string it is
 * sent — so the picker is where it holds: a P2 page offers P1 and P2, never
 * P3. Ranked most severe first, which is also how the incident screens order.
 */
export function promoteSeverityOptions(priority: number): PromoteSeverity[] {
  const floor = promoteSeverityFloor(priority);
  return PROMOTE_SEVERITIES.slice(0, PROMOTE_SEVERITIES.indexOf(floor) + 1);
}

/**
 * §G.8.1/§H.0: there is no capability endpoint — a view's entry fetch IS the
 * probe. A bare 404 means `O2_ONCALL_ENABLED` is off and the routes were never
 * registered; a 403 whose message is "Not Supported" means an OSS build. Both
 * read as "on-call is not available here", and the difference is deliberately
 * never surfaced to the user.
 *
 * Apply to a view's ENTRY fetch only. A 404 on a resource GET is a missing
 * record, and a 403 "Forbidden" is a permission denial — both real errors that
 * must keep rendering as errors.
 */
export function isOnCallUnavailable(err: unknown): boolean {
  const response = (err as { response?: { status?: number; data?: { message?: string } } })
    ?.response;
  if (!response) return false;
  if (response.status === 404) return true;
  return response.status === 403 && /not supported/i.test(response.data?.message ?? "");
}

/// ── `datetime-local` in somebody else's timezone ──────────────────────────
///
/// A `<input type="datetime-local">` has no zone: it reads and writes bare
/// wall time, and the browser's own zone is the only one the platform will
/// apply. Every on-call instant belongs to the TEAM's zone instead — that is
/// what "handover at 10:00" means, and the fields say so on their labels.
///
/// Rendering `new Date(micros).getHours()` and parsing with `Date.parse()`
/// therefore answered in the reader's zone while the label promised the
/// team's. An operator in Berlin editing an Asia/Kolkata team read a handover
/// three and a half hours from where it was, and moved it there by saving.

/** How far `timezone` is from UTC at this instant, in ms. DST-correct. */
function zoneOffsetMs(utcMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // `hour12: false` reports midnight as 24 in some engines.
  const asIfUtc = Date.UTC(
    at("year"),
    at("month") - 1,
    at("day"),
    at("hour") % 24,
    at("minute"),
    at("second"),
  );
  return asIfUtc - utcMs;
}

/** An instant as the `YYYY-MM-DDTHH:mm` a `datetime-local` shows, in `timezone`. */
export function toZonedInputValue(micros: number, timezone: string): string {
  if (!Number.isFinite(micros)) return "";
  const ms = Math.trunc(micros / 1000);
  try {
    const local = new Date(ms + zoneOffsetMs(ms, timezone));
    return local.toISOString().slice(0, 16);
  } catch {
    return new Date(ms).toISOString().slice(0, 16);
  }
}

/**
 * The instant a `datetime-local` value names **in `timezone`**, in micros.
 * `null` when the value is not a complete wall time — which is most of what a
 * half-typed field holds, and keeping the previous instant beats writing NaN.
 *
 * Resolved twice because the offset depends on the answer: a wall time an hour
 * either side of a DST boundary is read with the wrong offset on the first
 * pass. The second pass uses the offset in force at the instant the first one
 * produced. Where a wall time does not exist at all (the hour a spring-forward
 * skips) this lands on the instant the clock jumps to, which is the same
 * choice the platform makes.
 */
export function fromZonedInputValue(value: string, timezone: string): number | null {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!parsed) return null;
  const [, y, mo, d, h, mi] = parsed.map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(asIfUtc)) return null;
  try {
    const first = asIfUtc - zoneOffsetMs(asIfUtc, timezone);
    const second = asIfUtc - zoneOffsetMs(first, timezone);
    return second * 1000;
  } catch {
    return asIfUtc * 1000;
  }
}

/**
 * The activity feed's default view: what a person did, and what the ladder
 * did that changed who got woken. Engine bookkeeping (`sys`, `state`,
 * `delivery`, `exhausted`) is folded away behind "Show all" — shared by
 * OnCallActivityTimeline (which filters by it) and the page header (which
 * counts what it hides).
 */
export const DEFAULT_ACTIVITY_KINDS: ResponseEventKind[] = [
  "note",
  "ack",
  "handoff",
  "page",
  "rca",
  "ai_verdict",
  "severity_promoted",
  "flapped",
];
