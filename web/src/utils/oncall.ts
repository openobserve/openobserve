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
  EscalationProgress,
  EscalationTarget,
  L0Policy,
  OnCallPolicy,
  ResponseState,
  ResolvedSegment,
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
  Contact,
  RefusalReason,
  VerificationRefusalBody,
} from "@/ts/interfaces/oncall";
import { PROMOTE_SEVERITIES } from "@/ts/interfaces/oncall";
import {
  MICROS_PER_DAY,
  MICROS_PER_HOUR,
  MICROS_PER_MINUTE,
  MICROS_PER_WEEK,
} from "@/ts/interfaces/oncall";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { RowRailTone } from "@/lib/core/Table/OTable.types";
import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import { raw } from "@/types/i18n";
import { localeFileMap } from "@/locales";
import { formatTimestampInTimezone } from "@/utils/date";

/** Who holds `rule` at `atMicros`, counted in the team's `timezone` like `ShiftRule::member_at`; `null` if unusable. */
export function memberAt(rule: ShiftRule, atMicros: number, timezone: string): string | null {
  if (!isCountable(rule)) return null;
  return memberOfShift(rule, localShiftIndex(rule, atMicros, timezone));
}

/** Instant the shift containing `atMicros` ends, i.e. the next handover; mirrors `ShiftRule::next_handover`. */
export function nextHandover(rule: ShiftRule, atMicros: number, timezone: string): number | null {
  if (!isCountable(rule)) return null;
  return shiftBoundary(rule, localShiftIndex(rule, atMicros, timezone) + 1, timezone);
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
export function upcomingShifts(
  rule: ShiftRule,
  fromMicros: number,
  count: number,
  timezone: string,
): Shift[] {
  if (!isCountable(rule) || count <= 0) return [];
  const firstIndex = localShiftIndex(rule, fromMicros, timezone);
  const shifts: Shift[] = [];
  for (let i = 0; i < count; i++) {
    const index = firstIndex + i;
    const startMicros = shiftBoundary(rule, index, timezone);
    const endMicros = shiftBoundary(rule, index + 1, timezone);
    if (startMicros === null || endMicros === null) break;
    shifts.push({ startMicros, endMicros, member: memberOfShift(rule, index), rule: rule.name });
  }
  return shifts;
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

// `phraseKey` is the whole "Every …" phrase: a split "every" + unit cannot agree in other languages.
export const SHIFT_PRESETS = [
  { micros: 8 * MICROS_PER_HOUR, labelKey: "oncall.shift8h", phraseKey: "oncall.handoverEvery8h" },
  {
    micros: 12 * MICROS_PER_HOUR,
    labelKey: "oncall.shift12h",
    phraseKey: "oncall.handoverEvery12h",
  },
  { micros: MICROS_PER_DAY, labelKey: "oncall.shiftDaily", phraseKey: "oncall.handoverEveryDay" },
  {
    micros: MICROS_PER_WEEK,
    labelKey: "oncall.shiftWeekly",
    phraseKey: "oncall.handoverEveryWeek",
  },
  {
    micros: 2 * MICROS_PER_WEEK,
    labelKey: "oncall.shiftFortnightly",
    phraseKey: "oncall.handoverEvery2Weeks",
  },
] as const satisfies ReadonlyArray<{ micros: number; labelKey: I18nKey; phraseKey: I18nKey }>;

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

/** Whether a channel reaches a locked, silenced phone: texts and calls do; email and webhook land in apps a night-mode phone does not ring for. */
export const CHANNEL_WAKES: Record<Channel, boolean> = {
  email: false,
  sms: true,
  voice: true,
  webhook: false,
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

/** An unanswered page whose ladder ran out reads as nobody answered; the ladder's progress decides when known, the record's lagging flag only without it. [pure] */
export function pageState(
  record: { state: ResponseState; exhausted_at?: number | null },
  progress?: EscalationProgress | null,
): ResponseState | "exhausted" {
  if (!isEscalating(record.state)) return record.state;
  // The server also marks an empty ladder exhausted, and nobody can fail to answer a page that paged nobody.
  const ranOut = progress ? progress.exhausted && progress.fired.length > 0 : !!record.exhausted_at;
  return ranOut ? "exhausted" : record.state;
}

/** A team is deleted only when the page names one and the loaded team list lacks it; a teamless page is unrouted, and an unloaded list proves nothing. [pure] */
export function isDeletedTeam(
  teamId: string | null | undefined,
  knownTeamIds: string[] | null,
): boolean {
  return !!teamId && knownTeamIds !== null && !knownTeamIds.includes(teamId);
}

/** What is happening to a page, as one phrase: the Pages list, Recent pages and the page header all say this. */
export type PagePhrase =
  | { kind: "resolved"; afterMicros: number | null }
  | { kind: "acknowledged"; by: string }
  | { kind: "snoozed"; until: number }
  | { kind: "nobodyAnswered" }
  | { kind: "held"; secondsLeft: number }
  | { kind: "pagesNobody" }
  | { kind: "unknown" }
  | { kind: "notPaged" }
  | { kind: "paging"; step: number; total: number | null; who: string[] }
  | { kind: "reachedNobody"; step: number; total: number | null };

/** Picks the one phrase for a page; `reachedStep` stands in for the progress on a list that does not fetch it. [pure] */
export function pagePhrase(input: {
  record: Pick<
    OnCallResponse,
    | "state"
    | "opened_at"
    | "acked_by"
    | "closed_at"
    | "snoozed_until"
    | "exhausted_at"
    | "reached_rung_micros"
  >;
  progress?: EscalationProgress | null;
  progressLoaded: boolean;
  totalRungs?: number | null;
  reachedStep?: number | null;
  nowMicros: number;
}): PagePhrase {
  const { record, progress, nowMicros } = input;
  if (record.state === "resolved") {
    return {
      kind: "resolved",
      afterMicros: record.closed_at ? record.closed_at - record.opened_at : null,
    };
  }
  if (record.state === "acknowledged") return { kind: "acknowledged", by: record.acked_by ?? "" };
  if (isSnoozed(record, nowMicros))
    return { kind: "snoozed", until: record.snoozed_until as number };
  // Before the exhausted check: the server flags an empty ladder exhausted, and nobody can fail to answer it.
  if (input.totalRungs === 0) return { kind: "pagesNobody" };
  if (pageState(record, progress) === "exhausted") return { kind: "nobodyAnswered" };
  const heldUntil = progress?.held_until_micros;
  if (heldUntil && heldUntil > nowMicros) {
    return { kind: "held", secondsLeft: Math.ceil((heldUntil - nowMicros) / 1_000_000) };
  }
  // Without progress only the record speaks: its matched step, else no claim if it paged or nothing was asked.
  const recordedRung =
    record.reached_rung_micros !== undefined && record.reached_rung_micros !== null;
  if (!progress && !input.reachedStep && (recordedRung || !input.progressLoaded)) {
    return { kind: "unknown" };
  }
  const step = progress ? progress.fired.length : (input.reachedStep ?? 0);
  if (!step) return { kind: "notPaged" };
  const total = input.totalRungs ?? null;
  const last = progress?.fired[progress.fired.length - 1];
  if (last?.reached_nobody) return { kind: "reachedNobody", step, total };
  return { kind: "paging", step, total, who: last?.reached ?? [] };
}

/** The 1-based step whose delay matches a recorded rung, `null` when none was recorded or the ladder no longer has it. [pure] */
export function reachedStepOf(
  steps: { after_micros: number }[] | null | undefined,
  rungMicros: number | null | undefined,
): number | null {
  if (!steps || rungMicros === undefined || rungMicros === null) return null;
  const sorted = [...steps].sort((a, b) => a.after_micros - b.after_micros);
  const index = sorted.findIndex((step) => step.after_micros === rungMicros);
  return index < 0 ? null : index + 1;
}

/** Clock time for today, date and time otherwise, in the given zone: a bare time from yesterday reads as minutes ago. [pure] */
export function formatOnCallInstant(atMicros: number, nowMicros: number, zone: string): string {
  const day = (us: number) => formatTimestampInTimezone(us, "yyyy-MM-dd", zone);
  const format = day(atMicros) === day(nowMicros) ? "HH:mm" : "MMM d, yyyy, HH:mm";
  return formatTimestampInTimezone(atMicros, format, zone);
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
  // A mixed-version deployment or an unmigrated policy can still carry one of
  // the six retired kinds this build no longer types. That is not a deleted
  // rotation — it is a kind this screen was never taught to read.
  if (target.kind !== "rotation") return t("oncall.target_unrecognized");
  if (!rotationName) return t("oncall.target_rotation_deleted");
  return target.mode === "all"
    ? t("oncall.target_rotation_all", { rotation: rotationName })
    : t("oncall.target_rotation_on_call", { rotation: rotationName });
}

// Zones IANA renamed; `Intl.supportedValuesOf` still only surfaces the pre-rename id.
const RENAMED_TIMEZONES = ["Asia/Kolkata", "Asia/Ho_Chi_Minh", "Europe/Kyiv", "America/Nuuk"];

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
  const wanted = ["UTC", ...canonical, ...RENAMED_TIMEZONES, ...(preferred ? [preferred] : [])];
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
      label: t("oncall.ladderUnreachableCount", {
        count: unreachable.length,
        total: people.length,
      }),
      tip: null,
    };
  }

  const why = unreachable[0].why_not;
  const short = shortReachReason(why, t);
  // Nothing is hidden: the badge is the summary, the sentence is the answer.
  if (short) return { label: short, tip: raw(why) };
  return { label: raw(why) || t("oncall.contactNoChannel"), tip: null };
}

/// The order a priority's channels are said in, whatever order they are stored in.
const CHANNEL_ORDER: Channel[] = ["email", "sms", "voice", "webhook"];

/** A priority's channels as one phrase, "Email, SMS, Voice call". [pure] */
export function channelList(channels: readonly Channel[] | undefined, t: TranslateFn): string {
  return CHANNEL_ORDER.filter((channel) => (channels ?? []).includes(channel))
    .map((channel) => String(t(`oncall.channel_${channel}`)))
    .join(", ");
}

/** Names as prose in the reader's language ("A, B, and C"); `locale` is the app's i18n code, e.g. `zh-cn`. [pure] */
export function listInLocale(items: readonly string[], locale: string): string {
  return new Intl.ListFormat(localeFileMap[locale] ?? locale, { type: "conjunction" }).format(
    items,
  );
}

/** Every escalation step that pages `rotationId`, numbered by delay within its priority. [pure] */
export function stepsNamingRotation(
  policy: Pick<OnCallPolicy, "rungs"> | null,
  rotationId: string,
): { priority: number; step: number }[] {
  return (policy?.rungs ?? []).flatMap((rung) =>
    [...rung.steps]
      .sort((a, b) => a.after_micros - b.after_micros)
      .flatMap((step, index) =>
        step.targets.some(
          (target) => target.kind === "rotation" && target.rotation_id === rotationId,
        )
          ? [{ priority: rung.priority, step: index + 1 }]
          : [],
      ),
  );
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
export function isStaffed(rotations: Rotation[], atMicros: number, timezone: string): boolean {
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

/** Mirrors `Channel::deliverable()` on the server — add to this list only when a new channel's provider actually sends. */
export const DELIVERABLE_CHANNELS: Channel[] = ["email", "sms", "voice", "webhook"];

export function isDeliverableChannel(channel: Channel): boolean {
  return DELIVERABLE_CHANNELS.includes(channel);
}

/** D13: a rung that texts or calls without Email leaves phoneless people with nothing; a stepless rung pages nobody, so the server accepts it. [pure] */
export function phoneWithoutEmail(rung: PriorityRung): boolean {
  const { channels } = rung;
  return (
    rung.steps.length > 0 &&
    !channels.includes("email") &&
    (channels.includes("sms") || channels.includes("voice"))
  );
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
export function windowContains(window: TimeWindow, atMicros: number, timezone: string): boolean {
  const wall = wallTimeInZone(atMicros, timezone);
  if (!wall) return false;
  const { minuteOfDay: minute, dayFromMonday: day } = wall;
  const { start_minute: start, end_minute: end, days } = window;

  const inTime = start <= end ? minute >= start && minute < end : minute >= start || minute < end;
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
  if (!ruleInForceAt(rule, atMicros)) return false;
  const windows = rule.restrictions ?? [];
  return windows.length === 0 || windows.some((w) => windowContains(w, atMicros, timezone));
}

/** Whether `atMicros` falls between the rule's `starts_at` and `ends_at`, ignoring its hours. [pure] */
export function ruleInForceAt(rule: ShiftRule, atMicros: number): boolean {
  if (rule.starts_at != null && atMicros < rule.starts_at) return false;
  return !(rule.ends_at != null && atMicros >= rule.ends_at);
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
  return { member: memberAt(rule, atMicros, timezone), rule };
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
  if (!rule || rule.members.length < 2 || !isCountable(rule)) return null;
  return memberOfShift(rule, localShiftIndex(rule, atMicros, timezone) + 1);
}

/** Which overlapping rules a rule beats, and which beat it, by index. */
export interface OverlapStanding {
  winsOver: number[];
  losesTo: number[];
}

const MINUTES_PER_WEEK = 7 * 1440;

/** The Covers quick picks, as the exact windows each one writes (aligned with the server's presets). */
export const COVERS_PRESETS = {
  all: [],
  businessHours: [{ days: [0, 1, 2, 3, 4], start_minute: 540, end_minute: 1020 }],
  weekdays: [{ days: [0, 1, 2, 3, 4], start_minute: 0, end_minute: 1440 }],
  weekends: [{ days: [5, 6], start_minute: 0, end_minute: 1440 }],
} as const satisfies Record<string, readonly TimeWindow[]>;

export type CoversPreset = keyof typeof COVERS_PRESETS | "custom";

/** The quick pick whose windows equal `restrictions` exactly, else `custom`. [pure] */
export function coversPresetOf(restrictions: readonly TimeWindow[] | undefined): CoversPreset {
  const windows = restrictions ?? [];
  const keys = Object.keys(COVERS_PRESETS) as Array<keyof typeof COVERS_PRESETS>;
  const match = keys.find((key) => {
    const preset: readonly TimeWindow[] = COVERS_PRESETS[key];
    return preset.length === windows.length && preset.every((w, i) => sameWindow(w, windows[i]));
  });
  return match ?? "custom";
}

/** `members` rotated so `person` sits at `index`; unchanged when they are not in it. [pure] */
export function rotateMembersTo(members: string[], person: string, index: number): string[] {
  const at = members.indexOf(person);
  if (at < 0 || !members.length) return [...members];
  const shift = (((at - index) % members.length) + members.length) % members.length;
  return members.map((_, i) => members[(i + shift) % members.length]);
}

/** `members` in handover order starting at `holder`; from the top when there is none. [pure] */
export function turnLine(members: string[], holder: string | null): string[] {
  const at = holder ? members.indexOf(holder) : -1;
  return at < 0 ? [...members] : [...members.slice(at), ...members.slice(0, at)];
}

/** How far the local estimate may be walked to the real boundary; `MAX_BOUNDARY_CORRECTIONS` in Rust. */
const MAX_BOUNDARY_CORRECTIONS = 4;

/** How far past a DST gap a handover is looked for; `MAX_GAP_MINUTES` in Rust. */
const MAX_GAP_MINUTES = 180;

/** Every instant at which `timezone`'s wall clock reads `local`: none in a gap, two in a fold. [pure] */
function instantsAtLocal(local: number, timezone: string): number[] {
  // One transition at most within a day either side, so the offsets on both sides are all there are.
  const offsets = new Set([
    offsetMicrosAt(local - 26 * MICROS_PER_HOUR, timezone),
    offsetMicrosAt(local + 26 * MICROS_PER_HOUR, timezone),
  ]);
  return [...offsets]
    .map((offset) => local - offset)
    .filter((at) => at + offsetMicrosAt(at, timezone) === local)
    .sort((a, b) => a - b);
}

/** The instant the wall clock reads `local`: the first of a fold, the end of a gap; mirrors `from_local_micros`. [pure] */
function fromLocalMicros(local: number, timezone: string): number | null {
  for (let minutes = 0; minutes <= MAX_GAP_MINUTES; minutes++) {
    const first = instantsAtLocal(local + minutes * MICROS_PER_MINUTE, timezone)[0];
    if (first !== undefined) return first;
  }
  return null;
}

/** When shift `index` of `rule` begins, a wall-clock time in `timezone`; mirrors `ShiftRule::boundary`. [pure] */
export function shiftBoundary(rule: ShiftRule, index: number, timezone: string): number | null {
  const localAnchor = rule.anchor_micros + offsetMicrosAt(rule.anchor_micros, timezone);
  return fromLocalMicros(localAnchor + index * rule.shift_micros, timezone);
}

/** Whether `rule` has people and a positive turn length, so its shifts can be counted. [pure] */
function isCountable(rule: ShiftRule): boolean {
  return !!rule.members?.length && !!rule.shift_micros && rule.shift_micros > 0;
}

/** Who holds shift `index`; JS `%` keeps the dividend's sign, so a pre-anchor index wraps twice. [pure] */
function memberOfShift(rule: ShiftRule, index: number): string {
  const len = rule.members.length;
  return rule.members[((index % len) + len) % len];
}

/** The shift `atMicros` falls in, counted in `timezone`'s wall time; mirrors `ShiftRule::shift_index`. [pure] */
function localShiftIndex(rule: ShiftRule, atMicros: number, timezone: string): number {
  const local = (micros: number) => micros + offsetMicrosAt(micros, timezone);
  const boundary = (index: number) => shiftBoundary(rule, index, timezone);
  let index = Math.floor((local(atMicros) - local(rule.anchor_micros)) / rule.shift_micros);
  // Local counts are one out across a transition, so settle against boundary instants.
  for (let step = 0; step < MAX_BOUNDARY_CORRECTIONS; step++) {
    const start = boundary(index);
    if (start !== null && start > atMicros) {
      index -= 1;
      continue;
    }
    const next = boundary(index + 1);
    if (next !== null && next <= atMicros) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

/** `rule`'s roster as `members`, keeping its holder at `nowMicros` and its handovers; mirrors `ShiftRule::with_roster`. [pure] */
export function withRoster(
  rule: ShiftRule,
  members: string[],
  nowMicros: number,
  timezone: string,
): string[] {
  const key = (m: string) => m.trim().toLowerCase();
  const wanted = new Set(members.map(key));
  const len = rule.members.length;
  const index = len && rule.shift_micros > 0 ? localShiftIndex(rule, nowMicros, timezone) : null;
  const holder = index === null ? null : rule.members[((index % len) + len) % len];
  const order = turnLine(rule.members, holder).filter((m) => wanted.has(key(m)));
  const kept = new Set(order.map(key));
  order.push(...members.filter((m) => !kept.has(key(m))));
  // An unresolvable rule has no holder to keep, so the roster is taken as given.
  if (index === null || !order.length) return order;
  const start = ((index % order.length) + order.length) % order.length;
  // Rotated so the anchor's turn arithmetic lands `order[0]` on the shift holding `nowMicros`.
  return order.map((_, i) => order[(i - start + order.length) % order.length]);
}

/** The rostered person behind a segment: the server's scheduled holder when someone else stands in. [pure] */
function turnHolder(segment: ResolvedSegment): string | null {
  return segment.scheduled_email ?? segment.user_email ?? null;
}

/** Who holds the turn of rule `ruleName` now, or next, in the server's segments. [pure] */
export function ruleHolder(
  segments: readonly ResolvedSegment[],
  ruleName: string,
  nowMicros: number,
): { email: string; now: boolean } | null {
  const turns = segments.filter((s) => s.rotation === ruleName && turnHolder(s));
  const current = turns.find((s) => s.from <= nowMicros && nowMicros < s.to);
  if (current) return { email: turnHolder(current) as string, now: true };
  const next = turns.find((s) => s.from > nowMicros);
  return next ? { email: turnHolder(next) as string, now: false } : null;
}

/** The team-local weekday (0 = Monday) and minute of day of an instant. [pure] */
export function anchorWeekdayTime(
  anchorMicros: number,
  timezone: string,
): { weekday: number; minute: number } {
  const local = toZonedInputValue(anchorMicros, timezone);
  const [year, month, day] = local.slice(0, 10).split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  const [hours, minutes] = local.slice(11, 16).split(":").map(Number);
  return { weekday: (date.getUTCDay() + 6) % 7, minute: hours * 60 + minutes };
}

/** The first shift moved to `weekday` (or its own day when null) at `minute`, within its team-local week. [pure] */
export function anchorAtWeekdayTime(
  anchorMicros: number,
  timezone: string,
  weekday: number | null,
  minute: number,
): number | null {
  const local = toZonedInputValue(anchorMicros, timezone);
  const [year, month, day] = local.slice(0, 10).split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (weekday !== null) {
    date.setUTCDate(date.getUTCDate() + weekday - ((date.getUTCDay() + 6) % 7));
  }
  const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return fromZonedInputValue(`${date.toISOString().slice(0, 10)}T${time}`, timezone);
}

/** One team-local day of a preview, with the segments cut at its midnights. */
export interface DayRow {
  start: number;
  end: number;
  pieces: Array<{ from: number; to: number; segment: ResolvedSegment }>;
}

/** `days` team-local day rows from the day holding `fromMicros`. [pure] */
export function dayRows(
  segments: readonly ResolvedSegment[],
  fromMicros: number,
  days: number,
  timezone: string,
): DayRow[] {
  return Array.from({ length: days }, (_, day) => {
    const start = zonedMidnight(fromMicros, timezone, day);
    const end = zonedMidnight(fromMicros, timezone, day + 1);
    const pieces = segments
      .filter((segment) => segment.from < end && segment.to > start)
      .map((segment) => ({
        from: Math.max(segment.from, start),
        to: Math.min(segment.to, end),
        segment,
      }));
    return { start, end, pieces };
  });
}

/** Where `atMicros` sits across `row`, strictly increasing: wall time / 24 h, the repeated hour's two passes sharing its slot. [pure] */
export function dayFraction(atMicros: number, row: DayRow, timezone: string): number {
  if (atMicros < row.start) return 0;
  if (atMicros >= row.end) return 1;
  const before = offsetMicrosAt(row.start, timezone);
  const after = offsetMicrosAt(row.end - 1, timezone);
  const midnight = Math.floor((row.start + before) / MICROS_PER_DAY) * MICROS_PER_DAY;
  const wall = (micros: number, offset: number) => (micros + offset - midnight) / MICROS_PER_DAY;
  if (before === after) return wall(atMicros, before);
  const change = offsetChangeAt(row.start, row.end - 1, timezone);
  const repeated = before - after;
  const foldStart = change - repeated;
  if (repeated > 0 && atMicros >= foldStart && atMicros < change + repeated) {
    return wall(foldStart, before) + (atMicros - foldStart) / (2 * MICROS_PER_DAY);
  }
  return wall(atMicros, atMicros < change ? before : after);
}

/** The zone's UTC offset at `micros`, in micros; UTC for a zone Intl rejects, as `dayRows` cuts it. [pure] */
function offsetMicrosAt(micros: number, timezone: string): number {
  try {
    return zoneOffsetMs(Math.floor(micros / 1_000_000) * 1000, timezone) * 1000;
  } catch {
    return 0;
  }
}

/** The first whole second in (`from`, `to`] whose offset is `to`'s, by halving; assumes one change between them. [pure] */
function offsetChangeAt(from: number, to: number, timezone: string): number {
  const target = offsetMicrosAt(to, timezone);
  let lo = Math.floor(from / 1_000_000);
  let hi = Math.floor(to / 1_000_000);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetMicrosAt(mid * 1_000_000, timezone) === target) hi = mid;
    else lo = mid;
  }
  return hi * 1_000_000;
}

/** Adjacent, touching segments of one holder joined into one stretch; the rostered member stays only where all parts agree. [pure] */
export function holderStretches(segments: readonly ResolvedSegment[]): ResolvedSegment[] {
  const out: ResolvedSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (!last || !sameHolder(last, segment)) {
      out.push({ ...segment });
      continue;
    }
    last.to = segment.to;
    if ((last.scheduled_email ?? null) !== (segment.scheduled_email ?? null)) {
      last.scheduled_email = undefined;
    }
  }
  return out;
}

/** Up to `max` ends of the rule's turns after now and before the window's end; a cover inside a turn does not end it. [pure] */
export function stopChoices(
  segments: readonly ResolvedSegment[],
  ruleName: string,
  nowMicros: number,
  windowTo: number,
  max = 3,
): Array<{ email: string; at: number }> {
  const turns: Array<{ email: string; to: number }> = [];
  for (const segment of segments) {
    const email = segment.rotation === ruleName ? turnHolder(segment) : null;
    if (!email) continue;
    const last = turns[turns.length - 1];
    if (last && last.email === email && last.to === segment.from) last.to = segment.to;
    else turns.push({ email, to: segment.to });
  }
  return turns
    .filter((turn) => turn.to > nowMicros && turn.to < windowTo)
    .slice(0, max)
    .map((turn) => ({ email: turn.email, at: turn.to }));
}

/** With `rules[index]` stopped at `atMicros`: the rules in force then sharing its hours, and its hours nobody else covers. [pure] */
export function stopConsequence(
  rules: ShiftRule[],
  index: number,
  atMicros: number,
): { takers: number[]; gap: Array<[number, number]> } {
  const mine = weekCoverage(rules[index]);
  const takers = rules.flatMap((rule, k) =>
    k !== index &&
    isShiftRuleValid(rule) &&
    ruleInForceAt(rule, atMicros) &&
    spansMeet(mine, weekCoverage(rule))
      ? [k]
      : [],
  );
  const minutes = new Uint8Array(MINUTES_PER_WEEK);
  for (const [start, end] of mine) minutes.fill(1, start, end);
  for (const k of takers)
    for (const [start, end] of weekCoverage(rules[k])) minutes.fill(0, start, end);
  return { takers, gap: spansOf(minutes) };
}

/** Whether the server refuses `a` and `b` side by side: same priority and identical windows. [pure] */
export function rulesClash(a: ShiftRule, b: ShiftRule): boolean {
  const left = a.restrictions ?? [];
  const right = b.restrictions ?? [];
  return (
    (a.priority ?? 0) === (b.priority ?? 0) &&
    left.length === right.length &&
    left.every((w, i) => sameWindow(w, right[i]))
  );
}

/** Indices of the other rules sharing any team-local minute of the week with `rules[index]`. [pure] */
export function overlappingRules(rules: ShiftRule[], index: number): number[] {
  const mine = weekCoverage(rules[index]);
  return rules.flatMap((rule, k) =>
    k !== index && spansMeet(mine, weekCoverage(rule)) ? [k] : [],
  );
}

/** Which overlapping rules `rules[index]` beats and which beat it, in the backend's order. [pure] */
export function overlapStanding(rules: ShiftRule[], index: number): OverlapStanding {
  const standing: OverlapStanding = { winsOver: [], losesTo: [] };
  for (const k of overlappingRules(rules, index)) {
    const order = compareShiftRules(rules[index], rules[k]);
    // On a full tie the backend's max_by keeps the later rule.
    if (order > 0 || (order === 0 && index > k)) standing.winsOver.push(k);
    else standing.losesTo.push(k);
  }
  return standing;
}

/** Priorities that make `rules[index]` win or lose against every rule it overlaps, all ≥ 0. [pure] */
export function prioritiesFor(rules: ShiftRule[], index: number, wins: boolean): number[] {
  const current = rules.map((rule) => rule.priority ?? 0);
  const { winsOver, losesTo } = overlapStanding(rules, index);
  if (!(wins ? losesTo : winsOver).length) return current;
  const rivals = [...winsOver, ...losesTo].map((k) => current[k]);
  if (wins) return current.map((p, k) => (k === index ? Math.max(...rivals) + 1 : p));
  const lowered = Math.min(...rivals) - 1;
  // Lifting every rule by the same amount keeps all other pairs in their order.
  const lift = Math.max(0, -lowered);
  return current.map((p, k) => (k === index ? lowered : p) + lift);
}

/** Rivals that take hours from `rules[index]`: they overlap and beat it, have people, and are in force now. [pure] */
export function effectiveRivals(rules: ShiftRule[], index: number, nowMicros: number): number[] {
  return overlapStanding(rules, index).losesTo.filter((k) => {
    const rival = rules[k];
    return isShiftRuleValid(rival) && ruleInForceAt(rival, nowMicros);
  });
}

/** The team-local minutes of the week where `rules[index]` applies and wins, as `[start, end)` spans. [pure] */
export function effectiveWeekCoverage(
  rules: ShiftRule[],
  index: number,
  nowMicros: number,
): Array<[number, number]> {
  const minutes = new Uint8Array(MINUTES_PER_WEEK);
  for (const [start, end] of weekCoverage(rules[index])) minutes.fill(1, start, end);
  for (const k of effectiveRivals(rules, index, nowMicros)) {
    for (const [start, end] of weekCoverage(rules[k])) minutes.fill(0, start, end);
  }
  return spansOf(minutes);
}

/** The server's merge key before `scheduled_email` joined it, for parts that touch. */
function sameHolder(a: ResolvedSegment, b: ResolvedSegment): boolean {
  return (
    a.to === b.from &&
    a.rotation_id === b.rotation_id &&
    (a.user_email ?? null) === (b.user_email ?? null) &&
    (a.rotation ?? null) === (b.rotation ?? null) &&
    (a.override_id ?? null) === (b.override_id ?? null)
  );
}

function sameWindow(a: TimeWindow, b: TimeWindow): boolean {
  const left = a.days ?? [];
  const right = b.days ?? [];
  return (
    a.start_minute === b.start_minute &&
    a.end_minute === b.end_minute &&
    left.length === right.length &&
    left.every((day, i) => day === right[i])
  );
}

/** The team-local minutes of the week a rule covers, as `[start, end)` spans. */
function weekCoverage(rule: ShiftRule): Array<[number, number]> {
  const windows = rule.restrictions ?? [];
  if (!windows.length) return [[0, MINUTES_PER_WEEK]];
  return windows.flatMap(windowCoverage);
}

function windowCoverage(window: TimeWindow): Array<[number, number]> {
  const { start_minute: start, end_minute: end } = window;
  if (start === end) return [];
  const days = window.days?.length ? window.days : [0, 1, 2, 3, 4, 5, 6];
  return days.flatMap((day): Array<[number, number]> => {
    const at = day * MINUTES_PER_DAY;
    if (start < end) return [[at + start, at + end]];
    // The after-midnight half belongs to the previous day's window, so it lands on the next day.
    const next = ((day + 1) % 7) * MINUTES_PER_DAY;
    return [
      [at + start, at + MINUTES_PER_DAY],
      [next, next + end],
    ];
  });
}

function spansOf(minutes: Uint8Array): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  for (let at = 0; at <= minutes.length; at++) {
    const on = at < minutes.length && minutes[at] === 1;
    if (on && start < 0) start = at;
    if (!on && start >= 0) {
      out.push([start, at]);
      start = -1;
    }
  }
  return out;
}

function spansMeet(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  return a.some(([s1, e1]) => b.some(([s2, e2]) => s1 < e2 && s2 < e1));
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

/** Weekday, date and 24-hour time in the schedule's timezone: the drawer's one stamp for an instant. [pure] */
export function formatStamp(micros: number, timezone: string): string {
  return formatInZone(micros, timezone, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
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
export function describeRestrictions(windows: TimeWindow[] | undefined, t: TranslateFn): I18nText {
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

/** A rule's hours in words: "All hours", or each window joined. [pure] */
export function ruleHoursSummary(rule: ShiftRule, t: TranslateFn): I18nText {
  const windows = rule.restrictions ?? [];
  if (!windows.length) return t("oncall.ruleHoursAll");
  return windowsSummary(windows, t);
}

/** Week-minute spans in the same words as a rule's hours, identical days grouped. [pure] */
export function coverageHoursSummary(spans: Array<[number, number]>, t: TranslateFn): I18nText {
  const minutes = new Uint8Array(MINUTES_PER_WEEK);
  for (const [start, end] of spans) minutes.fill(1, start, end);
  if (minutes.every((on) => on === 1)) return t("oncall.ruleHoursAll");
  return windowsSummary(coverageWindows(minutes), t);
}

function windowsSummary(windows: TimeWindow[], t: TranslateFn): I18nText {
  return t("oncall.restrictionList", { windows: windows.map((w) => windowWords(w, t)).join(", ") });
}

/** Covered minutes as windows: a run past midnight becomes one window that ends next day. */
function coverageWindows(minutes: Uint8Array): TimeWindow[] {
  const ranges = [0, 1, 2, 3, 4, 5, 6].flatMap((day) =>
    spansOf(minutes.subarray(day * MINUTES_PER_DAY, (day + 1) * MINUTES_PER_DAY)).map(
      ([start, end]) => ({ day, start, end }),
    ),
  );
  const consumed = new Set<(typeof ranges)[number]>();
  const merged = ranges.flatMap((range) => {
    if (consumed.has(range)) return [];
    const next =
      range.end === MINUTES_PER_DAY && range.start > 0
        ? ranges.find(
            (r) =>
              r.day === (range.day + 1) % 7 && r.start === 0 && r.end < range.start && r !== range,
          )
        : undefined;
    if (!next) return [range];
    consumed.add(next);
    return [{ ...range, end: next.end }];
  });
  const byShape = new Map<string, TimeWindow>();
  for (const { day, start, end } of merged.filter((r) => !consumed.has(r))) {
    const key = `${start}-${end}`;
    const shape = byShape.get(key) ?? { days: [], start_minute: start, end_minute: end };
    shape.days!.push(day);
    byShape.set(key, shape);
  }
  return [...byShape.values()];
}

function windowWords(window: TimeWindow, t: TranslateFn): string {
  const everyDay = new Set(window.days ?? []).size % 7 === 0;
  const days = everyDay ? t("oncall.ruleHoursEveryDay") : describeDays(window.days, t);
  const { start_minute: start, end_minute: end } = window;
  if (start === 0 && end === MINUTES_PER_DAY) return t("oncall.restrictionWindowAllDay", { days });
  const key = end < start ? "oncall.ruleHoursWindowNextDay" : "oncall.restrictionWindow";
  return t(key, { days, from: formatMinuteOfDay(start), to: formatMinuteOfDay(end) });
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

/** Which of `RoutingDecision`'s four branches produced a sentence. */
export type RoutingMechanism = "explicit" | "ownership" | "default" | "unrouted";

/** A routing sentence read back into the parts a screen can render. */
export interface RoutingReasonView {
  /** What routing considered and passed over, in the order it says them. */
  notes: string[];
  mechanism: RoutingMechanism;
  /** The winning ownership rule's dimensions — chips, not a path. */
  dimensions: Record<string, string>;
  /** The team as the sentence names it: its name, or its id on events written before names. */
  team: string | null;
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
    team: null,
    ...rest,
  });

  // Non-greedy: a team name may hold spaces, and the rule's path follows the fixed marker.
  const ownership = /^routed to (.+?) by ownership rule (.+)$/.exec(decision);
  if (ownership) {
    return view("ownership", {
      team: ownership[1],
      dimensions: dimensionsOfPath(ownership[2]),
    });
  }

  const explicit = /^routed to (.+) by the alert's own setting$/.exec(decision);
  if (explicit) return view("explicit", { team: explicit[1] });

  const fallback = /^no ownership rule matched, so it went to the default team (.+)$/.exec(
    decision,
  );
  if (fallback) return view("default", { team: fallback[1] });

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

/// ── A date+time picker in somebody else's timezone ─────────────────────────
///
/// The date/time fields carry no zone of their own: they read and write bare
/// wall time, and the browser's own zone is the only one the platform will
/// apply. Every on-call instant belongs to the TEAM's zone instead — that is
/// what "handover at 10:00" means, and the fields say so on their labels.
///
/// Rendering `new Date(micros).getHours()` and parsing with `Date.parse()`
/// therefore answered in the reader's zone while the label promised the
/// team's. An operator in Berlin editing an Asia/Kolkata team read a handover
/// three and a half hours from where it was, and moved it there by saving.

// Building a formatter costs far more than using one, and shift counting asks for offsets per sample.
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** One cached formatter per zone for `zoneOffsetMs`; throws for a zone Intl rejects, as before. */
function offsetFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = offsetFormatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    offsetFormatters.set(timezone, fmt);
  }
  return fmt;
}

/** How far `timezone` is from UTC at this instant, in ms. DST-correct. */
function zoneOffsetMs(utcMs: number, timezone: string): number {
  const parts = offsetFormatter(timezone).formatToParts(new Date(utcMs));

  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // `hour12: false` reports midnight as 24 in some engines.
  // Built via setUTCFullYear rather than passed straight into Date.UTC's
  // (year, month, ...) args — see the comment in fromZonedInputValue for why
  // that form is unsafe for a year in 0-99 (as this one is while a date
  // field's year segment is still being typed).
  const asIfUtcDate = new Date(0);
  asIfUtcDate.setUTCFullYear(at("year"), at("month") - 1, at("day"));
  asIfUtcDate.setUTCHours(at("hour") % 24, at("minute"), at("second"), 0);
  return asIfUtcDate.getTime() - utcMs;
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
  // Built via setUTCFullYear rather than passed straight into Date.UTC's
  // (year, month, ...) args: that form silently folds a 0-99 year to
  // 1900-1999 (legacy two-digit-year behavior). A date field mid-edit passes
  // through exactly that range — @internationalized/date zero-pads a
  // partially typed year to 4 characters (e.g. "19" -> "0019"), which still
  // matches the regex above, so Date.UTC(19, ...) would silently commit 1919
  // instead of leaving the in-progress edit alone.
  const utcDate = new Date(0);
  utcDate.setUTCFullYear(y, mo - 1, d);
  utcDate.setUTCHours(h, mi, 0, 0);
  const asIfUtc = utcDate.getTime();
  if (Number.isNaN(asIfUtc)) return null;
  try {
    const first = asIfUtc - zoneOffsetMs(asIfUtc, timezone);
    const second = asIfUtc - zoneOffsetMs(first, timezone);
    return second * 1000;
  } catch {
    return asIfUtc * 1000;
  }
}

/** The first instant of the `timezone` day `days` after the one holding `micros`, in micros; the clock jump where 00:00 is skipped. [pure] */
export function zonedMidnight(micros: number, timezone: string, days = 0): number {
  const [year, month, day] = toZonedInputValue(micros, timezone)
    .slice(0, 10)
    .split("-")
    .map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day + days);
  const target = date.toISOString().slice(0, 10);
  const midnight = fromZonedInputValue(`${target}T00:00`, timezone);
  if (midnight === null) throw new RangeError(`no local midnight for ${micros} in ${timezone}`);
  if (toZonedInputValue(midnight, timezone).startsWith(target)) return midnight;
  // A skipped 00:00 resolves to the day before; the day starts at the jump, read at the old offset.
  const jumpedTo = date.getTime() * 1000 - offsetMicrosAt(midnight, timezone);
  return offsetChangeAt(midnight, jumpedTo, timezone);
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

/** What the Phone card shows; `empty` is also the form that Change reopens. */
export type PhoneCardState = "empty" | "codeSent" | "verified" | "noProvider" | "changed";

/** The Phone card's state from the contact read and the session's own progress. [pure] */
export function phoneCardState(
  contact: Contact,
  codeSent: boolean,
  editing: boolean,
): PhoneCardState {
  if (!contact.phone_provider_available) return "noProvider";
  if (editing || !contact.phone) return "empty";
  if (contact.phone_is_pageable) return "verified";
  // The server keeps no record of the previously verified number, so any saved unverified one reads as changed.
  return codeSent ? "codeSent" : "changed";
}

const REFUSAL_REASONS: ReadonlySet<string> = new Set<RefusalReason>([
  "wrong_code",
  "expired",
  "too_many_tries",
  "no_code",
  "too_soon",
  "user_daily_limit",
  "number_daily_limit",
  "no_provider",
  "no_phone",
  "number_rejected",
  "number_not_allowed",
  "provider_unavailable",
]);

/** The refusal body of a failed send or confirm, or null when the error is anything else. [pure] */
export function refusalOf(err: unknown): VerificationRefusalBody | null {
  const data = (err as { response?: { data?: Partial<VerificationRefusalBody> } })?.response?.data;
  return typeof data?.reason === "string" && REFUSAL_REASONS.has(data.reason)
    ? (data as VerificationRefusalBody)
    : null;
}

/** A wait rounded up, so the user is never told to come back too early. [pure] */
function waitText(t: TranslateFn, secs: number): I18nText {
  if (secs < 3600) {
    const count = Math.max(1, Math.ceil(secs / 60));
    return t("oncall.phoneWaitMinutes", { count });
  }
  return t("oncall.phoneWaitHours", { count: Math.ceil(secs / 3600) });
}

/** A limit's text, or the API's own when it carries no wait to show. [pure] */
function limitText(t: TranslateFn, key: I18nKey, body: VerificationRefusalBody): I18nText {
  if (body.retry_after_secs === undefined) return raw(body.message);
  return t(key, { wait: waitText(t, body.retry_after_secs) });
}

/** The translated sentence for a refusal; no limit's text names the number or the count. [pure] */
export function phoneRefusalText(t: TranslateFn, body: VerificationRefusalBody): I18nText {
  switch (body.reason) {
    case "wrong_code": {
      const count = body.tries_left ?? 0;
      return t("oncall.phoneRefusalWrongCode", { count }, count);
    }
    case "expired":
      return t("oncall.phoneRefusalExpired");
    case "too_many_tries":
      return t("oncall.phoneRefusalTooManyTries");
    case "no_code":
      return t("oncall.phoneRefusalNoCode");
    case "too_soon":
      return limitText(t, "oncall.phoneRefusalTooSoon", body);
    case "user_daily_limit":
      return limitText(t, "oncall.phoneRefusalUserDailyLimit", body);
    case "number_daily_limit":
      return limitText(t, "oncall.phoneRefusalNumberDailyLimit", body);
    case "no_provider":
      return t("oncall.phoneRefusalNoProvider");
    case "no_phone":
      return t("oncall.phoneRefusalNoPhone");
    case "number_rejected":
      return t("oncall.phoneRefusalNumberRejected");
    case "number_not_allowed":
      return t("oncall.phoneRefusalNumberNotAllowed");
    case "provider_unavailable":
      return t("oncall.phoneRefusalProviderUnavailable");
  }
}

/** Whether two typed numbers are one number once the server strips spaces and `-().`. [pure] */
export function samePhone(a: string, b: string): boolean {
  const compact = (p: string) => p.replace(/[\s\-().]/g, "");
  return compact(a) !== "" && compact(a) === compact(b);
}

/** "times in {zone}", plus the reader's own clock when it is a different zone; the schedule's zone caption. [pure] */
export function zoneCaption(
  timezone: string,
  localZone: string,
  nowMicros: number,
  t: TranslateFn,
): I18nText {
  if (localZone === timezone) return t("oncall.schedZoneSame", { zone: raw(timezone) });
  const local = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(nowMicros / 1000));
  return t("oncall.schedZoneDiff", { zone: raw(timezone), local: raw(local) });
}

/** Whether the server's `to_e164` would take this: `+`, 7 to 15 digits, no leading 0, once spaces and `-().` go. [pure] */
export function isInternationalPhone(typed: string): boolean {
  const compact = typed.trim().replace(/[ \-().]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(compact);
}

/** Seconds as `m:ss`, or `h:mm:ss` from an hour up. [pure] */
export function formatCountdown(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(s % 60)}`;
  return `${minutes}:${pad(s % 60)}`;
}
