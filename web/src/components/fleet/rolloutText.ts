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

import type { FleetHaltClass, FleetHaltExit, FleetRolloutBatching } from "@/services/fleet";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

/** One wording for rollout progress, plans and halts, shared by the fleet panel, the list and the drawer. */
export function useRolloutText() {
  const { t } = useI18nTyped();

  // An empty fleet still records a completed rollout, and "0 of 0 running" reads as a success.
  const progressText = (r: { running: number; total: number }) =>
    r.total === 0
      ? t("fleet.rollouts.noneTargeted")
      : t("fleet.rollouts.progressCount", { running: r.running, total: r.total });

  const startsText = (at: number) => {
    const ms = at - Date.now();
    if (ms <= 0) return t("fleet.rollouts.startingShortly");
    if (ms < 3_600_000)
      return t("fleet.rollouts.startsInMinutes", { minutes: Math.ceil(ms / 60_000) });
    return t("fleet.rollouts.startsIn", { hours: Math.ceil(ms / 3_600_000) });
  };

  const changeText = (r: { fromVersion: number | null; toVersion: number }) =>
    r.fromVersion === null
      ? t("fleet.rollouts.versionTo", { to: r.toVersion })
      : t("fleet.rollouts.versionChange", { from: r.fromVersion, to: r.toVersion });

  /** "3 → 9 → 27 → remaining 61, 4 phases". */
  const planText = (phases: number[]): I18nText => {
    if (!phases.length) return t("fleet.rollouts.planEmpty");
    if (phases.length === 1) return t("fleet.rollouts.planOne", { count: phases[0] }, phases[0]);
    const steps = raw(phases.slice(0, -1).join(" → "));
    const count = phases.length;
    return t("fleet.rollouts.planText", { steps, last: phases[count - 1], count }, count);
  };

  const batchingText = (b: FleetRolloutBatching): I18nText => {
    if (b.kind === "canary") return t("fleet.rollouts.batchingCanary", { first: b.first });
    if (b.kind === "progressive")
      return t("fleet.rollouts.batchingProgressive", {
        initial: b.initial,
        multiplier: b.multiplier,
        max: b.max,
      });
    return t("fleet.rollouts.batchingOne");
  };

  const haltClassText = (c: FleetHaltClass): I18nText => {
    const labels: Record<FleetHaltClass, I18nText> = {
      proven_bad: t("fleet.rollouts.haltProvenBad"),
      looks_worse: t("fleet.rollouts.haltLooksWorse"),
      cannot_see: t("fleet.rollouts.haltCannotSee"),
    };
    return labels[c] ?? raw(c);
  };

  const exitLabel = (e: FleetHaltExit): I18nText => {
    const labels: Record<FleetHaltExit, I18nText> = {
      rollback: t("fleet.rollouts.exitRollback"),
      resume: t("fleet.rollouts.exitResume"),
      fix_forward: t("fleet.rollouts.exitFixForward"),
      skip: t("fleet.rollouts.exitSkip"),
    };
    return labels[e] ?? raw(e);
  };

  return { batchingText, changeText, exitLabel, haltClassText, planText, progressText, startsText };
}
