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
  EscalationLevel,
  ResponseState,
  Rotation,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_HOUR, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { I18nKey } from "@/types/i18n";

/** Ladder order. Mirrors `EscalationLevel::to_i32` on the server. */
const LEVEL_ORDER: Record<EscalationLevel, number> = {
  l0: 0,
  primary: 1,
  secondary: 2,
  l1: 3,
  l2: 4,
  l3: 5,
  l4: 6,
};

export function levelOrder(level: EscalationLevel): number {
  return LEVEL_ORDER[level] ?? Number.MAX_SAFE_INTEGER;
}

export function sortByLevel<T extends { level: EscalationLevel }>(items: T[]): T[] {
  return [...items].sort((a, b) => levelOrder(a.level) - levelOrder(b.level));
}

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

/** A record still escalating — what the on-call engineer's list shows first. */
export function isOpen(state: ResponseState): boolean {
  return state === "triggered" || state === "triaged";
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
 * Levels a policy wants to page that no rotation staffs.
 *
 * The team has to see these: a page that goes nowhere because L2 was never
 * filled is the failure the whole screen exists to prevent.
 */
export function coverageGaps(
  wanted: EscalationLevel[],
  rotations: Rotation[],
  atMicros: number,
): EscalationLevel[] {
  return wanted.filter((level) => {
    const rotation = rotations.find((r) => r.level === level);
    return !rotation || memberAt(rotation, atMicros) === null;
  });
}

/** Every level a policy's ladders reference, deduped and in ladder order. */
export function levelsUsedByPolicy(
  rungs: { steps: { level: EscalationLevel }[] }[],
): EscalationLevel[] {
  const seen = new Set<EscalationLevel>();
  for (const rung of rungs) {
    for (const step of rung.steps) seen.add(step.level);
  }
  return [...seen].sort((a, b) => levelOrder(a) - levelOrder(b));
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
export const DELIVERABLE_CHANNELS: Channel[] = ["email"];

export function isDeliverableChannel(channel: Channel): boolean {
  return DELIVERABLE_CHANNELS.includes(channel);
}

/** Priorities in the order the policy editor shows them. */
export const PRIORITY_ORDER: AlertPriorityValue[] = [1, 2, 3, 4, 5];
