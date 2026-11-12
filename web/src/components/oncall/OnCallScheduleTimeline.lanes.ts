// Copyright 2026 OpenObserve Inc.

import type { OnCallPolicy, ResolvedSegment, ShiftRule } from "@/ts/interfaces/oncall";
import { isRotationTarget } from "@/ts/interfaces/oncall";
import { anchorWeekdayTime, toZonedInputValue } from "@/utils/oncall";

const MICROS_PER_MINUTE = 60_000_000;
const MINUTES_PER_DAY = 1440;

/** How often a lane's rules hand over, read on the team's wall clock. */
export type LaneCadence =
  | { kind: "weekly"; weekday: number; minute: number }
  | { kind: "daily"; minute: number }
  | { kind: "days"; days: number; minute: number }
  | { kind: "every"; micros: number };

/** The handover cadence the lane's live rules share, or null when none is live or they differ; restrictions never move it. [pure] */
export function laneCadence(rules: ShiftRule[], now: number, timezone: string): LaneCadence | null {
  const live = rules.filter(
    (rule) =>
      rule.members.length > 0 &&
      rule.shift_micros > 0 &&
      (rule.starts_at ?? now) <= now &&
      (rule.ends_at ?? Infinity) > now,
  );
  const phases = new Set(live.map((rule) => phaseKey(rule, timezone)));
  if (phases.size !== 1) return null;
  return cadenceOf(live[0], timezone);
}

/** Whether some escalation step pages this rotation and nothing else; true without a policy, so an unknown gap stays loud. [pure] */
export function pagedAlone(policy: OnCallPolicy | null | undefined, rotationId: string): boolean {
  if (!policy) return true;
  return steps(policy).some(
    (targets) =>
      targets.length > 0 &&
      targets.every((target) => isRotationTarget(target) && target.rotation_id === rotationId),
  );
}

/** Whether any escalation step names this rotation; true without a policy, which says nothing either way. [pure] */
export function pagedAtAll(policy: OnCallPolicy | null | undefined, rotationId: string): boolean {
  if (!policy) return true;
  return steps(policy).some((targets) =>
    targets.some((target) => isRotationTarget(target) && target.rotation_id === rotationId),
  );
}

/** Nobody on it, outside every rule's hours, in a rotation no step pages alone; inside a rule's hours it is a gap. [pure] */
export function isOffStretch(
  segment: Pick<ResolvedSegment, "user_email" | "rotation">,
  pagedAloneByPolicy: boolean,
): boolean {
  return !segment.user_email && !segment.rotation && !pagedAloneByPolicy;
}

/** Whether one escalation step pages both rotations at once; false without a policy. [pure] */
export function pagedTogether(
  policy: OnCallPolicy | null | undefined,
  rotationId: string,
  otherId: string,
): boolean {
  if (!policy) return false;
  const names = (targets: ReturnType<typeof steps>[number], id: string) =>
    targets.some((target) => isRotationTarget(target) && target.rotation_id === id);
  return steps(policy).some((targets) => names(targets, rotationId) && names(targets, otherId));
}

/// Two rules hand over together when their shift length and wall-clock phase match.
function phaseKey(rule: ShiftRule, timezone: string): string {
  const local = toZonedInputValue(rule.anchor_micros, timezone);
  const [year, month, day] = local.slice(0, 10).split("-").map(Number);
  const [hours, minutes] = local.slice(11, 16).split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hours, minutes) / 60_000;
  const length = Math.max(1, Math.round(rule.shift_micros / MICROS_PER_MINUTE));
  return `${rule.shift_micros}:${((wall % length) + length) % length}`;
}

function cadenceOf(rule: ShiftRule, timezone: string): LaneCadence {
  const { weekday, minute } = anchorWeekdayTime(rule.anchor_micros, timezone);
  const days = rule.shift_micros / (MINUTES_PER_DAY * MICROS_PER_MINUTE);
  if (days === 7) return { kind: "weekly", weekday, minute };
  if (days === 1) return { kind: "daily", minute };
  if (Number.isInteger(days)) return { kind: "days", days, minute };
  return { kind: "every", micros: rule.shift_micros };
}

/// Each step's targets; with `p1_parallel` every P1 step fires at once, so the P1 rung counts as one step.
function steps(policy: OnCallPolicy) {
  return policy.rungs.flatMap((rung) =>
    policy.p1_parallel === true && rung.priority === 1
      ? [rung.steps.flatMap((step) => step.targets)]
      : rung.steps.map((step) => step.targets),
  );
}
