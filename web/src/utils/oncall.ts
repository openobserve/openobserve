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
  ResponseState,
  Rotation,
  TimeWindow,
  OnCallResponse,
  OnCallResponseEvent,
  OnCallResponseGroup,
  OnCallSlot,
  PriorityRung,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_HOUR, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { RowRailTone } from "@/lib/core/Table/OTable.types";
import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";

/**
 * Who holds `rotation` at `atMicros`.
 *
 * Mirrors `Rotation::member_at`: floor division so instants before the anchor
 * resolve backwards instead of collapsing onto shift 0, and an exclusive upper
 * bound so the handover instant belongs to the incoming person. Returning
 * `null` for an unusable rotation is deliberate — an unstaffed level has to
 * read as a coverage gap, never as a silently chosen fallback.
 */
export function memberAt(rotation: Rotation, atMicros: number): string | null {
  const { members, shift_micros: shift, anchor_micros: anchor } = rotation;
  if (!members?.length || !shift || shift <= 0) return null;
  const index = Math.floor((atMicros - anchor) / shift);
  // JS `%` keeps the sign of the dividend, so a pre-anchor index needs the
  // extra wrap; without it, index -1 of a 3-person rotation yields -1.
  const wrapped = ((index % members.length) + members.length) % members.length;
  return members[wrapped] ?? null;
}

/** Instant the shift containing `atMicros` ends, i.e. the next handover. */
export function nextHandover(rotation: Rotation, atMicros: number): number | null {
  const { shift_micros: shift, anchor_micros: anchor } = rotation;
  if (!rotation.members?.length || !shift || shift <= 0) return null;
  return anchor + (Math.floor((atMicros - anchor) / shift) + 1) * shift;
}

/** One person's turn: when it starts, when it ends, and whose it is. */
export interface Shift {
  startMicros: number;
  endMicros: number;
  member: string;
}

/**
 * The next `count` shifts of a rotation, starting with the one containing
 * `fromMicros`.
 *
 * A schedule is only comprehensible when you can see who it puts on call, so
 * this exists to render the answer rather than the configuration. Pure, so the
 * boundary arithmetic is testable without mounting anything.
 */
export function upcomingShifts(
  rotation: Rotation,
  fromMicros: number,
  count: number,
): Shift[] {
  const { shift_micros: shift, anchor_micros: anchor, members } = rotation;
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
    });
  }
  return shifts;
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
 * Shifts of one rotation, clipped to a visible window.
 *
 * Clipped rather than whole so a band never runs past the edge of the chart:
 * a week view of a fortnightly rotation would otherwise draw one band four
 * times too wide and push everything else off screen.
 */
export function shiftBands(
  rotation: Rotation,
  windowStart: number,
  windowEnd: number,
): CalendarBand[] {
  const { shift_micros: shift, anchor_micros: anchor, members } = rotation;
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
      user_email: memberAt(rotation, start) ?? "",
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
 * on screen and in the email.
 */
export function describeTarget(target: EscalationTarget, t: (k: I18nKey) => string): string {
  return target.kind === "user" ? target.email : t(`oncall.target_${target.kind}`);
}

/**
 * Whether a page would reach anybody at all.
 *
 * The only coverage question left. There used to be six slots to leave empty,
 * so a correctly configured team warned about four of them forever.
 */
export function isStaffed(rotations: Rotation[], atMicros: number): boolean {
  return rotations.some((r) => memberAt(r, atMicros) !== null);
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
 * Whether `rotation` is in force at `atMicros`.
 *
 * Ports `Rotation::applies_at`. Windows are ORed: "weekday mornings or weekend
 * afternoons" is two windows and matching either is enough. No windows means
 * always — the catch-all every follow-the-sun setup needs underneath.
 */
export function rotationAppliesAt(
  rotation: Rotation,
  atMicros: number,
  timezone: string,
): boolean {
  const windows = rotation.restrictions ?? [];
  return windows.length === 0 || windows.some((w) => windowContains(w, atMicros, timezone));
}

/**
 * Whether a rotation is usable at all. Ports `Rotation::validate`.
 *
 * An invalid rotation resolves to NOBODY rather than to `members[0]`, so a
 * broken one shows up as a coverage gap — which is visible — instead of
 * silently paging a person the schedule never selected.
 */
export function isRotationValid(rotation: Rotation): boolean {
  if (!rotation.name?.trim()) return false;
  if (!rotation.members?.length) return false;
  if (!rotation.shift_micros || rotation.shift_micros <= 0) return false;
  const seen = new Set<string>();
  for (const member of rotation.members) {
    const key = member.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * The rotation in force at `atMicros`. Ports `winning_rotation`.
 *
 * Ordering, highest wins: `priority`, then the MORE SPECIFIC rotation (one with
 * restrictions beats the catch-all, so a catch-all never shadows a layer
 * somebody deliberately restricted), then the EARLIER anchor purely so the
 * answer is stable — two equally-specific layers is a configuration mistake, but
 * it must still resolve the same way in the UI as on every server node rather
 * than depending on row order.
 *
 * Rust's `max_by` keeps the LAST of several equal maxima, which is why the
 * comparison below replaces on `>= 0` rather than `> 0`.
 */
export function winningRotation(
  rotations: Rotation[],
  atMicros: number,
  timezone: string,
): Rotation | null {
  let best: Rotation | null = null;
  for (const candidate of rotations ?? []) {
    if (!isRotationValid(candidate)) continue;
    if (!rotationAppliesAt(candidate, atMicros, timezone)) continue;
    if (best === null || compareRotations(candidate, best) >= 0) best = candidate;
  }
  return best;
}

/** Negative when `a` loses to `b`. Mirrors the Rust `max_by` comparator. */
function compareRotations(a: Rotation, b: Rotation): number {
  const byPriority = (a.priority ?? 0) - (b.priority ?? 0);
  if (byPriority !== 0) return byPriority;
  const bySpecificity = (a.restrictions?.length ?? 0) - (b.restrictions?.length ?? 0);
  if (bySpecificity !== 0) return bySpecificity;
  // `b.anchor.cmp(a.anchor)` in Rust — the EARLIER anchor is the greater.
  return Math.sign(b.anchor_micros - a.anchor_micros);
}

/**
 * Who is on call at `atMicros`, and under which rotation.
 *
 * Mirrors the engine (`resolve_on_call` / `winning_rotation`): highest priority
 * whose restriction window matches wins, ties break on the more specific
 * rotation. The screen whose entire job is "who gets paged" must not be able to
 * name a different person from the one the server will page — the previous
 * "last rotation in the array wins" was silently wrong for every team with two
 * rotations.
 */
export function resolveHolder(
  rotations: Rotation[],
  atMicros: number,
  timezone: string,
): { member: string | null; rotation: Rotation | null } {
  const rotation = winningRotation(rotations, atMicros, timezone);
  if (!rotation) return { member: null, rotation: null };
  return { member: memberAt(rotation, atMicros), rotation };
}

/**
 * The person the rotation in force hands over to next, or `null`.
 *
 * `null` for a single-member rotation: there is no next, and returning the same
 * person would page them twice and call the second one an escalation.
 */
export function resolveNextHolder(
  rotations: Rotation[],
  atMicros: number,
  timezone: string,
): string | null {
  const rotation = winningRotation(rotations, atMicros, timezone);
  if (!rotation || rotation.members.length < 2) return null;
  const { members, shift_micros: shift, anchor_micros: anchor } = rotation;
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

/** `HH:MM` from minutes past local midnight — the form the day chips edit. */
export function formatMinuteOfDay(minute: number): string {
  const safe = ((Math.trunc(minute) % 1440) + 1440) % 1440;
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
    .map((w) =>
      t("oncall.restrictionWindow", {
        days: describeDays(w.days, t),
        from: formatMinuteOfDay(w.start_minute),
        to: formatMinuteOfDay(w.end_minute),
      }),
    )
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
      ROUTING_REASON_PREFIXES.some((prefix) => e.body.startsWith(prefix)),
  );
  return hit ? hit.body : null;
}

/// One rung of a ladder with its targets resolved to actual people.
export interface ResolvedRung {
  afterMicros: number;
  /** Named people this rung reaches, in the order the policy lists them. */
  people: string[];
  /** The rung names the whole team, which is a group rather than a list. */
  wholeTeam: boolean;
}

/**
 * What a priority's ladder would actually do, against the rotation in force.
 *
 * The editor lets somebody build a ladder out of target KINDS, which is not
 * the question they have — that is "who does this wake, and when". A kind that
 * resolves to nobody (a `next_on_call` on a one-person rotation, an
 * `on_call_now` with a coverage gap) is the failure worth seeing before it is
 * saved, so it resolves to an empty `people` rather than being dropped.
 */
export function resolveLadder(rung: PriorityRung, slots: OnCallSlot[]): ResolvedRung[] {
  const onCall = slots.map((s) => s.user_email).filter(Boolean);
  const next = slots.map((s) => s.next_user_email).filter((e): e is string => !!e);

  return [...rung.steps]
    .sort((a, b) => a.after_micros - b.after_micros)
    .map((step) => {
      const people: string[] = [];
      let wholeTeam = false;
      // Tolerates a step with no targets: this runs during render, so a
      // malformed rung must read as "reaches nobody" rather than take the
      // whole policy editor down.
      for (const target of step.targets ?? []) {
        switch (target.kind) {
          case "on_call_now":
            people.push(...onCall);
            break;
          case "next_on_call":
            people.push(...next);
            break;
          case "everyone_on_schedule":
            people.push(...onCall, ...next);
            break;
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
      };
    });
}
