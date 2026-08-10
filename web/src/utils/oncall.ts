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
  EscalationTarget,
  ResponseState,
  Rotation,
  OnCallResponse,
  OnCallResponseGroup,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_HOUR, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { I18nKey } from "@/types/i18n";

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

/// Row-rail colour for the pages list, keyed to the same severity ramp as
/// `priorityTagVariant` so a P1 is the same red in the chip and at the edge.
export function priorityRailColor(priority: number): string {
  switch (priority) {
    case 1:
      return "var(--color-error-500)";
    case 2:
      return "var(--color-orange-500)";
    case 3:
      return "var(--color-warning-500)";
    case 4:
      return "var(--color-blue-500)";
    default:
      return "var(--color-grey-400)";
  }
}

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
 * Compact duration for a microsecond span, e.g. `4m 12s`.
 *
 * Rounds toward zero and drops empty leading units so a page's time-to-ack
 * reads at a glance. Negative spans (clock skew across nodes) render as `—`
 * rather than a negative duration.
 */
export function formatMicrosDuration(micros: number): string {
  if (!Number.isFinite(micros) || micros < 0) return "—";
  const totalSeconds = Math.floor(micros / 1_000_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

/** Shift length as a duration, for the schedule summary. */
export function formatShift(micros: number): string {
  return formatMicrosDuration(micros);
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
